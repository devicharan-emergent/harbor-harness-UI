from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Response, Cookie
import httpx
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import copy
import uuid
from urllib.parse import quote
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
    """Resolve current user from (in priority order): session_token cookie,
    Authorization: Bearer header, or ?access_token= query param.
    Returns a user dict (without _id) or None.

    The query-param fallback exists because the preview infra 307-redirects
    api traffic to an internal subdomain, and browsers strip the Authorization
    header on cross-origin redirects. Query params survive the redirect.
    """
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.query_params.get("access_token")
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
    # Enforce the allow-list on every resolve so sessions seeded before the
    # gate landed — or sessions for users whose email later fell out of the
    # allow-list — fail closed instead of silently working.
    if user_doc and not _is_allowed_email(user_doc.get("email")):
        await db.user_sessions.delete_many({"user_id": session_doc["user_id"]})
        return None
    return user_doc


class AuthSessionRequest(BaseModel):
    session_id: str


# Hardcoded user_id pins: if the authenticated email contains any of these
# substrings (case-insensitive), the user row is forced to the given UUID and
# any pre-existing user row/sessions for that email are migrated to it. This
# keeps `created_by` stamps stable for specific operators across re-logins
# and across environments where the email may have been seeded with a
# different random UUID.
PINNED_USER_IDS: list[tuple[str, str]] = [
    ("parth", "62c4dfe4-b032-4e03-8c3f-9fb5ad090836"),
    ("devi",  "01f477ee-0da0-4247-af41-a8dff6150681"),
]


def _pinned_user_id_for(email: str) -> Optional[str]:
    e = (email or "").lower()
    for substr, uid in PINNED_USER_IDS:
        if substr in e:
            return uid
    return None


# ── Email allow-list ────────────────────────────────────────────────────
# Only emails whose domain begins with the literal "emergent" are allowed
# to authenticate. Covers @emergent.sh, @emergent.com, @emergentagent.com,
# any future @emergent-* TLD, etc. No env override, no test-account
# exemption — every login (including dev seeding) must use a real
# @emergent* address.
def _is_allowed_email(email: Optional[str]) -> bool:
    if not email or "@" not in email:
        return False
    domain = email.rsplit("@", 1)[1].strip().lower()
    return domain.startswith("emergent")


async def _enforce_email_allowlist_or_die(email: Optional[str]) -> None:
    """Reject + log if the email is not on the allow-list. Used at /auth/session
    (block fresh logins) AND at every session resolve (kill existing sessions
    seeded before the gate landed, or sessions for users whose email changed).
    """
    if not _is_allowed_email(email):
        # Best-effort cleanup so the blocked email can't keep using a stale
        # cookie. Idempotent — safe if the row doesn't exist.
        if email:
            try:
                user_doc = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
                if user_doc:
                    await db.user_sessions.delete_many({"user_id": user_doc["user_id"]})
            except Exception:
                pass
        raise HTTPException(
            status_code=403,
            detail={
                "error": "email_not_allowed",
                "message": "Access restricted to Emergent team members. Sign in with an @emergent.* email address.",
            },
        )


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

    # Allow-list gate: only @emergent* email domains may sign in.
    await _enforce_email_allowlist_or_die(email)

    pinned = _pinned_user_id_for(email)

    # Upsert user (keyed by email so the same Google account = same row)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = pinned or existing["user_id"]
        # If the pinned id differs from the currently stored id, migrate
        # both the user row and any existing sessions so ownership stays
        # consistent after the switch.
        if pinned and existing["user_id"] != pinned:
            await db.user_sessions.update_many(
                {"user_id": existing["user_id"]},
                {"$set": {"user_id": pinned}},
            )
        await db.users.update_one(
            {"email": email},
            {"$set": {
                "user_id": user_id,
                "name": data.get("name", existing.get("name", "")),
                "picture": data.get("picture", existing.get("picture", "")),
            }},
        )
    else:
        user_id = pinned or str(uuid.uuid4())
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

    # Keep cookie for same-origin / first-party deployments; the frontend
    # primarily authenticates via Authorization: Bearer to avoid cross-origin
    # withCredentials preflight on Emergent's public->internal 307 trampoline.
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
        "session_token": session_token,
    }


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await _get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    # Accept token from cookie, Authorization: Bearer header, or ?access_token.
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.query_params.get("access_token")
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


