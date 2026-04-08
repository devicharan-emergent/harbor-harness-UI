"""
Agent Service Abstraction Layer
Supports both MongoDB and Builder API backends with a feature flag.
Builder API mode now supports FULL CRUD (with per-agent restrictions for filesystem agents).
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone
import os
import copy
import re
import uuid
import httpx
import logging
from fastapi import HTTPException

logger = logging.getLogger(__name__)

BUILDER_API_BASE = os.environ.get(
    "BUILDER_API_BASE",
    "https://cortex-eph-builder-1035522277200.us-central1.run.app/api/v1/builder"
)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def slugify_underscore(text: str) -> str:
    """Builder API requires IDs matching ^[a-z0-9_]+$"""
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def generate_id(name: str, model_id: str) -> str:
    return f"{slugify(name)}-{slugify(model_id)}"


def generate_builder_id(name: str, model_id: str) -> str:
    return f"{slugify_underscore(name)}_{slugify_underscore(model_id)}"


def serialize_doc(doc):
    """Remove Mongo _id and ensure datetime serialisation, recursively."""
    if doc is None:
        return None
    if isinstance(doc, dict):
        doc.pop("_id", None)
        for k, v in doc.items():
            if isinstance(v, datetime):
                doc[k] = v.isoformat()
            elif isinstance(v, dict):
                serialize_doc(v)
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    if isinstance(item, dict):
                        serialize_doc(item)
    return doc


def clean_for_version(doc):
    """Deep copy a doc and remove all _id fields for safe version storage."""
    cleaned = copy.deepcopy(doc)
    serialize_doc(cleaned)
    return cleaned


def compute_change_summary(old_config: dict, new_config: dict) -> str:
    changes = []
    simple_keys = ["name", "description", "agent_type"]
    for k in simple_keys:
        ov = old_config.get(k)
        nv = new_config.get(k)
        if ov != nv:
            changes.append(f"Changed {k} from '{ov}' to '{nv}'")

    old_model = old_config.get("model", {})
    new_model = new_config.get("model", {})
    if old_model.get("provider") != new_model.get("provider"):
        changes.append(f"Changed provider from '{old_model.get('provider')}' to '{new_model.get('provider')}'")
    if old_model.get("model_id") != new_model.get("model_id"):
        changes.append(f"Changed model from '{old_model.get('model_id')}' to '{new_model.get('model_id')}'")

    old_ts = old_config.get("toolsets", [])
    new_ts = new_config.get("toolsets", [])
    if len(old_ts) != len(new_ts):
        changes.append(f"Toolsets changed from {len(old_ts)} to {len(new_ts)} entries")

    if not changes:
        changes.append("Configuration updated")
    return "; ".join(changes[:5])


class AgentService(ABC):
    """Abstract base class for agent data operations"""

    @abstractmethod
    async def list_agents(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[Dict]:
        pass

    @abstractmethod
    async def get_agent(self, agent_id: str) -> Dict:
        pass

    @abstractmethod
    async def create_agent(self, agent_data: Dict) -> Dict:
        pass

    @abstractmethod
    async def update_agent(self, agent_id: str, agent_data: Dict) -> Dict:
        pass

    @abstractmethod
    async def delete_agent(self, agent_id: str) -> Dict:
        pass

    @abstractmethod
    async def clone_agent(self, agent_id: str) -> Dict:
        pass

    @abstractmethod
    async def get_versions(self, agent_id: str) -> List[Dict]:
        pass

    @abstractmethod
    async def get_version(self, agent_id: str, version: int) -> Dict:
        pass

    @abstractmethod
    async def restore_version(self, agent_id: str, version: int) -> Dict:
        pass

    def get_capabilities(self) -> Dict:
        return {
            "read_only": False,
            "features": {
                "create": True,
                "update": True,
                "delete": True,
                "clone": True,
                "versions": True,
                "restore": True,
            }
        }


class MongoDBAgentService(AgentService):
    """MongoDB implementation of agent service - full CRUD"""

    def __init__(self, db):
        self.db = db
        self.agents_collection = db.agents
        self.versions_collection = db.agent_versions

    def get_capabilities(self) -> Dict:
        return {
            "data_source": "mongodb",
            "read_only": False,
            "features": {
                "create": True,
                "update": True,
                "delete": True,
                "clone": True,
                "versions": True,
                "restore": True,
            }
        }

    async def list_agents(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[Dict]:
        query = {}
        if search:
            query["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"description": {"$regex": search, "$options": "i"}},
                {"id": {"$regex": search, "$options": "i"}},
            ]
        if tags:
            tag_list = [t.strip() for t in tags.split(",")]
            query["tags"] = {"$in": tag_list}

        cursor = self.agents_collection.find(query).sort("created_at", -1)
        agents = await cursor.to_list(length=None)
        return [serialize_doc(agent) for agent in agents]

    async def get_agent(self, agent_id: str) -> Dict:
        agent = await self.agents_collection.find_one({"id": agent_id})
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        return serialize_doc(agent)

    async def create_agent(self, agent_data: Dict) -> Dict:
        now = datetime.now(timezone.utc).isoformat()
        model_id = agent_data.get("model", {}).get("model_id", "default")
        agent_id = agent_data.get("id") or generate_id(agent_data.get("name", "agent"), model_id)

        existing = await self.agents_collection.find_one({"id": agent_id})
        if existing:
            raise HTTPException(status_code=409, detail=f"Agent with id '{agent_id}' already exists")

        doc = {**agent_data}
        doc["id"] = agent_id
        doc["version"] = 1
        doc["last_modified"] = now
        doc["created_at"] = now

        await self.agents_collection.insert_one(copy.deepcopy(doc))

        version_doc = {
            "agent_id": agent_id,
            "version": 1,
            "config": clean_for_version(doc),
            "timestamp": now,
            "change_summary": "Initial version",
        }
        await self.versions_collection.insert_one(version_doc)
        return serialize_doc(doc)

    async def update_agent(self, agent_id: str, agent_data: Dict) -> Dict:
        existing = await self.agents_collection.find_one({"id": agent_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Agent not found")

        now = datetime.now(timezone.utc).isoformat()
        new_version = existing.get("version", 1) + 1
        existing_clean = serialize_doc(copy.deepcopy(existing))

        doc = {**agent_data}
        doc["id"] = agent_id
        doc["version"] = new_version
        doc["last_modified"] = now
        doc["created_at"] = existing.get("created_at", now)
        if isinstance(doc["created_at"], datetime):
            doc["created_at"] = doc["created_at"].isoformat()

        change_summary = compute_change_summary(existing_clean, doc)
        await self.agents_collection.replace_one({"id": agent_id}, copy.deepcopy(doc))

        version_doc = {
            "agent_id": agent_id,
            "version": new_version,
            "config": clean_for_version(doc),
            "timestamp": now,
            "change_summary": change_summary,
        }
        await self.versions_collection.insert_one(version_doc)
        return serialize_doc(doc)

    async def delete_agent(self, agent_id: str) -> Dict:
        result = await self.agents_collection.delete_one({"id": agent_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Agent not found")
        await self.versions_collection.delete_many({"agent_id": agent_id})
        return {"message": "Agent deleted"}

    async def clone_agent(self, agent_id: str) -> Dict:
        source = await self.agents_collection.find_one({"id": agent_id})
        if not source:
            raise HTTPException(status_code=404, detail="Agent not found")

        now = datetime.now(timezone.utc).isoformat()
        new_name = f"{source['name']}_copy"
        new_id = generate_id(new_name, source.get("model", {}).get("model_id", "default"))

        counter = 1
        base_id = new_id
        while await self.agents_collection.find_one({"id": new_id}):
            counter += 1
            new_id = f"{base_id}-{counter}"

        clone = serialize_doc(copy.deepcopy(source))
        clone["id"] = new_id
        clone["name"] = new_name
        clone["version"] = 1
        clone["last_modified"] = now
        clone["created_at"] = now

        await self.agents_collection.insert_one(copy.deepcopy(clone))

        version_doc = {
            "agent_id": new_id,
            "version": 1,
            "config": clean_for_version(clone),
            "timestamp": now,
            "change_summary": f"Cloned from {source['name']}",
        }
        await self.versions_collection.insert_one(version_doc)
        return serialize_doc(clone)

    async def get_versions(self, agent_id: str) -> List[Dict]:
        versions = await self.versions_collection.find(
            {"agent_id": agent_id}
        ).sort("version", -1).to_list(1000)
        for v in versions:
            serialize_doc(v)
        return versions

    async def get_version(self, agent_id: str, version: int) -> Dict:
        ver = await self.versions_collection.find_one(
            {"agent_id": agent_id, "version": version}
        )
        if not ver:
            raise HTTPException(status_code=404, detail="Version not found")
        return serialize_doc(ver)

    async def restore_version(self, agent_id: str, version: int) -> Dict:
        ver = await self.versions_collection.find_one(
            {"agent_id": agent_id, "version": version}
        )
        if not ver:
            raise HTTPException(status_code=404, detail="Version not found")

        current = await self.agents_collection.find_one({"id": agent_id})
        if not current:
            raise HTTPException(status_code=404, detail="Agent not found")

        now = datetime.now(timezone.utc).isoformat()
        new_version_num = current.get("version", 1) + 1

        restored = copy.deepcopy(ver["config"])
        serialize_doc(restored)
        restored["id"] = agent_id
        restored["version"] = new_version_num
        restored["last_modified"] = now

        await self.agents_collection.replace_one({"id": agent_id}, copy.deepcopy(restored))

        version_doc = {
            "agent_id": agent_id,
            "version": new_version_num,
            "config": clean_for_version(restored),
            "timestamp": now,
            "change_summary": f"Restored from version {version}",
        }
        await self.versions_collection.insert_one(version_doc)
        return serialize_doc(restored)


# ─── Builder API Transformations ────────────────────────────────────────────

def _builder_list_to_acm(agent: Dict) -> Dict:
    """Transform Builder API list-format agent to ACM flat format."""
    return {
        "id": agent.get("id", ""),
        "name": agent.get("name", agent.get("id", "")),
        "description": agent.get("description", ""),
        "agent_type": agent.get("agent_type", ""),
        "tags": agent.get("tags") or [],
        "version": agent.get("version", 1),
        "source": agent.get("source", "unknown"),
        "model": {
            "provider": agent.get("model_provider", ""),
            "model_id": agent.get("model_id", ""),
        },
        "created_at": agent.get("created_at"),
        "last_modified": agent.get("updated_at"),
    }


def _builder_detail_to_acm(agent: Dict) -> Dict:
    """Transform Builder API detail-format (nested metadata/spec) to ACM flat format."""
    metadata = agent.get("metadata") or {}
    spec = agent.get("spec") or {}
    model = spec.get("model") or {}

    return {
        "id": agent.get("id", metadata.get("id", "")),
        "name": metadata.get("name", agent.get("id", "")),
        "description": metadata.get("description", ""),
        "agent_type": metadata.get("agent_type", ""),
        "tags": metadata.get("tags") or [],
        "version": metadata.get("version", 1),
        "source": agent.get("source", "unknown"),
        "model": {
            "provider": model.get("provider", ""),
            "model_id": model.get("id", ""),
            "max_tokens": model.get("max_tokens"),
            "temperature": model.get("temperature"),
            "context_window": model.get("context_window"),
        },
        "prompt": spec.get("prompt") or {},
        "toolsets": spec.get("toolsets") or [],
        "overrides": spec.get("overrides") or {},
        "runtime": _convert_policy_to_runtime(spec.get("policy") or {}),
        "context_management": spec.get("context") or {},
        "hooks": spec.get("hooks") or {},
        "yaml_content": agent.get("yaml_content"),
        "created_at": agent.get("created_at"),
        "last_modified": agent.get("updated_at"),
    }


def _convert_policy_to_runtime(policy: Dict) -> Dict:
    """Convert Builder API policy (with nanosecond durations) to ACM runtime (human-readable)."""
    if not policy:
        return {}
    runtime = {**policy}
    if "timeout" in runtime and isinstance(runtime["timeout"], (int, float)):
        runtime["timeout"] = _ns_to_duration(runtime["timeout"])
    return runtime


def _duration_to_ns(val):
    """Convert a duration string like '50m', '2h', '30s' to nanoseconds (int) for Go time.Duration."""
    if isinstance(val, (int, float)):
        return int(val)
    if not isinstance(val, str):
        return 0
    val = val.strip()
    if not val:
        return 0
    multipliers = {'ns': 1, 'us': 1_000, 'ms': 1_000_000, 's': 1_000_000_000, 'm': 60_000_000_000, 'h': 3_600_000_000_000}
    for suffix, mult in sorted(multipliers.items(), key=lambda x: -len(x[0])):
        if val.endswith(suffix):
            try:
                return int(float(val[:-len(suffix)]) * mult)
            except ValueError:
                return 0
    try:
        return int(float(val) * 1_000_000_000)
    except ValueError:
        return 0


def _ns_to_duration(ns):
    """Convert nanoseconds (int) back to a human-readable duration string."""
    if not ns or not isinstance(ns, (int, float)):
        return ""
    ns = int(ns)
    if ns >= 3_600_000_000_000:
        return f"{ns / 3_600_000_000_000:.0f}h"
    if ns >= 60_000_000_000:
        return f"{ns / 60_000_000_000:.0f}m"
    if ns >= 1_000_000_000:
        return f"{ns / 1_000_000_000:.0f}s"
    return f"{ns}ns"


def _acm_to_builder_payload(agent_data: Dict, agent_id: str = None) -> Dict:
    """Transform ACM flat format to Builder API create/update payload."""
    aid = agent_id or agent_data.get("id", "")
    model = agent_data.get("model", {})

    # Ensure toolsets have required 'name' field
    toolsets = []
    for ts in (agent_data.get("toolsets") or []):
        ts_copy = {**ts}
        if "name" not in ts_copy or not ts_copy["name"]:
            ts_copy["name"] = ts_copy.get("type", "unnamed")
        toolsets.append(ts_copy)

    payload = {
        "id": aid,
        "metadata": {
            "id": aid,
            "name": agent_data.get("name", aid),
            "version": agent_data.get("version", 1) or 1,
            "description": agent_data.get("description", ""),
            "agent_type": agent_data.get("agent_type", ""),
            "tags": agent_data.get("tags") or [],
        },
        "spec": {
            "model": {
                "provider": model.get("provider", ""),
                "id": model.get("model_id", model.get("id", "")),
                "max_tokens": model.get("max_tokens", 16384),
                "temperature": model.get("temperature", 0),
            },
            "prompt": agent_data.get("prompt") or {},
            "toolsets": toolsets,
        },
    }

    # Add optional spec sections (overrides must be an object, not an array)
    overrides = agent_data.get("overrides")
    if overrides:
        if isinstance(overrides, list):
            # Convert legacy array format to object keyed by name
            overrides = {item["name"]: {k: v for k, v in item.items() if k != "name"} for item in overrides if "name" in item}
        payload["spec"]["overrides"] = overrides
    if agent_data.get("runtime"):
        policy = {**agent_data["runtime"]}
        # Convert timeout string to nanoseconds for Go time.Duration
        if "timeout" in policy and isinstance(policy["timeout"], str):
            policy["timeout"] = _duration_to_ns(policy["timeout"])
        payload["spec"]["policy"] = policy
    if agent_data.get("context_management"):
        payload["spec"]["context"] = agent_data["context_management"]
    if agent_data.get("hooks"):
        payload["spec"]["hooks"] = agent_data["hooks"]

    return payload


class BuilderAPIAgentService(AgentService):
    """Builder API implementation - Full CRUD with per-agent restrictions.
    
    - `source: filesystem` agents are READ-ONLY (cannot edit/delete).
    - `source: database` agents support full CRUD.
    """

    def __init__(self):
        self.base_url = BUILDER_API_BASE
        self.timeout = 30.0

    def get_capabilities(self) -> Dict:
        return {
            "data_source": "builder_api",
            "read_only": False,
            "features": {
                "create": True,
                "update": True,
                "delete": True,
                "clone": True,
                "versions": False,
                "restore": False,
            },
            "message": "Builder API mode. Filesystem agents are read-only; database agents support full CRUD."
        }

    async def list_agents(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[Dict]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                params = {"source": "all"}
                response = await client.get(f"{self.base_url}/agents", params=params)
                if response.status_code == 404:
                    return []
                response.raise_for_status()
                data = response.json()
                agents = data.get("agents", data if isinstance(data, list) else [])
                result = [_builder_list_to_acm(a) for a in agents if a]

                # Client-side search filtering
                if search:
                    q = search.lower()
                    result = [
                        a for a in result
                        if q in (a.get("name") or "").lower()
                        or q in (a.get("description") or "").lower()
                        or q in (a.get("id") or "").lower()
                    ]
                if tags:
                    tag_list = [t.strip().lower() for t in tags.split(",")]
                    result = [
                        a for a in result
                        if any(t.lower() in tag_list for t in (a.get("tags") or []))
                    ]
                return result
        except httpx.ConnectError:
            logger.warning("Builder API unreachable")
            return []
        except Exception as e:
            logger.warning(f"Builder API list error: {e}")
            return []

    async def get_agent(self, agent_id: str) -> Dict:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}/agents/{agent_id}")
                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail="Agent not found in Builder API")
                response.raise_for_status()
                return _builder_detail_to_acm(response.json())
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Builder API get error: {e}")
            raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

    async def create_agent(self, agent_data: Dict) -> Dict:
        model = agent_data.get("model", {})
        model_id = model.get("model_id", model.get("id", "default"))
        agent_id = agent_data.get("id") or generate_builder_id(
            agent_data.get("name", "agent"), model_id
        )
        # Ensure version >= 1 (Builder API workaround)
        agent_data.setdefault("version", 1)

        payload = _acm_to_builder_payload(agent_data, agent_id)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/agents",
                    json=payload
                )
                if response.status_code in (400, 409, 422):
                    err = response.json()
                    detail = err.get("message", err.get("errors", str(err)))
                    raise HTTPException(status_code=response.status_code, detail=detail)
                response.raise_for_status()
                return _builder_detail_to_acm(response.json())
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Builder API create error: {e}")
            raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

    async def update_agent(self, agent_id: str, agent_data: Dict) -> Dict:
        # Check if the agent is filesystem-sourced (can't edit)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                check = await client.get(f"{self.base_url}/agents/{agent_id}")
                if check.status_code == 200:
                    existing = check.json()
                    if existing.get("source") == "filesystem":
                        raise HTTPException(
                            status_code=403,
                            detail="Cannot edit filesystem agents. They are managed externally."
                        )
        except HTTPException:
            raise
        except Exception:
            pass  # If check fails, try the update anyway

        agent_data.setdefault("version", 1)
        payload = _acm_to_builder_payload(agent_data, agent_id)
        # For update, send only metadata + spec (no id at top level)
        update_body = {"metadata": payload["metadata"], "spec": payload["spec"]}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.put(
                    f"{self.base_url}/agents/{agent_id}",
                    json=update_body
                )
                if response.status_code in (400, 403, 404, 422):
                    err = response.json()
                    detail = err.get("message", err.get("errors", str(err)))
                    raise HTTPException(status_code=response.status_code, detail=detail)
                response.raise_for_status()
                return _builder_detail_to_acm(response.json())
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Builder API update error: {e}")
            raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

    async def delete_agent(self, agent_id: str) -> Dict:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.delete(f"{self.base_url}/agents/{agent_id}")
                if response.status_code == 400:
                    err = response.json()
                    detail = err.get("message", str(err))
                    if "filesystem" in detail.lower():
                        raise HTTPException(
                            status_code=403,
                            detail="Cannot delete filesystem agents. They are managed externally."
                        )
                    raise HTTPException(status_code=400, detail=detail)
                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail="Agent not found")
                response.raise_for_status()
                return {"message": "Agent deleted"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Builder API delete error: {e}")
            raise HTTPException(status_code=502, detail=f"Builder API error: {str(e)}")

    async def clone_agent(self, agent_id: str) -> Dict:
        """Clone by fetching the source agent and creating a new one."""
        source = await self.get_agent(agent_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source agent not found")

        new_name = f"{source.get('name', agent_id)}_copy"
        model = source.get("model", {})
        model_id = model.get("model_id", model.get("id", "default"))
        new_id = generate_builder_id(new_name, model_id)

        clone_data = copy.deepcopy(source)
        clone_data["id"] = new_id
        clone_data["name"] = new_name
        clone_data["version"] = 1
        clone_data.pop("yaml_content", None)
        clone_data.pop("source", None)
        clone_data.pop("created_at", None)
        clone_data.pop("last_modified", None)

        return await self.create_agent(clone_data)

    async def get_versions(self, agent_id: str) -> List[Dict]:
        # Builder API does not have a version history endpoint
        return []

    async def get_version(self, agent_id: str, version: int) -> Dict:
        raise HTTPException(
            status_code=501,
            detail="Version history is not available in Builder API mode."
        )

    async def restore_version(self, agent_id: str, version: int) -> Dict:
        raise HTTPException(
            status_code=501,
            detail="Version restore is not available in Builder API mode."
        )


# ─── Service Instance Management ────────────────────────────────────────────

_current_service: Optional[AgentService] = None


def init_agent_service(db) -> AgentService:
    global _current_service
    use_builder = os.getenv("USE_BUILDER_API", "false").lower() == "true"

    if use_builder:
        _current_service = BuilderAPIAgentService()
        logger.info(f"Agent service initialized: BuilderAPIAgentService ({BUILDER_API_BASE})")
    else:
        _current_service = MongoDBAgentService(db)
        logger.info("Agent service initialized: MongoDBAgentService")

    return _current_service


def get_current_service() -> AgentService:
    if _current_service is None:
        raise RuntimeError("Agent service not initialized. Call init_agent_service() first.")
    return _current_service
