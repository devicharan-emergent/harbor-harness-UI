"""Unit tests for the @emergent* email allow-list gate using
httpx.MockTransport so the Emergent OAuth endpoint is never called for real.

Covers:
  - allowed domains (@emergent.sh, @emergent.com, @emergentagent.com, etc.) → 200
  - blocked domains (@example.com, @gmail.com, etc.) → 403 with the spec'd envelope
  - /auth/me on a session whose user has a now-blocked email → 401
    (the gate's invalidation path fires inside _get_session_user)

Implementation note: Motor's AsyncIOMotorClient caches connections inside
the event loop that first touched it. Starlette's TestClient spins up + tears
down its own loop on each call, which breaks Motor connections across calls
within the same process. We therefore use ONE module-scoped TestClient and
swap the OAuth response value via a mutable holder. DB cleanup is done via
a separate sync PyMongo client (different connection, different lifecycle).
"""
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import httpx
import pytest
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

_EMERGENT_RESP = {"value": {"email": "noop", "name": "", "picture": ""}}


@pytest.fixture(scope="module")
def sync_db():
    """Sync PyMongo handle for seed + cleanup. Same DB as the app uses,
    but a separate connection so it doesn't share Motor's event-loop pool."""
    c = MongoClient(os.environ["MONGO_URL"])
    yield c[os.environ.get("DB_NAME", "acm_db")]
    c.close()


@pytest.fixture(scope="module")
def client():
    """One TestClient for the whole module — Motor connections survive."""
    from fastapi.testclient import TestClient
    import server  # noqa: E402

    def handler(request: httpx.Request) -> httpx.Response:
        if "session-data" in str(request.url):
            return httpx.Response(200, json=_EMERGENT_RESP["value"])
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    original = httpx.AsyncClient

    class PatchedAsyncClient(original):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    server.httpx.AsyncClient = PatchedAsyncClient
    httpx.AsyncClient = PatchedAsyncClient

    with TestClient(server.app) as c:
        yield c

    server.httpx.AsyncClient = original
    httpx.AsyncClient = original


def _set_emergent_resp(email):
    _EMERGENT_RESP["value"] = {
        "email": email, "name": "T", "picture": "",
        "session_token": f"tok_{uuid.uuid4().hex}",
    }


def _cleanup(sync_db, email):
    user = sync_db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
    if user:
        sync_db.user_sessions.delete_many({"user_id": user["user_id"]})
    sync_db.users.delete_many({"email": email})


@pytest.mark.parametrize("email", [
    "alice@emergent.sh",
    "bob@emergent.com",
    "carol@emergentagent.com",
    "dave@emergent.dev",
    "eve@emergent-internal.io",
])
def test_allowed_domains_let_session_through(client, sync_db, email):
    _cleanup(sync_db, email)
    _set_emergent_resp(email)
    r = client.post("/api/auth/session", json={"session_id": "ignored-by-mock"})
    assert r.status_code == 200, f"{email} should be allowed, got {r.status_code}: {r.text[:200]}"
    assert r.json()["email"] == email
    _cleanup(sync_db, email)


@pytest.mark.parametrize("email", [
    "alice@example.com",
    "bob@gmail.com",
    "carol@notemergent.com",
    "dave@subdomain.emergent.sh",
    "eve@emerg.com",
])
def test_blocked_domains_return_403(client, email):
    _set_emergent_resp(email)
    r = client.post("/api/auth/session", json={"session_id": "ignored-by-mock"})
    assert r.status_code == 403, f"{email} should be blocked, got {r.status_code}"
    detail = r.json()["detail"]
    assert detail["error"] == "email_not_allowed"
    assert "@emergent" in detail["message"].lower()


def test_empty_email_rejected(client):
    _set_emergent_resp("")
    r = client.post("/api/auth/session", json={"session_id": "ignored"})
    assert r.status_code == 400


def test_session_for_blocked_email_returns_401_and_is_cleaned_up(client, sync_db):
    """A session row that was seeded BEFORE the gate landed (so the user
    row has a blocked email) must fail closed at /auth/me — and the
    session row should be deleted so the cookie can't be reused."""
    uid = str(uuid.uuid4())
    tok = f"blocked_{uuid.uuid4().hex}"

    sync_db.users.insert_one({
        "user_id": uid, "email": "leftover@gmail.com",
        "name": "Leftover", "picture": "",
        "created_at": datetime.now(timezone.utc),
    })
    sync_db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    try:
        r = client.get(f"/api/auth/me?access_token={tok}")
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
        assert sync_db.user_sessions.find_one({"session_token": tok}) is None, \
            "session for blocked-email user should be deleted"
    finally:
        sync_db.users.delete_many({"user_id": uid})
        sync_db.user_sessions.delete_many({"user_id": uid})