# ---------------------------------------------------------------------------
# Cortex agent YAML CRUD (in-eph cortex_<eph>.agent_definitions table).
# Thin pass-through proxies — the harness owns validation and error envelopes.
# ---------------------------------------------------------------------------

async def _proxy_cortex(
    method: str, path: str, *,
    params: Optional[Dict[str, Any]] = None,
    json: Optional[Dict[str, Any]] = None,
):
    """Forward to {EVAL_API_BASE}{path}, surfacing harness JSON errors as-is."""
    async with httpx.AsyncClient(timeout=30.0) as hclient:
        resp = await hclient.request(method, f"{EVAL_API_BASE}{path}", params=params, json=json)
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = {"message": resp.text or "harness error"}
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return resp.json()


@api_router.get("/eval/cortex/ephs/exists")
async def proxy_cortex_eph_exists(eph_name: str = Query(...)):
    return await _proxy_cortex("GET", "/api/v1/cortex/ephs/exists", params={"eph_name": eph_name})


@api_router.get("/eval/cortex/agents")
async def proxy_cortex_list_agents(eph_name: str = Query(...)):
    return await _proxy_cortex("GET", "/api/v1/cortex/agents", params={"eph_name": eph_name})


@api_router.get("/eval/cortex/agents/{agent_id}")
async def proxy_cortex_get_agent(agent_id: str, eph_name: str = Query(...)):
    return await _proxy_cortex(
        "GET", f"/api/v1/cortex/agents/{quote(agent_id, safe='')}",
        params={"eph_name": eph_name},
    )


@api_router.post("/eval/cortex/agents")
async def proxy_cortex_create_agent(body: dict, eph_name: str = Query(...)):
    return await _proxy_cortex(
        "POST", "/api/v1/cortex/agents",
        params={"eph_name": eph_name}, json=body,
    )


@api_router.put("/eval/cortex/agents/{agent_id}")
async def proxy_cortex_update_agent(agent_id: str, body: dict, eph_name: str = Query(...)):
    return await _proxy_cortex(
        "PUT", f"/api/v1/cortex/agents/{quote(agent_id, safe='')}",
        params={"eph_name": eph_name}, json=body,
    )


@api_router.delete("/eval/cortex/agents/{agent_id}")
async def proxy_cortex_delete_agent(agent_id: str, eph_name: str = Query(...)):
    return await _proxy_cortex(
        "DELETE", f"/api/v1/cortex/agents/{quote(agent_id, safe='')}",
        params={"eph_name": eph_name},
    )


# Eph readiness — STUB until harness ships GET /api/v1/cortex/ephs/{eph}/readiness.
# Once that endpoint exists, replace the body with a single _proxy_cortex call
# to the same path. Keep this stub for local dev tooling so the UI can be
# reviewed today.
#
# Stub keying (per spec): cluster3-test → emergent:false (cron-cleaned),
# anything else → all three true. Exercises the partial-down UX path.
@api_router.get("/eval/cortex/ephs/{eph}/readiness")
async def proxy_cortex_eph_readiness(eph: str):
    if eph == "cluster3-test":
        return {
            "eph": eph,
            "db": True,
            "emergent": False,
            "cortex": True,
            "ready": False,
            "emergent_url": f"https://emergent-agents-{eph}-stub.run.app",
            "cortex_url": f"http://cortex-{eph}-stub.run.app",
            "message": (
                f"emergent agent-service for '{eph}' is unreachable "
                "(cron-cleaned?) — pick another eph or redeploy it."
            ),
        }
    return {
        "eph": eph,
        "db": True,
        "emergent": True,
        "cortex": True,
        "ready": True,
        "emergent_url": f"https://emergent-agents-{eph}-stub.run.app",
        "cortex_url": f"http://cortex-{eph}-stub.run.app",
        "message": "",
    }


@api_router.post("/eval/jobs-with-es")
async def proxy_submit_eval_with_es(body: dict):
    """Proxy → harness POST /api/v1/internal/evals-with-es.
    Pass-through. When `eph_name` is present, harness derives
    `emergent_agents_url` + per-eval `cortex_url` from it server-side and
    re-runs the readiness preflight. Fall-back (no eph_name) keeps the
    explicit-URL behavior for back-compat.
    """
    return await _proxy_cortex(
        "POST", "/api/v1/internal/evals-with-es", json=body,
    )


