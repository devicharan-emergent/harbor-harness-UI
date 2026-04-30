from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Response, Cookie
import httpx
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import copy
import uuid
from pathlib import Path
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from agent_service import (
    init_agent_service,
    get_current_service,
    serialize_doc,
    clean_for_version,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=False)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'acm_db')]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ── Auth (Emergent-managed Google) ──────────────────────────────────────
EMERGENT_AUTH_SESSION_DATA_URL = (
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)
SESSION_TTL_DAYS = 7


async def _get_session_user(request: Request) -> Optional[Dict[str, Any]]:
    """Resolve current user from session_token cookie OR Authorization header.
    Returns a user dict (without _id) or None."""
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    session_doc = await db.user_sessions.find_one(
        {"session_token": token}, {"_id": 0}
    )
    if not session_doc:
        return None
    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        await db.user_sessions.delete_one({"session_token": token})
        return None
    user_doc = await db.users.find_one(
        {"user_id": session_doc["user_id"]}, {"_id": 0}
    )
    return user_doc


class AuthSessionRequest(BaseModel):
    session_id: str


@api_router.post("/auth/session")
async def auth_session(body: AuthSessionRequest, response: Response):
    """Exchange a one-time Emergent session_id for a persistent session cookie."""
    async with httpx.AsyncClient(timeout=15.0) as hclient:
        r = await hclient.get(
            EMERGENT_AUTH_SESSION_DATA_URL,
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Emergent auth missing email")

    # Upsert user (keyed by email so the same Google account = same row)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name", "")),
                       "picture": data.get("picture", existing.get("picture", ""))}}
        )
    else:
        user_id = str(uuid.uuid4())
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "created_at": datetime.now(timezone.utc),
        })

    session_token = data.get("session_token") or uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
    )

    return {
        "user_id": user_id,
        "email": email,
        "name": data.get("name", ""),
        "picture": data.get("picture", ""),
    }


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await _get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


# ── Pydantic models ─────────────────────────────────────────────────────
class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str
    version: int = 1
    description: str = ""
    agent_type: str = "None"
    tags: List[str] = []
    model: Dict[str, Any] = {}
    prompt: Dict[str, Any] = {}
    toolsets: List[Dict[str, Any]] = []
    overrides: Dict[str, Any] = {}
    runtime: Dict[str, Any] = {}
    hooks: Dict[str, Any] = {}
    last_modified: Optional[str] = None


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    agent_type: Optional[str] = None
    tags: Optional[List[str]] = None
    model: Optional[Dict[str, Any]] = None
    prompt: Optional[Dict[str, Any]] = None
    toolsets: Optional[List[Dict[str, Any]]] = None
    overrides: Optional[Dict[str, Any]] = None
    runtime: Optional[Dict[str, Any]] = None
    hooks: Optional[Dict[str, Any]] = None


# ── Config & Capabilities ────────────────────────────────────────────────

@api_router.get("/")
async def root():
    service = get_current_service()
    caps = service.get_capabilities()
    return {
        "message": "ACM API running",
        "data_source": caps.get("data_source", "unknown")
    }


@api_router.get("/config")
async def get_config():
    """Get current configuration including data source"""
    service = get_current_service()
    caps = service.get_capabilities()
    return {
        "data_source": caps.get("data_source", "mongodb"),
        "builder_api_url": BUILDER_PROXY_BASE.replace("/api/v1/builder", ""),
        "eval_api_url": EVAL_API_BASE
    }


@api_router.get("/capabilities")
async def get_capabilities():
    """Get capabilities of the current data source backend"""
    service = get_current_service()
    return service.get_capabilities()


