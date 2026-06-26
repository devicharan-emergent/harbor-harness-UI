"""Backend tests for the new bench-aware verifier-config endpoints
(iter-28). Covers:
  - GET /api/eval/verifier-config?bench=<bench>
  - PUT /api/eval/verifier-config?bench=<bench>
  - POST /api/eval/verifier-config/reset?bench=<bench>
  - Legacy /api/eval/judge-config alias to testing_agent_bench
  - Per-bench independence (saving one does NOT touch the other)
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api/eval"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(autouse=True)
def _reset_both_benches(client):
    """Each test starts from a clean slate — both bench docs reset."""
    client.post(f"{API}/verifier-config/reset", params={"bench": "testing_agent_bench"})
    client.post(f"{API}/verifier-config/reset", params={"bench": "scratch_bench_phased"})
    yield
    client.post(f"{API}/verifier-config/reset", params={"bench": "testing_agent_bench"})
    client.post(f"{API}/verifier-config/reset", params={"bench": "scratch_bench_phased"})


# ── GET ─────────────────────────────────────────────────────────────────


class TestGetVerifierConfig:
    def test_get_testing_agent_bench_default(self, client):
        r = client.get(f"{API}/verifier-config", params={"bench": "testing_agent_bench"})
        assert r.status_code == 200
        data = r.json()
        assert data["bench_type"] == "testing_agent_bench"
        assert "{golden}" in data["prompt"]
        assert "{candidate}" in data["prompt"]
        assert isinstance(data["model"], str) and len(data["model"]) > 0
        assert data["is_default"] is True
        assert data["updated_at"] is None

    def test_get_scratch_bench_default(self, client):
        r = client.get(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"})
        assert r.status_code == 200
        data = r.json()
        assert data["bench_type"] == "scratch_bench_phased"
        # Both required tokens present in seeded prompt
        assert "{preview_url}" in data["prompt"]
        assert "{test_case}" in data["prompt"]
        # Reasonable prompt length (review request says ~1231 chars)
        assert len(data["prompt"]) > 500
        assert data["model"] == "gemini-flash-latest"
        assert data["is_default"] is True
        assert data["updated_at"] is None

    def test_get_unknown_bench_400(self, client):
        r = client.get(f"{API}/verifier-config", params={"bench": "fake_bench"})
        assert r.status_code == 400
        body = r.json()
        # FastAPI default error envelope is {"detail": ...}
        detail = str(body.get("detail", body))
        assert "testing_agent_bench" in detail
        assert "scratch_bench_phased" in detail


# ── PUT ─────────────────────────────────────────────────────────────────


class TestPutVerifierConfig:
    def test_put_scratch_missing_test_case_400(self, client):
        body = {"prompt": "Use {preview_url} only without that other token", "model": "gpt-5.5"}
        r = client.put(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"}, json=body)
        assert r.status_code == 400
        assert "{test_case}" in str(r.json().get("detail", ""))

    def test_put_scratch_missing_preview_url_400(self, client):
        body = {"prompt": "Only has {test_case}", "model": "gpt-5.5"}
        r = client.put(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"}, json=body)
        assert r.status_code == 400
        assert "{preview_url}" in str(r.json().get("detail", ""))

    def test_put_scratch_empty_prompt_400(self, client):
        body = {"prompt": "   ", "model": "gpt-5.5"}
        r = client.put(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"}, json=body)
        assert r.status_code == 400
        assert "empty" in str(r.json().get("detail", "")).lower()

    def test_put_testing_agent_missing_golden_400(self, client):
        body = {"prompt": "Has only {candidate}", "model": "gpt-5.5"}
        r = client.put(
            f"{API}/verifier-config", params={"bench": "testing_agent_bench"}, json=body
        )
        assert r.status_code == 400
        assert "{golden}" in str(r.json().get("detail", ""))

    def test_put_scratch_valid_persists_and_is_independent(self, client):
        custom_prompt = (
            "TEST_VERIFIER_SCRATCH: visit {preview_url} and run case {test_case} please"
        )
        custom_model = "gpt-5.5"
        r = client.put(
            f"{API}/verifier-config",
            params={"bench": "scratch_bench_phased"},
            json={"prompt": custom_prompt, "model": custom_model},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["bench_type"] == "scratch_bench_phased"
        assert data["prompt"] == custom_prompt
        assert data["model"] == custom_model
        assert data["is_default"] is False
        assert data["updated_at"]

        # Re-GET scratch — must round-trip
        r2 = client.get(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"})
        assert r2.status_code == 200
        assert r2.json()["prompt"] == custom_prompt
        assert r2.json()["is_default"] is False

        # GET testing_agent_bench — MUST be unchanged (still default)
        r3 = client.get(f"{API}/verifier-config", params={"bench": "testing_agent_bench"})
        assert r3.status_code == 200
        ta = r3.json()
        assert ta["is_default"] is True
        assert ta["prompt"] != custom_prompt
        assert "{golden}" in ta["prompt"]

    def test_put_unknown_bench_400(self, client):
        body = {"prompt": "x {golden} {candidate}", "model": "gpt-5.5"}
        r = client.put(f"{API}/verifier-config", params={"bench": "fake"}, json=body)
        assert r.status_code == 400


# ── POST /reset ─────────────────────────────────────────────────────────


class TestResetVerifierConfig:
    def test_reset_only_drops_target_bench(self, client):
        # Customize BOTH benches
        client.put(
            f"{API}/verifier-config",
            params={"bench": "testing_agent_bench"},
            json={"prompt": "TEST_TA {golden} {candidate}", "model": "gpt-5.5"},
        )
        client.put(
            f"{API}/verifier-config",
            params={"bench": "scratch_bench_phased"},
            json={"prompt": "TEST_SC {preview_url} {test_case}", "model": "gpt-5.5"},
        )

        # Reset only scratch
        r = client.post(f"{API}/verifier-config/reset", params={"bench": "scratch_bench_phased"})
        assert r.status_code == 200
        assert r.json()["is_default"] is True

        # scratch should be back to default
        sc = client.get(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"}).json()
        assert sc["is_default"] is True
        assert "TEST_SC" not in sc["prompt"]

        # testing_agent should STILL be customized
        ta = client.get(f"{API}/verifier-config", params={"bench": "testing_agent_bench"}).json()
        assert ta["is_default"] is False
        assert ta["prompt"] == "TEST_TA {golden} {candidate}"


# ── Legacy /eval/judge-config aliases ──────────────────────────────────


class TestLegacyJudgeConfigAlias:
    def test_legacy_get_returns_judge_field_names(self, client):
        r = client.get(f"{API}/judge-config")
        assert r.status_code == 200
        data = r.json()
        assert "judge_prompt" in data
        assert "judge_model" in data
        assert "{golden}" in data["judge_prompt"]
        assert "{candidate}" in data["judge_prompt"]
        assert data["is_default"] is True

    def test_legacy_put_persists_under_testing_agent_bench(self, client):
        body = {
            "judge_prompt": "TEST_LEGACY {golden} {candidate}",
            "judge_model": "gpt-5.5",
        }
        r = client.put(f"{API}/judge-config", json=body)
        assert r.status_code == 200
        data = r.json()
        assert data["judge_prompt"] == "TEST_LEGACY {golden} {candidate}"
        assert data["judge_model"] == "gpt-5.5"
        assert data["is_default"] is False

        # Verify via the new endpoint
        r2 = client.get(f"{API}/verifier-config", params={"bench": "testing_agent_bench"})
        assert r2.status_code == 200
        new_data = r2.json()
        assert new_data["prompt"] == "TEST_LEGACY {golden} {candidate}"
        assert new_data["model"] == "gpt-5.5"
        assert new_data["is_default"] is False

        # scratch should be unaffected
        sc = client.get(f"{API}/verifier-config", params={"bench": "scratch_bench_phased"}).json()
        assert sc["is_default"] is True

    def test_legacy_reset(self, client):
        # Customize first via legacy endpoint
        client.put(
            f"{API}/judge-config",
            json={"judge_prompt": "X {golden} {candidate}", "judge_model": "gpt-5.5"},
        )
        r = client.post(f"{API}/judge-config/reset")
        assert r.status_code == 200
        assert r.json()["is_default"] is True

        # Verify via new endpoint
        ta = client.get(f"{API}/verifier-config", params={"bench": "testing_agent_bench"}).json()
        assert ta["is_default"] is True
