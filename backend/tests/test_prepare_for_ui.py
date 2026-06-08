"""Verifies the prepare-for-ui proxy endpoint behaves correctly using an
in-process httpx.MockTransport — no real harness call is ever made.

Spec contract (frontend depends on this shape):
  POST /api/eval/jobs/{job_id}/prepare-for-ui
    →  harness POST /api/v1/evals/{job_id}/prepare-for-ui (no body, no auth)
    →  forwards the harness response (200 JSON or 4xx/5xx JSON envelope)
"""
import json
import sys

import httpx
import pytest

sys.path.insert(0, "/app/backend")

JOB_ID = "8e8a1b38-4be0-45a9-9054-166846c1e0e5"


@pytest.fixture
def captured():
    return []


@pytest.fixture
def client_factory(monkeypatch, captured):
    """Returns a function `make_client(harness_status, harness_body)` so
    each test can dictate what the upstream harness 'returns'."""
    from fastapi.testclient import TestClient
    import server  # noqa: E402

    def make_client(harness_status: int, harness_body):
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
                "body": body,
            })
            return httpx.Response(harness_status, json=harness_body)

        transport = httpx.MockTransport(handler)
        original = httpx.AsyncClient

        class PatchedAsyncClient(original):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = transport
                super().__init__(*args, **kwargs)

        monkeypatch.setattr(server.httpx, "AsyncClient", PatchedAsyncClient)
        monkeypatch.setattr(httpx, "AsyncClient", PatchedAsyncClient)
        return TestClient(server.app)

    return make_client


def test_success_forwards_to_harness(client_factory, captured):
    harness_body = {
        "eval_id": JOB_ID,
        "cortex_job_id": "harbor-5fecb545f08f",
        "eph": "harbor-testing",
        "db": "postgres-harbor-testing",
        "repaired": ["payload.task", "use_cortex", "usages"],
    }
    client = client_factory(200, harness_body)

    r = client.post(f"/api/eval/jobs/{JOB_ID}/prepare-for-ui")
    assert r.status_code == 200, r.text
    assert r.json() == harness_body

    # Outbound call shape
    assert len(captured) == 1
    call = captured[0]
    assert call["method"] == "POST"
    assert call["path"].endswith(f"/api/v1/evals/{JOB_ID}/prepare-for-ui")
    # Spec says no body required — our proxy must not invent one.
    assert call["body"] is None


def test_already_healthy_response_is_passed_through(client_factory):
    """No-op path: harness returns `repaired: ["already_healthy"]`."""
    client = client_factory(200, {
        "eval_id": JOB_ID,
        "cortex_job_id": "harbor-1",
        "eph": "",
        "db": "postgres-dev",
        "repaired": ["already_healthy"],
    })
    r = client.post(f"/api/eval/jobs/{JOB_ID}/prepare-for-ui")
    assert r.status_code == 200
    assert r.json()["repaired"] == ["already_healthy"]
    assert r.json()["eph"] == ""


def test_400_still_queued_passes_status_and_detail(client_factory):
    """When the eval hasn't been picked up yet the harness returns 400.
    The proxy must surface the same 400 + the harness JSON so the UI can
    render the spec'd toast."""
    harness_body = {
        "error": "bad_request",
        "message": f"eval {JOB_ID} has no cortex_job_id yet (still queued?)",
    }
    client = client_factory(400, harness_body)
    r = client.post(f"/api/eval/jobs/{JOB_ID}/prepare-for-ui")
    assert r.status_code == 400, r.text
    # FastAPI wraps an HTTPException(detail=…) under `{"detail": …}`.
    assert r.json()["detail"] == harness_body


def test_404_unknown_eval_passes_through(client_factory):
    client = client_factory(404, {"error": "not_found", "message": f"eval {JOB_ID} not found"})
    r = client.post(f"/api/eval/jobs/{JOB_ID}/prepare-for-ui")
    assert r.status_code == 404
    assert r.json()["detail"]["message"].endswith("not found")


def test_503_app_db_not_configured_passes_through(client_factory):
    client = client_factory(503, {"error": "app DB pool not configured"})
    r = client.post(f"/api/eval/jobs/{JOB_ID}/prepare-for-ui")
    assert r.status_code == 503
    assert "app DB pool not configured" in r.json()["detail"]["error"]