@api_router.post("/eval/testing-agent-evals")
async def proxy_submit_testing_agent_eval(body: dict):
    """Proxy → harness POST /api/v1/testing-agent-evals.

    Pass-through for the testing_agent_bench fork flow. The harness accepts
    a batched `items[]` body (one entry per dataset) with shared top-level
    `group_run_id` / `user_id` / `created_by` / `judge_prompt` /
    `judge_model`. Returns 202 with a `jobs` array. `created_by` is
    injected client-side via the axios interceptor; we forward the body as-is.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.post(
                f"{EVAL_API_BASE}/api/v1/testing-agent-evals", json=body,
            )
            if response.status_code >= 400:
                try:
                    err = response.json()
                except Exception:
                    err = {"message": response.text}
                raise HTTPException(
                    status_code=response.status_code,
                    detail=err.get("message", str(err)),
                )
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


# ── CSV import / export / template (per dataset_type) ──────────────────
# Adds bulk-create-by-CSV and round-trippable CSV export to /datasets.
# Harness stays JSON-only — all flattening + serialization lives here.
import csv
import io
from fastapi import UploadFile, File, Query
from fastapi.responses import Response

# Columns that map to TOP-LEVEL dataset fields. Everything else on a row
# (non-empty) goes into the per-row `attributes` object the bulk endpoint
# expects.
_CSV_COMMON_COLS = {
    "id", "name", "instance_id", "description", "tags",
    "problem_statement", "natural_language_tests", "base_image", "agent_name",
}

# Ordered list of common columns for export header (id+instance_id first
# so a quick eyeball of the CSV is identifying).
_CSV_COMMON_COLS_ORDER = [
    "id", "instance_id", "name", "description", "tags",
    "problem_statement", "natural_language_tests", "base_image", "agent_name",
]

# Attribute columns per dataset_type. MUST exactly match harness attribute
# field names so the round-trip (export → re-upload) is loss-less and
# bulk-create skips the existing rows.
_CSV_ATTR_COLS = {
    "scratch_bench_phased": [
        "subagents", "preview_url", "image", "auto_compact_strategy",
        "model_name", "system_prompt", "thinking_level", "hints", "nudge",
    ],
    "bug_bench": [
        "repo", "eph_job_id", "base_commit", "base_commit_squashed",
        "pull_number", "issue_number", "request_id", "image",
    ],
    "test_report_bench": [
        "repo", "eph_job_id", "testing_hitl",
        "Bug_description", "Bug_fix_status",
        "request_id", "base_commit", "pull_number", "issue_number",
    ],
    "testing_agent_bench": ["prod_job_id", "model_name"],
    "wingman_bench": [
        "wingman_id", "user_id", "expected_integrations",
        "max_iterations", "agent_id", "model_name",
    ],
}

# Per-type template rows shipped with the "Download template" link so
# new users get a working example to edit rather than a bare header.
_CSV_TEMPLATES = {
    "scratch_bench_phased": [
        {
            "instance_id": "example_public_notes",
            "problem_statement": "<problem>Build a simple public notes app where anyone can post a sticky note without signing in. Do NOT ask questions; build it all in one pass.</problem>",
            "natural_language_tests": "<phase><test>Visitor can create a note and it appears in the list.</test><test>Notes persist after page reload.</test></phase>",
            "model_name": "claude-sonnet-4-5",
        },
        {
            "instance_id": "example_notes_phased",
            "problem_statement": "<problem><phase>Phase 1: list + create notes.</phase><phase>Phase 2: add edit and delete.</phase></problem>",
            "natural_language_tests": "<phase><test>can create a note</test></phase><phase><test>can edit a note</test><test>can delete a note</test></phase>",
        },
    ],
    "bug_bench": [
        {
            "instance_id": "example_save_bug",
            "problem_statement": "Saving a record shows a success toast but the value is not persisted.",
            "natural_language_tests": "<test>Open the form, save a value, reload the page — the value is still there.</test>",
            "repo": "org/example-repo",
            "eph_job_id": "eph-abc123",
        },
    ],
    "test_report_bench": [
        {
            "instance_id": "example_test_report",
            "problem_statement": "Triage the failing test_report_bench run for the example app.",
            "natural_language_tests": "<test>Repro the failure, then confirm the fix resolves it.</test>",
            "repo": "org/example-repo",
            "eph_job_id": "eph-abc123",
            "testing_hitl": "The login button does nothing after entering credentials.",
            "Bug_description": "Login submit handler is wired to a no-op.",
            "Bug_fix_status": "pending",
        },
    ],
    "testing_agent_bench": [
        {
            "instance_id": "example_fork_job",
            "problem_statement": "Please continue with the task and report what you find.",
            "natural_language_tests": "1. The login button is unresponsive.\n2. The save button shows a toast but no persistence.",
            "agent_name": "testing-agent-v3-gpt-5-2-codex",
            "prod_job_id": "example_fork_job",
            "model_name": "claude-sonnet-4-5",
        },
    ],
    "wingman_bench": [
        {
            "instance_id": "example_wingman_task",
            "problem_statement": "Connect Slack and post a message to the team channel summarising open PRs.",
            "natural_language_tests": "<test>A summary message appears in #team-eng.</test>",
            "wingman_id": "wm-001",
            "user_id": "u-001",
            "expected_integrations": "slack,github",
            "max_iterations": "7",
            "model_name": "claude-sonnet-4-5",
        },
    ],
}


def _csv_row_to_item(row: dict, dataset_type: str) -> dict:
    """Flatten a single CSV row into a harness bulk-create item. Every
    non-empty column outside the common set lands in `attributes`."""
    attributes = {
        col: val for col, val in row.items()
        if col and col not in _CSV_COMMON_COLS and val != ""
    }
    # Only wingman_bench needs non-string attribute coercion (harness
    # attributes for the other types are all strings).
    if dataset_type == "wingman_bench":
        if "expected_integrations" in attributes:
            attributes["expected_integrations"] = [
                s.strip() for s in attributes["expected_integrations"].split(",") if s.strip()
            ]
        if "max_iterations" in attributes and str(attributes["max_iterations"]).strip():
            try:
                attributes["max_iterations"] = int(attributes["max_iterations"])
            except (TypeError, ValueError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"max_iterations must be an integer (got {attributes['max_iterations']!r}): {e}",
                )

    item = {
        "dataset_type": dataset_type,
        "instance_id": (row.get("instance_id") or "").strip(),
        "problem_statement": row.get("problem_statement", ""),
        "natural_language_tests": row.get("natural_language_tests", ""),
        "attributes": attributes,
    }
    for opt in ("name", "description", "base_image", "agent_name"):
        if (row.get(opt) or "").strip():
            item[opt] = row[opt]
    if (row.get("tags") or "").strip():
        item["tags"] = [t.strip() for t in row["tags"].split(",") if t.strip()]
    return item


def _csv_rows(text: str) -> list:
    """Yield non-blank rows from a CSV body string. Tolerates the UTF-8 BOM
    Excel adds by stripping it before parsing."""
    out = []
    for raw in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip(): (v or "") for k, v in raw.items()}
        if not any(v.strip() for v in row.values()):
            continue  # blank line
        out.append(row)
    return out


@api_router.post("/eval/datasets/import")
async def import_datasets_csv(
    dataset_type: str,
    files: list[UploadFile] = File(...),
):
    """Flatten uploaded CSV(s) → harness POST /api/v1/datasets/bulk.

    The selected `dataset_type` is stamped on every row (the CSV must
    NOT carry that column). Multiple files are concatenated in upload
    order, then row order — so `errors[].index` in the harness reply
    indexes into that combined stream. Existing `(dataset_type,
    instance_id)` rows are skipped; per-row failures are reported in
    `errors[]` while valid rows still get created.
    """
    if dataset_type not in _CSV_ATTR_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown dataset_type '{dataset_type}' "
                   f"(allowed: {sorted(_CSV_ATTR_COLS.keys())})",
        )
    items = []
    for f in files:
        try:
            text = (await f.read()).decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"{f.filename}: not valid UTF-8 ({e})",
            )
        for row in _csv_rows(text):
            items.append(_csv_row_to_item(row, dataset_type))
    if not items:
        raise HTTPException(status_code=400, detail="no data rows in uploaded CSV(s)")
    async with httpx.AsyncClient(timeout=120.0) as hclient:
        r = await hclient.post(
            f"{EVAL_API_BASE}/api/v1/datasets/bulk",
            json={"datasets": items},
        )
        try:
            body = r.json()
        except Exception:
            body = {"error": r.text}
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=body)
        return body


@api_router.get("/eval/datasets/export")
async def export_datasets_csv(
    dataset_type: str,
    instance_id: list[str] = Query(default=[]),
):
    """Round-trip CSV export. `instance_id` may be repeated to select a
    subset (preserves request order); omit to export every active row
    of the type. Output header matches the import format so an
    export → edit → re-import cycle works (existing rows come back
    `skipped`)."""
    if dataset_type not in _CSV_ATTR_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown dataset_type '{dataset_type}'",
        )
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=60.0) as hclient:
        if instance_id:
            for iid in instance_id:
                r = await hclient.get(
                    f"{EVAL_API_BASE}/api/v1/datasets/types/{dataset_type}"
                    f"/instances/{iid}",
                )
                if r.status_code == 404:
                    raise HTTPException(
                        status_code=404,
                        detail=f"not found: {dataset_type}/{iid}",
                    )
                r.raise_for_status()
                rows.append(r.json())
        else:
            offset = 0
            while True:
                r = await hclient.get(
                    f"{EVAL_API_BASE}/api/v1/datasets/types/{dataset_type}",
                    params={"limit": 200, "offset": offset},
                )
                r.raise_for_status()
                page = r.json().get("datasets", [])
                rows.extend(page)
                if len(page) < 200:
                    break
                offset += 200

    header = _CSV_COMMON_COLS_ORDER + _CSV_ATTR_COLS[dataset_type]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, extrasaction="ignore")
    w.writeheader()
    for d in rows:
        attrs = d.get("attributes") or {}
        rec = {
            "id": d.get("id", ""),
            "instance_id": d.get("instance_id", ""),
            "name": d.get("name", ""),
            "description": d.get("description", ""),
            "tags": ",".join(d.get("tags") or []),
            "problem_statement": d.get("problem_statement", ""),
            "natural_language_tests": d.get("natural_language_tests", ""),
            "base_image": d.get("base_image", ""),
            # Top-level agent_name wins over attribute fallback.
            "agent_name": d.get("agent_name", "") or attrs.get("agent_name", ""),
        }
        for col in _CSV_ATTR_COLS[dataset_type]:
            v = attrs.get(col, "")
            if isinstance(v, list):
                v = ",".join(map(str, v))
            elif v is None:
                v = ""
            else:
                v = str(v)
            rec[col] = v
        w.writerow(rec)

    if len(rows) == 1:
        fname = f"{dataset_type}_{rows[0].get('instance_id', 'export')}.csv"
    else:
        fname = f"{dataset_type}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api_router.get("/eval/datasets/template")
async def dataset_template_csv(dataset_type: str):
    """Return a starter CSV: the per-type header plus 1–2 filled example
    rows the user can edit. Helps new users avoid guessing the per-type
    required columns and the XML shape of `problem_statement` /
    `natural_language_tests`."""
    if dataset_type not in _CSV_ATTR_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown dataset_type '{dataset_type}'",
        )
    header = [
        "instance_id", "name", "description", "tags",
        "problem_statement", "natural_language_tests",
        "base_image", "agent_name",
    ] + _CSV_ATTR_COLS[dataset_type]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, extrasaction="ignore")
    w.writeheader()
    for row in _CSV_TEMPLATES.get(dataset_type, [{"instance_id": "example_instance"}]):
        w.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{dataset_type}_template.csv"',
        },
    )


# ── Verifier config (per-bench, Mongo-backed) ──────────────────────────
# One singleton doc per bench in collection `judge_config`, with _id = bench
# type ("testing_agent_bench" or "scratch_bench_phased"). On every submit
# the frontend stamps the saved prompt/model onto the harness request —
# different keys per bench (judge_* for testing_agent, browser_* in
# experiments for scratch). Legacy /eval/judge-config endpoints (kept
# below) alias to bench=testing_agent_bench so prior clients keep working.

DEFAULT_JUDGE_MODEL = "gemini-flash-latest"
DEFAULT_JUDGE_PROMPT = """You are evaluating a testing agent against a golden reference.

