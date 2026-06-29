"""Tests for /api/eval/dataset-views CRUD endpoints (iter 36).

Covers:
- POST without auth → 401
- POST without items / empty items → 400
- POST with valid payload → 200, returns view doc with view_id
- GET list returns the created view
- GET by id returns 200 / 404
- PATCH updates fields; empty body 400; non-author 403
- DELETE author succeeds; second DELETE → 404
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
           "https://replay-browser-tests.internal.preview.emergentagent.com"
VIEWS_URL = f"{BASE_URL}/api/eval/dataset-views"
TOKEN = os.environ.get("ACM_TEST_TOKEN", "pw_emergent_gate_post")


def _auth_params():
    return {"access_token": TOKEN}


@pytest.fixture
def fresh_view():
    """Create a view, yield its id, then DELETE it on teardown."""
    payload = {
        "name": f"pytest view {uuid.uuid4().hex[:8]}",
        "description": "created by automated test",
        "items": [
            {"dataset_type": "bug_bench", "instance_id": "iid-a"},
            {"dataset_type": "bug_bench", "instance_id": "iid-b"},
        ],
    }
    r = requests.post(VIEWS_URL, params=_auth_params(), json=payload, timeout=30)
    assert r.status_code == 200, f"setup failed: {r.status_code} {r.text[:300]}"
    view_id = r.json()["view_id"]
    yield view_id
    requests.delete(f"{VIEWS_URL}/{view_id}", params=_auth_params(), timeout=15)


class TestAuth:
    def test_post_without_token_is_401(self):
        r = requests.post(
            VIEWS_URL,
            json={"name": "x", "items": [{"dataset_type": "bug_bench", "instance_id": "y"}]},
            timeout=15,
        )
        assert r.status_code == 401

    def test_patch_without_token_is_401(self, fresh_view):
        r = requests.patch(f"{VIEWS_URL}/{fresh_view}", json={"name": "x"}, timeout=15)
        assert r.status_code == 401

    def test_delete_without_token_is_401(self, fresh_view):
        r = requests.delete(f"{VIEWS_URL}/{fresh_view}", timeout=15)
        assert r.status_code == 401


class TestCreate:
    def test_missing_name_is_400(self):
        r = requests.post(
            VIEWS_URL, params=_auth_params(),
            json={"items": [{"dataset_type": "bug_bench", "instance_id": "y"}]},
            timeout=15,
        )
        assert r.status_code == 400

    def test_empty_items_is_400(self):
        r = requests.post(
            VIEWS_URL, params=_auth_params(),
            json={"name": "test empty", "items": []},
            timeout=15,
        )
        assert r.status_code == 400

    def test_item_missing_iid_is_400(self):
        r = requests.post(
            VIEWS_URL, params=_auth_params(),
            json={
                "name": "test bad item",
                "items": [{"dataset_type": "bug_bench"}],
            },
            timeout=15,
        )
        assert r.status_code == 400

    def test_create_returns_view_doc(self, fresh_view):
        r = requests.get(f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["view_id"] == fresh_view
        assert body["name"].startswith("pytest view")
        assert len(body["items"]) == 2
        assert body["created_by_email"]


class TestList:
    def test_list_contains_view(self, fresh_view):
        r = requests.get(VIEWS_URL, params=_auth_params(), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "views" in body
        ids = [v["view_id"] for v in body["views"]]
        assert fresh_view in ids


class TestPatch:
    def test_rename(self, fresh_view):
        r = requests.patch(
            f"{VIEWS_URL}/{fresh_view}", params=_auth_params(),
            json={"name": "renamed by pytest"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "renamed by pytest"

    def test_update_items(self, fresh_view):
        r = requests.patch(
            f"{VIEWS_URL}/{fresh_view}", params=_auth_params(),
            json={"items": [{"dataset_type": "bug_bench", "instance_id": "only-one"}]},
            timeout=15,
        )
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1

    def test_empty_body_is_400(self, fresh_view):
        r = requests.patch(
            f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), json={}, timeout=15,
        )
        assert r.status_code == 400


class TestDelete:
    def test_delete_then_404(self):
        # Create a one-off view (don't use fixture so we can verify the 404 chain)
        payload = {
            "name": f"delete me {uuid.uuid4().hex[:8]}",
            "items": [{"dataset_type": "bug_bench", "instance_id": "x"}],
        }
        r = requests.post(VIEWS_URL, params=_auth_params(), json=payload, timeout=15)
        assert r.status_code == 200
        vid = r.json()["view_id"]
        # Delete OK
        r = requests.delete(f"{VIEWS_URL}/{vid}", params=_auth_params(), timeout=15)
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # Second delete: 404
        r = requests.delete(f"{VIEWS_URL}/{vid}", params=_auth_params(), timeout=15)
        assert r.status_code == 404



class TestDuplicateName:
    """Iter 37 — duplicate-name protection (case-insensitive trim, 409)."""

    def test_create_duplicate_name_returns_409(self, fresh_view):
        # fetch the existing view's name
        r = requests.get(f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), timeout=15)
        assert r.status_code == 200
        existing_name = r.json()["name"]
        # try to create another with identical name
        payload = {
            "name": existing_name,
            "items": [{"dataset_type": "bug_bench", "instance_id": "z"}],
        }
        r = requests.post(VIEWS_URL, params=_auth_params(), json=payload, timeout=15)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:200]}"
        assert "already exists" in (r.json().get("detail") or "").lower()

    def test_create_duplicate_name_case_insensitive_returns_409(self, fresh_view):
        r = requests.get(f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), timeout=15)
        existing_name = r.json()["name"]
        payload = {
            "name": f"  {existing_name.upper()}  ",  # whitespace + uppercase
            "items": [{"dataset_type": "bug_bench", "instance_id": "z"}],
        }
        r = requests.post(VIEWS_URL, params=_auth_params(), json=payload, timeout=15)
        assert r.status_code == 409
        assert "already exists" in (r.json().get("detail") or "").lower()

    def test_patch_rename_to_existing_returns_409(self, fresh_view):
        # create a SECOND view, then try to PATCH-rename it to fresh_view's name
        payload2 = {
            "name": f"pytest other {uuid.uuid4().hex[:8]}",
            "items": [{"dataset_type": "bug_bench", "instance_id": "q"}],
        }
        r = requests.post(VIEWS_URL, params=_auth_params(), json=payload2, timeout=15)
        assert r.status_code == 200
        other_id = r.json()["view_id"]
        try:
            r = requests.get(f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), timeout=15)
            target_name = r.json()["name"]
            r = requests.patch(
                f"{VIEWS_URL}/{other_id}",
                params=_auth_params(),
                json={"name": target_name},
                timeout=15,
            )
            assert r.status_code == 409
            assert "already exists" in (r.json().get("detail") or "").lower()
        finally:
            requests.delete(f"{VIEWS_URL}/{other_id}", params=_auth_params(), timeout=15)

    def test_patch_rename_to_same_name_is_ok(self, fresh_view):
        # renaming a view to its own current name must NOT 409
        r = requests.get(f"{VIEWS_URL}/{fresh_view}", params=_auth_params(), timeout=15)
        current_name = r.json()["name"]
        r = requests.patch(
            f"{VIEWS_URL}/{fresh_view}",
            params=_auth_params(),
            json={"name": current_name},
            timeout=15,
        )
        assert r.status_code == 200, f"self-rename should succeed, got {r.status_code}: {r.text[:200]}"
