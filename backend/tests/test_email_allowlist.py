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
    sync_db.allowlist.delete_many({"email": (email or "").lower()})


def _allow(sync_db, email, role="member", active=True):
    """Upsert an allow-list entry so an @emergent email can log in."""
    sync_db.allowlist.update_one(
        {"email": email.lower()},
        {"$set": {"email": email.lower(), "role": role, "active": active,
                  "added_by": "test", "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


@pytest.mark.parametrize("email", [
    "alice@emergent.sh",
    "bob@emergent.com",
    "carol@emergentagent.com",
    "dave@emergent.dev",
    "eve@emergent-internal.io",
])
def test_allowlisted_emergent_emails_let_session_through(client, sync_db, email):
    _cleanup(sync_db, email)
    _allow(sync_db, email)  # NEW gate: @emergent AND on the allow-list
    _set_emergent_resp(email)
    r = client.post("/api/auth/session", json={"session_id": "ignored-by-mock"})
    assert r.status_code == 200, f"{email} should be allowed, got {r.status_code}: {r.text[:200]}"
    assert r.json()["email"] == email
    assert r.json()["role"] == "member"
    _cleanup(sync_db, email)


@pytest.mark.parametrize("email", ["newjoiner@emergent.sh", "contractor@emergent.com"])
def test_emergent_email_not_on_allowlist_is_403(client, sync_db, email):
    """An @emergent email that no admin has added must be rejected."""
    _cleanup(sync_db, email)  # ensure NOT on the list
    _set_emergent_resp(email)
    r = client.post("/api/auth/session", json={"session_id": "ignored-by-mock"})
    assert r.status_code == 403, f"{email} not on list should be 403, got {r.status_code}"
    assert r.json()["detail"]["error"] == "email_not_allowed"
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


# ── Admin allow-list management ──────────────────────────────────────────
def _seed_session(sync_db, email, role):
    """Create an allow-listed user + a live session; return (token, user_id)."""
    uid = str(uuid.uuid4())
    tok = f"admintest_{uuid.uuid4().hex}"
    _allow(sync_db, email, role=role)
    sync_db.users.insert_one({
        "user_id": uid, "email": email.lower(), "name": "T", "picture": "",
        "created_at": datetime.now(timezone.utc),
    })
    sync_db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return tok, uid


def test_member_cannot_access_admin_api(client, sync_db):
    email = "member_probe@emergent.sh"
    _cleanup(sync_db, email)
    tok, uid = _seed_session(sync_db, email, role="member")
    try:
        r = client.get(f"/api/admin/users?access_token={tok}")
        assert r.status_code == 403, f"member should be 403, got {r.status_code}"
        assert r.json()["detail"]["error"] == "not_admin"
    finally:
        sync_db.user_sessions.delete_many({"user_id": uid})
        sync_db.users.delete_many({"user_id": uid})
        _cleanup(sync_db, email)


def test_admin_can_add_list_and_remove_user(client, sync_db):
    admin_email = "admin_probe@emergent.sh"
    target = "grantee_probe@emergent.sh"
    _cleanup(sync_db, admin_email)
    _cleanup(sync_db, target)
    tok, uid = _seed_session(sync_db, admin_email, role="admin")
    try:
        # add
        r = client.post(f"/api/admin/users?access_token={tok}", json={"email": target})
        assert r.status_code == 201, r.text[:200]
        assert r.json()["email"] == target and r.json()["role"] == "member"
        # the target can now log in (gate passes)
        _set_emergent_resp(target)
        rs = client.post("/api/auth/session", json={"session_id": "x"})
        assert rs.status_code == 200
        # list contains the target
        rl = client.get(f"/api/admin/users?access_token={tok}")
        assert rl.status_code == 200
        assert any(u["email"] == target for u in rl.json())
        # remove (soft) -> target gate now fails
        rd = client.delete(f"/api/admin/users/{target}?access_token={tok}")
        assert rd.status_code == 200 and rd.json()["active"] is False
        _set_emergent_resp(target)
        rs2 = client.post("/api/auth/session", json={"session_id": "x"})
        assert rs2.status_code == 403
    finally:
        sync_db.user_sessions.delete_many({"user_id": uid})
        sync_db.users.delete_many({"user_id": uid})
        _cleanup(sync_db, admin_email)
        _cleanup(sync_db, target)


def test_non_emergent_email_cannot_be_added(client, sync_db):
    admin_email = "admin_probe2@emergent.sh"
    _cleanup(sync_db, admin_email)
    tok, uid = _seed_session(sync_db, admin_email, role="admin")
    try:
        r = client.post(f"/api/admin/users?access_token={tok}", json={"email": "ext@gmail.com"})
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "invalid_email"
    finally:
        sync_db.user_sessions.delete_many({"user_id": uid})
        sync_db.users.delete_many({"user_id": uid})
        _cleanup(sync_db, admin_email)
        sync_db.allowlist.delete_many({"email": "ext@gmail.com"})
