"""Verifies that every eval-proxy endpoint in server.py forwards `created_by`
to the harness-eval backend. Uses httpx.MockTransport to intercept every
outbound httpx.AsyncClient call and record the final URL + body.

Covers endpoints listed in iter19:
  (a) POST /eval/jobs                              -> body
  (b) GET  /eval/jobs?created_by=X                 -> query
  (c) GET  /eval/jobs/{id}?created_by=X            -> query
  (d) DELETE /eval/jobs/{id}?created_by=X          -> query
  (e) GET  /eval/jobs/aggregate?group_id&created_by -> query
  (f) GET  /eval/groups/{gid}/jobs?created_by=X    -> query
  (g) GET  /eval/scheduled-batches?created_by=X    -> query
  (h) GET  /eval/scheduled-batches/{id}?created_by=X -> query
  (i) DELETE /eval/scheduled-batches/{id}?created_by=X -> query
  (j) GET  /eval/scheduled-batches/{id}/runs?created_by=X -> query
  (k) POST /eval/scheduled-batches/{id}/trigger    -> body
"""
import os
import sys
import json
import pytest
import httpx
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, "/app/backend")

USER_ID = "0ee59a27-db9c-4647-aeee-f72173fcd757"


@pytest.fixture
def captured():
    return []


@pytest.fixture
def client(monkeypatch, captured):
    """Patch httpx.AsyncClient so every outbound call is recorded + stubbed.
    Then returns a FastAPI TestClient wired to server.app."""
    from fastapi.testclient import TestClient
    import server  # noqa: E402

    def handler(request: httpx.Request) -> httpx.Response:
        body = None
        if request.content:
            try:
                body = json.loads(request.content.decode("utf-8"))
            except Exception:
                body = request.content.decode("utf-8", errors="replace")
        captured.append({
            "method": request.method,
            "url": str(request.url),
            "path": request.url.path,
            "query": dict(request.url.params),
            "body": body,
        })
        # Minimal generic success shape – each proxy just returns .json()
        return httpx.Response(200, json={"ok": True, "jobs": [], "batches": []})

    transport = httpx.MockTransport(handler)
    original = httpx.AsyncClient

    class PatchedAsyncClient(original):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(server.httpx, "AsyncClient", PatchedAsyncClient)
    monkeypatch.setattr(httpx, "AsyncClient", PatchedAsyncClient)

    return TestClient(server.app)


# (a) POST /api/eval/jobs -> body.created_by forwarded
def test_submit_eval_forwards_created_by_in_body(client, captured):
    r = client.post("/api/eval/jobs", json={
        "user_id": USER_ID,
        "created_by": USER_ID,
        "evals": [{"problem": "scratch_bench_phased/aureus-monitor"}],
    })
    assert r.status_code == 200, r.text
    assert len(captured) == 1
    call = captured[0]
    assert call["method"] == "POST"
    assert call["path"].endswith("/api/v1/evals")
    assert call["body"]["created_by"] == USER_ID
    assert call["body"]["user_id"] == USER_ID
    assert call["body"]["evals"][0]["problem"] == "scratch_bench_phased/aureus-monitor"


# (b) GET /api/eval/jobs?created_by=X -> query forwarded
def test_list_eval_jobs_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/jobs?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert captured[0]["path"].endswith("/api/v1/evals")


# (c) GET /api/eval/jobs/{id}?created_by=X
def test_get_eval_job_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/jobs/job-123?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert "/api/v1/evals/job-123" in captured[0]["path"]


# (d) DELETE /api/eval/jobs/{id}?created_by=X
def test_cancel_eval_job_forwards_created_by_query(client, captured):
    r = client.delete(f"/api/eval/jobs/job-123?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["method"] == "DELETE"
    assert captured[0]["query"].get("created_by") == USER_ID


# (e) GET /api/eval/jobs/aggregate?group_id=G&created_by=X
def test_aggregate_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/jobs/aggregate?group_id=grp-1&created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("group_id") == "grp-1"
    assert captured[0]["query"].get("created_by") == USER_ID


# (f) GET /api/eval/groups/{gid}/jobs?created_by=X
def test_group_jobs_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/groups/grp-1/jobs?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert "/api/v1/groups/grp-1/evals" in captured[0]["path"]


# (g) GET /api/eval/scheduled-batches?created_by=X
def test_list_scheduled_batches_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/scheduled-batches?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert captured[0]["path"].endswith("/api/v1/scheduled-batches")


# (h) GET /api/eval/scheduled-batches/{id}?created_by=X
def test_get_scheduled_batch_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/scheduled-batches/b-1?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert "/api/v1/scheduled-batches/b-1" in captured[0]["path"]


# (i) DELETE /api/eval/scheduled-batches/{id}?created_by=X
def test_delete_scheduled_batch_forwards_created_by_query(client, captured):
    r = client.delete(f"/api/eval/scheduled-batches/b-1?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["method"] == "DELETE"
    assert captured[0]["query"].get("created_by") == USER_ID


# (j) GET /api/eval/scheduled-batches/{id}/runs?created_by=X
def test_list_scheduled_batch_runs_forwards_created_by_query(client, captured):
    r = client.get(f"/api/eval/scheduled-batches/b-1/runs?created_by={USER_ID}")
    assert r.status_code == 200
    assert captured[0]["query"].get("created_by") == USER_ID
    assert "/api/v1/scheduled-batches/b-1/runs" in captured[0]["path"]


# (k) POST /api/eval/scheduled-batches/{id}/trigger carries body.created_by
def test_trigger_scheduled_batch_forwards_created_by_body(client, captured):
    r = client.post(
        "/api/eval/scheduled-batches/b-1/trigger",
        json={"created_by": USER_ID},
    )
    assert r.status_code == 200
    assert captured[0]["method"] == "POST"
    assert "/api/v1/scheduled-batches/b-1/trigger" in captured[0]["path"]
    assert captured[0]["body"].get("created_by") == USER_ID
