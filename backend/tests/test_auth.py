"""Backend tests for Google-auth gated endpoints.

Covers:
- /api/auth/session with invalid session_id -> 401
- /api/auth/me unauthenticated -> 401
- /api/auth/logout idempotent -> 200 ok:true
- /api/auth/me with seeded session -> user_id is a valid UUID (not user_xxx)
"""
import os
import re
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to reading frontend/.env directly so tests can run locally.
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture()
def seeded_session(mongo):
    """Seed users + user_sessions and return (session_token, user_id)."""
    user_id = str(uuid.uuid4())
    session_token = f"test_session_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id[:8]}@emergent.com",
        "name": "Test User",
        "picture": "",
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield session_token, user_id
    mongo.user_sessions.delete_many({"session_token": session_token})
    mongo.users.delete_many({"user_id": user_id})


def test_auth_session_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "bogus-xyz"}, timeout=30)
    assert r.status_code == 401, f"Expected 401 got {r.status_code}: {r.text[:200]}"


def test_auth_me_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert r.status_code == 401


def test_auth_logout_no_cookie_idempotent():
    r = requests.post(f"{BASE_URL}/api/auth/logout", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True


def test_auth_me_with_seeded_session_returns_uuid(seeded_session):
    token, user_id = seeded_session
    r = requests.get(
        f"{BASE_URL}/api/auth/me",
        cookies={"session_token": token},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("user_id") == user_id
    assert UUID_RE.match(data["user_id"]), f"user_id is not a UUID: {data['user_id']}"
    assert not data["user_id"].startswith("user_"), "Legacy user_xxx prefix must not be used"
    # Ensure mongo _id is scrubbed
    assert "_id" not in data


def test_auth_me_expired_session(mongo):
    """Expired session rows should be rejected as 401 (and cleaned up)."""
    user_id = str(uuid.uuid4())
    token = f"test_expired_{uuid.uuid4().hex}"
    mongo.users.insert_one({"user_id": user_id, "email": f"TEST_exp_{user_id[:6]}@x.com", "name": "X"})
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
    })
    try:
        r = requests.get(f"{BASE_URL}/api/auth/me", cookies={"session_token": token}, timeout=30)
        assert r.status_code == 401
    finally:
        mongo.users.delete_many({"user_id": user_id})
        mongo.user_sessions.delete_many({"session_token": token})


def test_datasets_endpoint_has_no_auth_requirement():
    """Regression: dataset listing is shared and must not require auth."""
    r = requests.get(f"{BASE_URL}/api/eval/datasets?limit=1", timeout=30)
    # Either 200 (list) or 5xx from upstream harness; NOT 401.
    assert r.status_code != 401, "Datasets endpoint should not be gated"