@api_router.post("/config/data-source")
async def toggle_data_source(body: dict):
    """Toggle between MongoDB and Builder API"""
    new_source = body.get("data_source")  # "mongodb" or "builder_api"

    if new_source not in ["mongodb", "builder_api"]:
        raise HTTPException(status_code=400, detail="Invalid data source. Use 'mongodb' or 'builder_api'")

    use_builder = "true" if new_source == "builder_api" else "false"

    # Update .env file
    env_path = ROOT_DIR / '.env'
    lines = []
    if env_path.exists():
        with open(env_path, 'r') as f:
            lines = f.readlines()

    # Update or add USE_BUILDER_API line
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith('USE_BUILDER_API='):
            new_lines.append(f'USE_BUILDER_API={use_builder}\n')
            found = True
        else:
            new_lines.append(line)

    if not found:
        new_lines.append(f'USE_BUILDER_API={use_builder}\n')

    with open(env_path, 'w') as f:
        f.writelines(new_lines)

    # Update environment variable
    os.environ['USE_BUILDER_API'] = use_builder

    # Reinitialize agent service
    init_agent_service(db)

    # Get capabilities of new service
    service = get_current_service()
    caps = service.get_capabilities()

    return {
        "message": f"Data source switched to {new_source}",
        "data_source": new_source,
        "capabilities": caps
    }


# ── Agent CRUD (all routed through AgentService) ─────────────────────────

@api_router.get("/agents")
async def list_agents(
    search: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
):
    service = get_current_service()
    agents = await service.list_agents(search=search, tags=tags)

    # Apply provider filter (client-side for now)
    if provider:
        agents = [a for a in agents if a.get("model", {}).get("provider") == provider]

    return agents


@api_router.post("/agents")
async def create_agent(config: AgentConfig):
    service = get_current_service()
    return await service.create_agent(config.model_dump())


@api_router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    service = get_current_service()
    return await service.get_agent(agent_id)


@api_router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, config: AgentConfig):
    service = get_current_service()
    return await service.update_agent(agent_id, config.model_dump())


@api_router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    service = get_current_service()
    return await service.delete_agent(agent_id)


@api_router.post("/agents/{agent_id}/clone")
async def clone_agent(agent_id: str):
    service = get_current_service()
    return await service.clone_agent(agent_id)


@api_router.get("/agents/{agent_id}/versions")
async def list_versions(agent_id: str):
    service = get_current_service()
    return await service.get_versions(agent_id)


@api_router.get("/agents/{agent_id}/versions/{version}")
async def get_version(agent_id: str, version: int):
    service = get_current_service()
    return await service.get_version(agent_id, version)


@api_router.post("/agents/{agent_id}/versions/{version}/restore")
async def restore_version(agent_id: str, version: int):
    service = get_current_service()
    return await service.restore_version(agent_id, version)


# ── Eval API Proxy ──────────────────────────────────────────────────────

EVAL_API_BASE = os.environ.get("EVAL_API_BASE", "http://harness-eval.int-worker.dev.emergentagent.com")
BUILDER_PROXY_BASE = os.environ.get("BUILDER_API_BASE", "https://cortex-eph-builder-1035522277200.us-central1.run.app/api/v1/builder")


@api_router.get("/eval/cortex/agents/exists")
async def proxy_agent_exists(eph_name: str = Query(...), agent_name: str = Query(...)):
    """Proxy GET /api/v1/cortex/agents/exists?eph_name=&agent_name= on the harness."""
    async with httpx.AsyncClient(timeout=15.0) as hclient:
        response = await hclient.get(
            f"{EVAL_API_BASE}/api/v1/cortex/agents/exists",
            params={"eph_name": eph_name, "agent_name": agent_name},
        )
        if response.status_code >= 400:
            try:
                data = response.json()
            except Exception:
                data = {"message": response.text}
            raise HTTPException(status_code=response.status_code, detail=data)
        return response.json()