The GOLDEN output lists the bugs/issues that SHOULD be found. The TESTING AGENT output is what the agent actually reported. Match them by meaning (wording may differ; a golden bug counts as covered only if the agent clearly identified the same issue).

<golden_output>
{golden}
</golden_output>

<testing_agent_output>
{candidate}
</testing_agent_output>

Return ONLY a JSON object, no prose:
{"covered": ["<golden bug the agent found>", ...],
  "missed":  ["<golden bug the agent did NOT find>", ...],
  "extra":   ["<bug the agent reported that is NOT in golden>", ...]}

Every golden bug must appear in exactly one of "covered" or "missed"."""

DEFAULT_BROWSER_MODEL = "gemini-flash-latest"
DEFAULT_BROWSER_PROMPT = """You are a QA tester. The application under test is available at {preview_url}.

Open the URL and verify the test case below.

PRINCIPLES:
- You are an evaluator, not a problem-solver. Your job is to check whether the app works as described. If something is missing or broken, that IS your finding — report it as a failure and move on.
- If a UI element described in the test (button, icon, link, section) is not present after the page has loaded, you could refresh once and check if it still doesnt exists. You can try 1 logical workaround, if even that doesn't work. Fail that check.
- Try each action once. If it does not produce the expected result, fail that check. Do not retry the same action or attempt alternative ways to achieve the same outcome.
- DO NOT LOOP. Never repeat the same interaction to "re-confirm" something you already observed. If toggling or clicking a control once shows the expected change, that is sufficient — record it and move on.
- If an earlier step fails and later steps depend on it, mark those dependent steps as failed too.
- Once you have enough evidence to judge every check (passed or failed), emit your verdict immediately. Do not continue interacting with the app.

