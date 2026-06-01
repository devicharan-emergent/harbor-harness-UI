"""Verifies the eph-driven eval submission proxy behavior using an in-process
MockTransport — no real eval is ever submitted to the harness.

Covers:
  - POST /api/eval/jobs-with-es forwards the client-derived `emergent_agents_url`,
    `cortex_url`, `eph_name`, and per-eval `experiments.cortex_url` to the
    harness `/api/v1/internal/evals-with-es` endpoint verbatim.
  - The legacy POST /api/eval/jobs path is still used when no eph_name is
    supplied (regression guard for the fallback).
  - The proxy returns whatever the harness returns (pass-through), without
    rewriting URLs or stripping fields.

The httpx.MockTransport intercepts every outbound httpx.AsyncClient call so
the harness is never actually hit. Safe to run on every deploy / CI cycle.
"""
import json
import sys

import httpx
import pytest

sys.path.insert(0, "/app/backend")

EPH = "phase-metrics-test"
EMERGENT_URL = f"https://emergent-agents-{EPH}-tit7tznrtq-uc.a.run.app"
CORTEX_URL = f"https://cortex-{EPH}-tit7tznrtq-uc.a.run.app"


@pytest.fixture
def captured():
    return []


@pytest.fixture
def client(monkeypatch, captured):
    """Same MockTransport recipe as test_created_by_passthrough — every
    outbound httpx call is captured + answered with a stub success body."""
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
        return httpx.Response(
            200,
            json={"jobs": [{"id": "stub-job-1", "status": "queued"}]},
        )

    transport = httpx.MockTransport(handler)
    original = httpx.AsyncClient

    class PatchedAsyncClient(original):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(server.httpx, "AsyncClient", PatchedAsyncClient)
    monkeypatch.setattr(httpx, "AsyncClient", PatchedAsyncClient)

    return TestClient(server.app)


def _payload_with_eph():
    """The shape RunEvalModal posts when an eph name is set."""
    return {
        "user_id": "acm-user",
        "group_run_id": "url-derivation-test-1",
        "evals": [{
            "problem": "bug_bench/emergenthub__contractor-hub-37_2",
            "cpus": 2,
            "memory": 4096,
            "storage": 10,
            "headed": True,
            "force_build": False,
            "experiments": {"cortex_url": CORTEX_URL},
        }],
        "eph_name": EPH,
        "emergent_agents_url": EMERGENT_URL,
        "cortex_url": CORTEX_URL,
    }


def test_jobs_with_es_forwards_derived_urls(client, captured):
    """When the UI submits with an eph, the proxy must forward the derived
    URLs to the harness verbatim. This is the contract that broke prod
    (harness returned `emergent_agents_url is required` because the proxy
    used to strip URLs server-side)."""
    r = client.post("/api/eval/jobs-with-es", json=_payload_with_eph())
    assert r.status_code == 200, r.text

    assert len(captured) == 1, f"expected 1 outbound call, got {len(captured)}"
    call = captured[0]
    assert call["method"] == "POST"
    assert call["path"].endswith("/api/v1/internal/evals-with-es"), call["path"]

    body = call["body"]
    assert body["eph_name"] == EPH
    assert body["emergent_agents_url"] == EMERGENT_URL
    assert body["cortex_url"] == CORTEX_URL
    # Per-eval experiments cortex_url must also flow through unchanged.
    assert body["evals"][0]["experiments"]["cortex_url"] == CORTEX_URL


def test_jobs_with_es_returns_harness_response_unchanged(client, captured):
    """The proxy must be a pure pass-through — no payload rewrite."""
    r = client.post("/api/eval/jobs-with-es", json=_payload_with_eph())
    assert r.status_code == 200
    data = r.json()
    assert data == {"jobs": [{"id": "stub-job-1", "status": "queued"}]}


def test_fallback_path_used_when_no_eph(client, captured):
    """No eph → legacy /api/eval/jobs path must still work and route to the
    harness `/api/v1/evals` endpoint (NOT `/internal/evals-with-es`)."""
    legacy_payload = {
        "user_id": "acm-user",
        "evals": [{"problem": "bug_bench/emergenthub__contractor-hub-37_2"}],
    }
    r = client.post("/api/eval/jobs", json=legacy_payload)
    assert r.status_code == 200, r.text
    assert len(captured) == 1
    call = captured[0]
    assert call["method"] == "POST"
    assert call["path"].endswith("/api/v1/evals"), call["path"]
    assert "evals-with-es" not in call["path"]
    # And the legacy body must NOT carry emergent_agents_url (regression
    # guard — the fallback path should not invent URLs).
    assert "emergent_agents_url" not in (call["body"] or {})


def test_jobs_with_es_does_not_call_readiness_endpoint(client, captured):
    """Even though we have a readiness stub, submitting jobs must NOT
    trigger a readiness probe — the UI gate is off and the harness is
    authoritative."""
    r = client.post("/api/eval/jobs-with-es", json=_payload_with_eph())
    assert r.status_code == 200
    paths = [c["path"] for c in captured]
    assert not any("readiness" in p for p in paths), (
        f"Submission unexpectedly triggered a readiness probe: {paths}"
    )