@api_router.post("/eval/jobs")
async def proxy_submit_eval(body: dict):
    """Proxy: Submit eval jobs to external Eval API.
    
    Transforms frontend format to Eval API format:
    Frontend: { user_id, group_id?, agent_name?, evals: [{ problem, cpus?, memory?, storage?, headed?, force_build?, experiments? }] }
    API:      { user_id, group_run_id?, agent_name?, evals: [...] }
    """
    try:
        # Build the correct payload for the Eval API
        payload = {}

        # Handle user_id
        if "user_id" in body:
            payload["user_id"] = body["user_id"]

        # Handle group id — harness now expects `group_run_id`. Accept either
        # `group_id` or `group_run_id` from the frontend for forward/backward
        # compatibility, and always forward as `group_run_id`.
        group_value = body.get("group_run_id") or body.get("group_id")
        if group_value:
            payload["group_run_id"] = group_value

        # Batch-level agent override (forwarded as-is)
        if body.get("agent_name"):
            payload["agent_name"] = body["agent_name"]

        # Handle evals array
        if "evals" in body:
            payload["evals"] = body["evals"]
        elif "jobs" in body:
            # Legacy format: transform jobs to evals
            evals = []
            for job in body["jobs"]:
                eval_item = {"problem": job.get("problem", "")}
                # Map resources
                resources = job.get("resources", {})
                if resources.get("cpus"):
                    eval_item["cpus"] = resources["cpus"]
                if resources.get("memory_mb"):
                    eval_item["memory"] = resources["memory_mb"]
                if resources.get("storage_gb"):
                    eval_item["storage"] = resources["storage_gb"]
                if resources.get("headed"):
                    eval_item["headed"] = resources["headed"]
                if resources.get("force_build"):
                    eval_item["force_build"] = resources["force_build"]
                # Map experiment_config -> experiments
                exp_config = job.get("experiment_config")
                if exp_config:
                    eval_item["experiments"] = exp_config
                evals.append(eval_item)
            payload["evals"] = evals
            if body.get("user_id"):
                payload["user_id"] = body["user_id"]
        else:
            raise HTTPException(status_code=400, detail="Request must contain 'evals' array")

        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.post(f"{EVAL_API_BASE}/api/v1/evals", json=payload)
            if response.status_code >= 400:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"message": response.text}
                raise HTTPException(
                    status_code=response.status_code,
                    detail=error_data.get("message", str(error_data))
                )
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/jobs")
async def proxy_list_eval_jobs(
    status: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """Proxy: List eval jobs"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"limit": limit, "offset": offset}
            if status:
                params["status"] = status
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/evals", params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/jobs/aggregate")
async def proxy_eval_aggregate(group_id: str = Query(..., description="Group ID to aggregate")):
    """Proxy: Get aggregate metrics (time per problem, test pass rates) for a group"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/evals/aggregate",
                params={"group_id": group_id}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.patch("/eval/jobs/{job_id}/breakpoint")
async def proxy_update_breakpoint(job_id: str, body: dict):
    """Proxy: Update breakpoint duration for a running job"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.patch(
                f"{EVAL_API_BASE}/api/v1/evals/{job_id}/breakpoint",
                json=body
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/jobs/{job_id}")
async def proxy_get_eval_job(job_id: str):
    """Proxy: Get eval job by ID"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/evals/{job_id}")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=getattr(getattr(e, 'response', None), 'status_code', 500),
                          detail=f"Eval API error: {str(e)}")