TEST CASE:
{test_case}"""

BENCH_VERIFIER_DEFAULTS = {
    "testing_agent_bench": {
        "model": DEFAULT_JUDGE_MODEL,
        "prompt": DEFAULT_JUDGE_PROMPT,
        "required_tokens": ["{golden}", "{candidate}"],
    },
    "scratch_bench_phased": {
        "model": DEFAULT_BROWSER_MODEL,
        "prompt": DEFAULT_BROWSER_PROMPT,
        "required_tokens": ["{preview_url}", "{test_case}"],
    },
}


def _ensure_known_bench(bench: str) -> None:
    if bench not in BENCH_VERIFIER_DEFAULTS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown bench '{bench}' (allowed: {sorted(BENCH_VERIFIER_DEFAULTS.keys())})",
        )


def _validate_verifier_prompt(prompt: str, bench: str) -> None:
    """Each bench has different required substitution tokens — both must
    appear at least once. Reject otherwise so the client gets the same
    error server-side. Other curly braces flow through untouched."""
    if not prompt or not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt cannot be empty")
    for tok in BENCH_VERIFIER_DEFAULTS[bench]["required_tokens"]:
        if tok not in prompt:
            raise HTTPException(
                status_code=400,
                detail=f"prompt must contain the literal token {tok}",
            )


async def _read_verifier_doc(bench: str) -> dict:
    """Read the bench's saved config, falling back to the legacy
    `_id='default'` doc for testing_agent_bench so existing customizations
    survive the rename. Returns a normalized {bench_type, prompt, model,
    is_default, updated_at} shape — defaults filled in when nothing saved.
    """
    defaults = BENCH_VERIFIER_DEFAULTS[bench]
    doc = await db.judge_config.find_one({"_id": bench})
    if not doc and bench == "testing_agent_bench":
        # Pre-iter-28 docs were stored under _id="default" with the
        # `judge_prompt` / `judge_model` field names. Adopt those as the
        # current testing_agent_bench config until the user re-saves.
        doc = await db.judge_config.find_one({"_id": "default"})
    if not doc:
        return {
            "bench_type": bench,
            "prompt": defaults["prompt"],
            "model": defaults["model"],
            "is_default": True,
            "updated_at": None,
        }
    return {
        "bench_type": bench,
        # Accept both new ("prompt"/"model") and legacy ("judge_prompt"
        # /"judge_model") field names.
        "prompt": doc.get("prompt") or doc.get("judge_prompt") or defaults["prompt"],
        "model": doc.get("model") or doc.get("judge_model") or defaults["model"],
        "is_default": False,
        "updated_at": doc.get("updated_at"),
    }


@api_router.get("/eval/verifier-config")
async def get_verifier_config(bench: str = "testing_agent_bench"):
    _ensure_known_bench(bench)
    return await _read_verifier_doc(bench)


@api_router.put("/eval/verifier-config")
async def update_verifier_config(body: dict, bench: str = "testing_agent_bench"):
    _ensure_known_bench(bench)
    prompt = (body.get("prompt") or "").strip()
    model = (body.get("model") or "").strip() or BENCH_VERIFIER_DEFAULTS[bench]["model"]
    _validate_verifier_prompt(prompt, bench)
    now = datetime.now(timezone.utc).isoformat()
    await db.judge_config.update_one(
        {"_id": bench},
        {"$set": {"prompt": prompt, "model": model, "updated_at": now}},
        upsert=True,
    )
    return {
        "bench_type": bench,
        "prompt": prompt,
        "model": model,
        "is_default": False,
        "updated_at": now,
    }


@api_router.post("/eval/verifier-config/reset")
async def reset_verifier_config(bench: str = "testing_agent_bench"):
    _ensure_known_bench(bench)
    await db.judge_config.delete_one({"_id": bench})
    # Also drop the pre-iter-28 doc so testing_agent_bench really resets.
    if bench == "testing_agent_bench":
        await db.judge_config.delete_one({"_id": "default"})
    defaults = BENCH_VERIFIER_DEFAULTS[bench]
    return {
        "bench_type": bench,
        "prompt": defaults["prompt"],
        "model": defaults["model"],
        "is_default": True,
        "updated_at": None,
    }


# ── Legacy aliases (kept for callers that still hit /judge-config) ─────


def _validate_judge_prompt(prompt: str) -> None:
    """Back-compat shim — delegate to the bench-aware validator."""
    _validate_verifier_prompt(prompt, "testing_agent_bench")


@api_router.get("/eval/judge-config")
async def get_judge_config():
    cfg = await _read_verifier_doc("testing_agent_bench")
    return {
        "judge_prompt": cfg["prompt"],
        "judge_model": cfg["model"],
        "is_default": cfg["is_default"],
        "updated_at": cfg["updated_at"],
    }


@api_router.put("/eval/judge-config")
async def update_judge_config(body: dict):
    cfg = await update_verifier_config(
        {"prompt": body.get("judge_prompt"), "model": body.get("judge_model")},
        bench="testing_agent_bench",
    )
    return {
        "judge_prompt": cfg["prompt"],
        "judge_model": cfg["model"],
        "is_default": cfg["is_default"],
        "updated_at": cfg["updated_at"],
    }


@api_router.post("/eval/judge-config/reset")
async def reset_judge_config():
    cfg = await reset_verifier_config(bench="testing_agent_bench")
    return {
        "judge_prompt": cfg["prompt"],
        "judge_model": cfg["model"],
        "is_default": cfg["is_default"],
        "updated_at": cfg["updated_at"],
    }



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

        # Per-user ownership (forwarded as-is)
        if body.get("created_by"):
            payload["created_by"] = body["created_by"]

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
    offset: int = Query(0, ge=0),
    created_by: Optional[str] = None,
):
    """Proxy: List eval jobs"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"limit": limit, "offset": offset}
            if status:
                params["status"] = status
            if created_by:
                params["created_by"] = created_by
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/evals", params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")

