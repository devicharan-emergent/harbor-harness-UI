"""Iteration 45 — Verify multi-agent fan-out submit + new live/llm-call proxies.

- POST /api/eval/jobs with agent_names[] fans out (agent × problem)
- Cap >100 returns 400 with exact message
- GET /api/eval/jobs/{id}/live-results (completed job) returns 200
- GET /api/eval/jobs/{id}/llm-calls (count==11 for the seed completed job)
- GET /api/eval/jobs/{id}/llm-calls/{call_id} returns request_body+response_body
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://replay-browser-tests.internal.preview.emergentagent.com").rstrip("/")
TOKEN = "pw_emergent_gate_post"

COMPLETED_JOB = "c96f5f28-224a-4982-b448-1f096162fd2a"
RUNNING_JOB = "ecfeb809-243d-45f4-9bcf-3c16fe8769b9"

S = requests.Session()
S.headers.update({"Content-Type": "application/json"})


def _qs(p=None):
    p = p or {}
    p["access_token"] = TOKEN
    return p


# ---------- fan-out submit ----------

def test_fanout_two_agents_one_problem_creates_two_jobs():
    ts = int(time.time())
    body = {
        "user_id": "TEST_pw_user@emergent.com",
        "group_name": f"qa_pytest_{ts}",
        "evals": [{
            "problem": "scratch_bench_phased/ag1_Land_test_final_1",
            "cpus": 2, "memory": 4096, "storage": 10,
            "headed": True, "force_build": False,
        }],
        "agent_names": [
            "_cortex_ui_edit_test_1782308200",
            "_cortex_ui_edit_test_1782725739",
        ],
    }
    r = S.post(f"{BASE}/api/eval/jobs", params=_qs(), json=body, timeout=45)
    print("submit status:", r.status_code, "body:", r.text[:400])
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    # Harness returns evals/jobs list — try both shapes
    items = data.get("evals") or data.get("jobs") or data.get("data") or []
    if not items and isinstance(data, list):
        items = data
    assert len(items) == 2, f"Expected 2 jobs from fan-out, got {len(items)}: {data}"
    # Verify 2 distinct job ids were created (one per agent×problem combo)
    ids = {it.get("id") for it in items if isinstance(it, dict)}
    assert len(ids) == 2, f"Expected 2 distinct job ids, got {ids}"


def test_fanout_cap_exceeded_returns_400_with_exact_message():
    # 130 agents × 1 problem = 130 -> exceeds 100
    agents = [f"agent_dummy_{i}" for i in range(130)]
    body = {
        "user_id": "TEST_pw_user@emergent.com",
        "group_name": "qa_cap_test",
        "evals": [{"problem": "scratch_bench_phased/ag1_Land_test_final_1"}],
        "agent_names": agents,
    }
    r = S.post(f"{BASE}/api/eval/jobs", params=_qs(), json=body, timeout=30)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
    msg = (r.json().get("detail") or "").lower()
    assert "too many jobs" in msg, f"Missing 'too many jobs' in {msg}"
    assert "130 jobs" in msg
    assert "130 agents" in msg
    assert "1 problems" in msg
    assert "exceeds the limit of 100" in msg


# ---------- new live/llm-call proxies ----------

def test_live_results_endpoint_responds():
    r = S.get(f"{BASE}/api/eval/jobs/{RUNNING_JOB}/live-results", params=_qs(), timeout=20)
    print("live-results status:", r.status_code, "body:", r.text[:300])
    # Endpoint should not 500 / 404. 200 with empty / waiting is acceptable.
    assert r.status_code in (200, 204), f"Expected 200/204, got {r.status_code}: {r.text}"


def test_llm_calls_completed_job_count_11():
    r = S.get(f"{BASE}/api/eval/jobs/{COMPLETED_JOB}/llm-calls", params=_qs(), timeout=30)
    print("llm-calls status:", r.status_code, "len:", len(r.text))
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
    data = r.json()
    calls = data.get("calls") or data.get("llm_calls") or data.get("data") or (data if isinstance(data, list) else [])
    assert len(calls) == 11, f"Expected 11 llm-calls, got {len(calls)}"
    # Take first call_id and fetch detail
    first = calls[0]
    call_id = first.get("id") or first.get("call_id") or first.get("_id")
    assert call_id, f"No call_id in first item: {first}"
    return call_id


def test_llm_call_detail_has_bodies():
    # Re-fetch list to grab a call_id (don't rely on test ordering)
    r = S.get(f"{BASE}/api/eval/jobs/{COMPLETED_JOB}/llm-calls", params=_qs(), timeout=30)
    assert r.status_code == 200
    data = r.json()
    calls = data.get("calls") or data.get("llm_calls") or data.get("data") or (data if isinstance(data, list) else [])
    assert len(calls) >= 1
    call_id = calls[0].get("id") or calls[0].get("call_id") or calls[0].get("_id")
    assert call_id

    r2 = S.get(
        f"{BASE}/api/eval/jobs/{COMPLETED_JOB}/llm-calls/{call_id}",
        params=_qs(), timeout=30,
    )
    print("llm-call detail status:", r2.status_code, "len:", len(r2.text))
    assert r2.status_code == 200, f"Expected 200, got {r2.status_code}: {r2.text[:300]}"
    detail = r2.json()
    # Must include request_body and response_body
    assert ("request_body" in detail) or ("request" in detail), f"No request body in detail keys: {list(detail.keys())[:20]}"
    assert ("response_body" in detail) or ("response" in detail), f"No response body in detail keys: {list(detail.keys())[:20]}"