@api_router.delete("/eval/jobs/{job_id}")
async def proxy_cancel_eval_job(job_id: str):
    """Proxy: Cancel eval job"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.delete(f"{EVAL_API_BASE}/api/v1/evals/{job_id}")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/stats")
async def proxy_eval_stats():
    """Proxy: Get eval queue stats - transforms array to object format"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/stats")
            response.raise_for_status()
            data = response.json()

            stats_obj = {
                "queued": 0,
                "generating": 0,
                "running": 0,
                "completed": 0,
                "failed": 0,
                "cancelled": 0
            }

            if "stats" in data:
                for item in data["stats"]:
                    status = item.get("status")
                    count = item.get("count", 0)
                    if status in stats_obj:
                        stats_obj[status] = count

            return stats_obj
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/groups/{group_id}/jobs")
async def proxy_group_eval_jobs(group_id: str, limit: int = 50, offset: int = 0):
    """Proxy: List all eval jobs for a group"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/groups/{group_id}/evals",
                params={"limit": limit, "offset": offset}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/datasets")
async def proxy_datasets(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Proxy: List all datasets"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/datasets",
                params={"limit": limit, "offset": offset}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/datasets/types/{dataset_type}")
async def proxy_datasets_by_type(
    dataset_type: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Proxy: List datasets filtered by type"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/datasets/types/{dataset_type}",
                params={"limit": limit, "offset": offset}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/datasets/types/{dataset_type}/instances/{instance_id}")
async def proxy_dataset_instance(dataset_type: str, instance_id: str):
    """Proxy: Get dataset by type and instance"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/datasets/types/{dataset_type}/instances/{instance_id}"
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        status_code = getattr(getattr(e, 'response', None), 'status_code', 500)
        raise HTTPException(status_code=status_code, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/datasets/by-name/{name:path}")
async def proxy_dataset_by_name(name: str):
    """Proxy: Get dataset by full name (e.g. scratch_bench_phased/instance_id)"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/datasets/by-name/{name}"
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        status_code = getattr(getattr(e, 'response', None), 'status_code', 500)
        raise HTTPException(status_code=status_code, detail=f"Eval API error: {str(e)}")


@api_router.post("/eval/datasets")
async def proxy_create_dataset(body: dict):
    """Proxy: Create a new dataset"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.post(f"{EVAL_API_BASE}/api/v1/datasets", json=body)
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(
                    status_code=response.status_code,
                    detail=err.get("message", err.get("error", str(err)))
                )
            data = response.json()
            # Auto-activate: if created with version 0 / is_active false, do an update
            if data.get("version") == 0 or data.get("is_active") is False:
                ds_id = data.get("id")
                if ds_id:
                    update_body = {
                        "dataset_type": body.get("dataset_type"),
                        "problem_statement": body.get("problem_statement", ""),
                        "natural_language_tests": body.get("natural_language_tests", ""),
                        "attributes": body.get("attributes", {}),
                        "description": body.get("description", ""),
                        "tags": body.get("tags", []),
                    }
                    update_resp = await hclient.put(
                        f"{EVAL_API_BASE}/api/v1/datasets/{ds_id}", json=update_body
                    )
                    if update_resp.status_code == 200:
                        return update_resp.json()
            return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.put("/eval/datasets/{dataset_id}")
async def proxy_update_dataset(dataset_id: str, body: dict):
    """Proxy: Update an existing dataset (creates new version)"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.put(f"{EVAL_API_BASE}/api/v1/datasets/{dataset_id}", json=body)
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(
                    status_code=response.status_code,
                    detail=err.get("message", err.get("error", str(err)))
                )
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.delete("/eval/datasets/{dataset_id}")
async def proxy_delete_dataset(dataset_id: str):
    """Proxy: Soft delete a dataset"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.delete(f"{EVAL_API_BASE}/api/v1/datasets/{dataset_id}")
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(
                    status_code=response.status_code,
                    detail=err.get("message", err.get("error", str(err)))
                )
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

# ── Scheduled Batches ───────────────────────────────────────────────────

@api_router.post("/eval/scheduled-batches")
async def proxy_create_scheduled_batch(body: dict):
    """Proxy: Create a new scheduled batch."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.post(f"{EVAL_API_BASE}/api/v1/scheduled-batches", json=body)
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(status_code=response.status_code,
                                    detail=err.get("message", err.get("error", str(err))))
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/scheduled-batches")
async def proxy_list_scheduled_batches(enabled: Optional[str] = None):
    """Proxy: List scheduled batches. Pass ?enabled=true to filter."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {}
            if enabled is not None:
                params["enabled"] = enabled
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/scheduled-batches", params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/scheduled-batches/{batch_id}")
async def proxy_get_scheduled_batch(batch_id: str):
    """Proxy: Get a scheduled batch by ID."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        status = getattr(getattr(e, 'response', None), 'status_code', 500)
        raise HTTPException(status_code=status, detail=f"Eval API error: {str(e)}")


@api_router.put("/eval/scheduled-batches/{batch_id}")
async def proxy_update_scheduled_batch(batch_id: str, body: dict):
    """Proxy: Update a scheduled batch."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.put(f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}", json=body)
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(status_code=response.status_code,
                                    detail=err.get("message", err.get("error", str(err))))
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.delete("/eval/scheduled-batches/{batch_id}")
async def proxy_delete_scheduled_batch(batch_id: str):
    """Proxy: Delete a scheduled batch."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.delete(f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.post("/eval/scheduled-batches/{batch_id}/trigger")
async def proxy_trigger_scheduled_batch(batch_id: str):
    """Proxy: Manually trigger a scheduled batch to fire now."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as hclient:
            response = await hclient.post(f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}/trigger")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/scheduled-batches/{batch_id}/runs")