@api_router.get("/eval/jobs/aggregate")
async def proxy_eval_aggregate(
    group_id: str = Query(..., description="Group ID to aggregate"),
    created_by: Optional[str] = None,
):
    """Proxy: Get aggregate metrics (time per problem, test pass rates) for a group"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"group_id": group_id}
            if created_by:
                params["created_by"] = created_by
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/evals/aggregate",
                params=params,
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
async def proxy_get_eval_job(job_id: str, created_by: Optional[str] = None):
    """Proxy: Get eval job by ID"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"created_by": created_by} if created_by else None
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/evals/{job_id}", params=params,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=getattr(getattr(e, 'response', None), 'status_code', 500),
                          detail=f"Eval API error: {str(e)}")

@api_router.delete("/eval/jobs/{job_id}")
async def proxy_cancel_eval_job(job_id: str, created_by: Optional[str] = None):
    """Proxy: Cancel eval job"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"created_by": created_by} if created_by else None
            response = await hclient.delete(
                f"{EVAL_API_BASE}/api/v1/evals/{job_id}", params=params,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.post("/eval/jobs/{job_id}/prepare-for-ui")
async def proxy_prepare_eval_for_ui(job_id: str):
    """Proxy → harness POST /api/v1/evals/{eval_id}/prepare-for-ui.

    Backfills the agent-service rows needed to view a harbor eval in the
    chat UI. Idempotent. Returns the harness response body verbatim so
    the UI can read `cortex_job_id`, `eph`, and `repaired`. Surfaces
    harness 4xx/5xx errors with their original status code + JSON detail
    so the UI can render the spec'd toast messages.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            response = await hclient.post(
                f"{EVAL_API_BASE}/api/v1/evals/{job_id}/prepare-for-ui",
            )
            if response.status_code >= 400:
                try:
                    detail = response.json()
                except Exception:
                    detail = {"message": response.text or "harness error"}
                raise HTTPException(status_code=response.status_code, detail=detail)
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
async def proxy_group_eval_jobs(
    group_id: str,
    limit: int = 50,
    offset: int = 0,
    created_by: Optional[str] = None,
):
    """Proxy: List all eval jobs for a group"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"limit": limit, "offset": offset}
            if created_by:
                params["created_by"] = created_by
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/groups/{group_id}/evals",
                params=params,
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
async def proxy_list_scheduled_batches(
    enabled: Optional[str] = None,
    created_by: Optional[str] = None,
):
    """Proxy: List scheduled batches. Pass ?enabled=true to filter."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {}
            if enabled is not None:
                params["enabled"] = enabled
            if created_by:
                params["created_by"] = created_by
            response = await hclient.get(f"{EVAL_API_BASE}/api/v1/scheduled-batches", params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/scheduled-batches/{batch_id}")
async def proxy_get_scheduled_batch(batch_id: str, created_by: Optional[str] = None):
    """Proxy: Get a scheduled batch by ID."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"created_by": created_by} if created_by else None
            response = await hclient.get(
                f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}", params=params,
            )
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
async def proxy_delete_scheduled_batch(batch_id: str, created_by: Optional[str] = None):
    """Proxy: Delete a scheduled batch."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"created_by": created_by} if created_by else None
            response = await hclient.delete(
                f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}", params=params,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.post("/eval/scheduled-batches/{batch_id}/trigger")
async def proxy_trigger_scheduled_batch(batch_id: str, body: Optional[dict] = None):
    """Proxy: Manually trigger a scheduled batch to fire now."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as hclient:
            # Forward body (may carry created_by for ownership stamping).
            response = await hclient.post(
                f"{EVAL_API_BASE}/api/v1/scheduled-batches/{batch_id}/trigger",
                json=body or {},
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Eval API error: {str(e)}")


@api_router.get("/eval/scheduled-batches/{batch_id}/runs")
async def proxy_list_scheduled_batch_runs(
    batch_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    created_by: Optional[str] = None,
):
    """Proxy: List eval job runs fired by a scheduled batch.
    Each job has a group_run_id formatted as '{batch_id}-{YYYY-MM-DD}'
    representing one fire of the batch. Group client-side by group_run_id.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as hclient:
            params = {"limit": limit, "offset": offset}
            if created_by:
                params["created_by"] = created_by
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
    # CORS origins are env-driven so prod proxies (e.g. *.emergentcf.dev,
    # *.dev.apps.emergentagent.com) aren't blocked behind a hardcoded
    # regex. Format: comma-separated absolute origins, or "*" for any.
    allow_origins=(
        ["*"]
        if (os.environ.get("CORS_ORIGINS", "*").strip() in ("*", ""))
        else [o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()]
    ),
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