async def proxy_list_scheduled_batch_runs(
    batch_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Proxy: List eval job runs fired by a scheduled batch.
    Each job has a group_run_id formatted as '{batch_id}-{YYYY-MM-DD}'
    representing one fire of the batch. Group client-side by group_run_id.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"limit": limit, "offset": offset}
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}/runs",
                params=params,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        status = getattr(getattr(e, 'response', None), 'status_code', 500)
        raise HTTPException(status_code=status, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/health")
async def proxy_eval_health():
    """Proxy: Check Eval API health"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as hclient:
            response = await hclient.get(f"{EVAL_API_BASE}/healthz")
            return {"healthy": response.status_code == 200}
    except Exception:
        return {"healthy": False}

@api_router.get("/builder/health")
async def proxy_builder_health():
    """Proxy: Check Builder API health"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as hclient:
            response = await hclient.get(f"{BUILDER_PROXY_BASE}/agents?source=all")
            return {"healthy": response.status_code == 200}
    except Exception:
        return {"healthy": False}

@api_router.get("/builder/models")
async def proxy_builder_models():
    """Proxy: Get available models from Builder API"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as hclient:
            response = await hclient.get(f"{BUILDER_PROXY_BASE}/models")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

@api_router.get("/builder/tools")
async def proxy_builder_tools():
    """Proxy: Get available tools from Builder API"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as hclient:
            response = await hclient.get(f"{BUILDER_PROXY_BASE}/tools")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

@api_router.get("/builder/prompts")
async def proxy_builder_prompts():
    """Proxy: Get available prompts from Builder API"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as hclient:
            response = await hclient.get(f"{BUILDER_PROXY_BASE}/prompts")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")


# ── Seed Data ────────────────────────────────────────────────────────────

SEED_AGENTS = [
    {
        "id": "e2-coding-assistant-claude-sonnet-4-5",
        "name": "E2 Coding Assistant",
        "version": 1,
        "description": "Elite full-stack developer agent for rapid application development using the FARM stack.",
        "agent_type": "EmergentAssistant",
        "tags": ["coding", "full-stack", "production"],
        "model": {
            "provider": "anthropic",
            "model_id": "claude-sonnet-4-5",
            "max_tokens": 16384,
            "temperature": 0.7,
            "context_window": 200000,
            "thinking": {"type": "enabled", "budget_tokens": 10000},
            "clear_thinking": {"keep_all": True},
        },
        "prompt": {"prompt_id": "e2_system_prompt_v3"},
        "toolsets": [
            {"type": "mcp", "name": "envcore", "url": "http://localhost:8080", "timeout": 30, "transport": "http", "required": True, "whitelisted_tool_names": ["mcp_execute_bash", "mcp_create_file", "mcp_view_file", "mcp_search_replace", "mcp_glob_files"]},
            {"type": "builtin", "tools": ["ask_human", "finish", "think"]},
            {"type": "subagent", "name": "testing-agent-v3-gpt-5-2-codex", "timeout": 300, "max_iterations": 50},
        ],
        "overrides": {
            "mcp_execute_bash": {"display_name": "Execute Bash", "tool_description": "Execute shell commands with timeout"},
            "mcp_create_file": {"display_name": "Create File", "tool_description": "Create or overwrite files"},
            "ask_human": {"display_name": "Ask Human", "tool_description": ""},
        },
        "runtime": {
            "max_iterations": 10000,
            "timeout": "50m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.7, "preserve_last_n": 5, "truncation_length": 8000},
            "auto_compact": {"enabled": False},
        },
        "hooks": {
            "communication_layer_override": {
                "prompt_name": "comm_layer_v2",
                "model_name": "claude-sonnet-4-5",
                "provider": "anthropic",
                "end_turn_enabled": True,
                "builtin_tools": ["ask_human", "finish"],
            }
        },
    },
    {
        "id": "research-analyst-claude-opus-4-6",
        "name": "Research Analyst",
        "version": 1,
        "description": "Deep research agent with extended thinking for complex analysis tasks.",
        "agent_type": "SkilledAssistant",
        "tags": ["research", "analysis", "deep-thinking"],
        "model": {
            "provider": "anthropic",
            "model_id": "claude-opus-4-6",
            "max_tokens": 32768,
            "temperature": 0.3,
            "context_window": 200000,
            "thinking": {"type": "enabled", "budget_tokens": 25000},
            "clear_thinking": {"keep_turns": 3},
        },
        "prompt": {"prompt_id": "research_analyst_v1"},
        "toolsets": [
            {"type": "mcp", "name": "web_search", "url": "http://localhost:8081", "timeout": 60, "transport": "http", "required": True, "whitelisted_tool_names": ["web_search_tool_v2", "crawl_tool"]},
            {"type": "builtin", "tools": ["think", "finish"]},
        ],
        "overrides": {
            "web_search_tool_v2": {"display_name": "Web Search", "tool_description": "Search the web for information"},
            "crawl_tool": {"display_name": "Page Crawler", "tool_description": "Extract content from web pages"},
        },
        "runtime": {
            "max_iterations": 5000,
            "timeout": "30m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.8, "preserve_last_n": 10, "truncation_length": 12000},
            "auto_compact": {"enabled": True, "strategy": "summarize", "threshold": 0.9, "last_n": 3, "summary_prompt_name": "compact_summary_v1"},
        },
        "hooks": {},
    },
    {
        "id": "code-review-bot-gpt-5-2-codex",
        "name": "Code Review Bot",
        "version": 1,
        "description": "Automated code reviewer using GPT Codex for pull request analysis.",
        "agent_type": "SkilledAssistant",
        "tags": ["code-review", "automation", "ci-cd"],
        "model": {
            "provider": "openai",
            "model_id": "gpt-5.2-codex",
            "max_tokens": 8192,
            "temperature": 0.2,
            "context_window": 128000,
            "thinking": {"type": "adaptive", "effort": "high"},
            "clear_thinking": {"keep_all": True},
        },
        "prompt": {"prompt_id": "code_review_system_v2"},
        "toolsets": [
            {"type": "mcp", "name": "envcore", "url": "http://localhost:8080", "timeout": 30, "transport": "http", "required": True, "whitelisted_tool_names": ["mcp_view_file", "mcp_glob_files", "mcp_execute_bash"]},
            {"type": "builtin", "tools": ["finish", "think"]},
        ],
        "overrides": {},
        "runtime": {
            "max_iterations": 2000,
            "timeout": "15m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.6, "preserve_last_n": 3, "truncation_length": 5000},
            "auto_compact": {"enabled": False},
        },
        "hooks": {},
    },
    {
        "id": "data-pipeline-agent-gemini-3-pro-preview",
        "name": "Data Pipeline Agent",
        "version": 1,
        "description": "Orchestrates data pipeline creation and monitoring using Gemini Pro.",
        "agent_type": "EmergentAssistant",
        "tags": ["data", "pipeline", "etl", "monitoring"],
        "model": {
            "provider": "gemini",
            "model_id": "gemini-3-pro-preview",
            "max_tokens": 16384,
            "temperature": 0.5,
            "context_window": 100000,
            "thinking": {"type": "disabled"},
            "clear_thinking": {"keep_all": True},
        },
        "prompt": {"prompt_id": "data_pipeline_v1"},
        "toolsets": [
            {"type": "mcp", "name": "envcore", "url": "http://localhost:8080", "timeout": 45, "transport": "http", "required": True, "whitelisted_tool_names": ["mcp_execute_bash", "mcp_create_file", "mcp_view_file"]},
            {"type": "builtin", "tools": ["ask_human", "finish", "emergent_integrations_manager", "think"]},
            {"type": "subagent", "name": "e2-coding-assistant-claude-sonnet-4-5", "timeout": 600, "max_iterations": 100},
        ],
        "overrides": {
            "mcp_execute_bash": {"display_name": "Run Pipeline", "tool_description": "Execute pipeline commands"},
        },
        "runtime": {
            "max_iterations": 8000,
            "timeout": "45m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.75, "preserve_last_n": 7, "truncation_length": 10000},
            "auto_compact": {"enabled": True, "strategy": "truncate", "threshold": 0.85, "last_n": 5, "summary_prompt_name": "pipeline_summary_v1", "target_agent_id": "e2-coding-assistant-claude-sonnet-4-5"},
        },
        "hooks": {
            "communication_layer_override": {
                "prompt_name": "pipeline_comm_v1",
                "model_name": "gemini-3-pro-preview",
                "provider": "gemini",
                "end_turn_enabled": False,
                "builtin_tools": ["finish"],
            }
        },
    },
    {
        "id": "customer-support-gpt-5-3-codex",
        "name": "Customer Support Agent",
        "version": 1,
        "description": "Conversational agent for handling customer inquiries with empathy.",
        "agent_type": "None",
        "tags": ["support", "conversational", "customer-facing"],
        "model": {
            "provider": "openai",
            "model_id": "gpt-5.3-codex",
            "max_tokens": 4096,
            "temperature": 0.8,
            "context_window": 128000,
            "thinking": {"type": "adaptive", "effort": "medium"},
            "clear_thinking": {"keep_turns": 5},
        },
        "prompt": {"prompt_id": "support_agent_v3"},
        "toolsets": [
            {"type": "builtin", "tools": ["ask_human", "finish"]},
        ],
        "overrides": {},
        "runtime": {
            "max_iterations": 500,
            "timeout": "10m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.5, "preserve_last_n": 15, "truncation_length": 6000},
            "auto_compact": {"enabled": False},
        },
        "hooks": {},
    },
    {
        "id": "supernova-vision-gemini-supernova",
        "name": "Supernova Vision",
        "version": 1,
        "description": "Multi-modal vision agent powered by Gemini Supernova for image analysis.",
        "agent_type": "SkilledAssistant",
        "tags": ["vision", "multi-modal", "image-analysis"],
        "model": {
            "provider": "gemini",
            "model_id": "supernova",
            "max_tokens": 8192,
            "temperature": 0.4,
            "context_window": 100000,
            "thinking": {"type": "enabled", "budget_tokens": 5000},
            "clear_thinking": {"keep_all": True},
        },
        "prompt": {"prompt_id": "vision_system_v1"},
        "toolsets": [
            {"type": "mcp", "name": "vision_tools", "url": "http://localhost:8082", "timeout": 120, "transport": "http", "required": True, "whitelisted_tool_names": ["analyze_file_tool", "extract_file_tool"]},
            {"type": "builtin", "tools": ["finish", "think"]},
        ],
        "overrides": {
            "analyze_file_tool": {"display_name": "Analyze Image", "tool_description": "Perform AI analysis on image files"},
            "extract_file_tool": {"display_name": "Extract Data", "tool_description": "Extract structured data from files"},
        },
        "runtime": {
            "max_iterations": 3000,
            "timeout": "20m",
            "context_management": {"squashing_strategy": "bulk_checkpoint", "threshold": 0.65, "preserve_last_n": 5, "truncation_length": 8000},
            "auto_compact": {"enabled": False},
        },
        "hooks": {},
    },
]


@app.on_event("startup")
async def startup():
    """Initialize services and seed database."""
    # Initialize agent service
    init_agent_service(db)
    
    # Seed database with sample agents if empty
    count = await db.agents.count_documents({})
    if count == 0:
        logging.info("Seeding database with sample agents...")
        for agent_data in SEED_AGENTS:
            now = datetime.now(timezone.utc).isoformat()
            agent_data["last_modified"] = now
            agent_data["created_at"] = now
            await db.agents.insert_one(copy.deepcopy(agent_data))
            version_doc = {
                "agent_id": agent_data["id"],
                "version": 1,
                "config": copy.deepcopy(agent_data),
                "timestamp": now,
                "change_summary": "Initial version",
            }
            await db.agent_versions.insert_one(version_doc)
        logging.info(f"Seeded {len(SEED_AGENTS)} agents.")
        # Create indexes
        await db.agents.create_index("id", unique=True)
        await db.agent_versions.create_index([("agent_id", 1), ("version", 1)], unique=True)
    else:
        logging.info(f"Database has {count} agents, skipping seed.")


# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
