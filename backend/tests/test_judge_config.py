"""Tests for judge-config singleton CRUD endpoints (iteration 23).

Endpoints under test:
  - GET  /api/eval/judge-config
  - PUT  /api/eval/judge-config
  - POST /api/eval/judge-config/reset
"""

import os
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fall back to public frontend URL configured in repo
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
BASE_URL = BASE_URL.rstrip("/")

JUDGE_URL = f"{BASE_URL}/api/eval/judge-config"
RESET_URL = f"{BASE_URL}/api/eval/judge-config/reset"


@pytest.fixture(autouse=True)
def _reset_before_each():
    """Ensure a clean (default) state before every test."""
    requests.post(RESET_URL, timeout=10)
    yield
    requests.post(RESET_URL, timeout=10)


# ---------- GET default ----------
class TestGetDefault:
    def test_default_state_returns_is_default_true(self):
        r = requests.get(JUDGE_URL, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_default"] is True
        assert data["updated_at"] is None
        assert data["judge_model"] == "gemini-flash-latest"
        assert "{golden}" in data["judge_prompt"]
        assert "{candidate}" in data["judge_prompt"]


# ---------- PUT validation ----------
class TestPutValidation:
    def test_missing_candidate_token_400(self):
        body = {"judge_prompt": "only {golden} here", "judge_model": "gemini-flash-latest"}
        r = requests.put(JUDGE_URL, json=body, timeout=10)
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "candidate" in detail

    def test_missing_golden_token_400(self):
        body = {"judge_prompt": "only {candidate} here", "judge_model": "gemini-flash-latest"}
        r = requests.put(JUDGE_URL, json=body, timeout=10)
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "golden" in detail

    def test_empty_prompt_400(self):
        body = {"judge_prompt": "   ", "judge_model": "gemini-flash-latest"}
        r = requests.put(JUDGE_URL, json=body, timeout=10)
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "empty" in detail


# ---------- PUT happy path + persistence ----------
class TestPutPersistence:
    def test_put_then_get_returns_saved(self):
        custom_prompt = "Custom judge prompt {golden} vs {candidate} TEST_judge_cfg"
        custom_model = "gpt-5.2"
        put_r = requests.put(
            JUDGE_URL, json={"judge_prompt": custom_prompt, "judge_model": custom_model}, timeout=10
        )
        assert put_r.status_code == 200, put_r.text
        put_data = put_r.json()
        assert put_data["judge_prompt"] == custom_prompt
        assert put_data["judge_model"] == custom_model
        assert put_data["is_default"] is False
        assert put_data["updated_at"] is not None

        # Now GET and verify persistence
        get_r = requests.get(JUDGE_URL, timeout=10)
        assert get_r.status_code == 200, get_r.text
        get_data = get_r.json()
        assert get_data["judge_prompt"] == custom_prompt
        assert get_data["judge_model"] == custom_model
        assert get_data["is_default"] is False
        assert get_data["updated_at"] == put_data["updated_at"]


# ---------- POST reset ----------
class TestReset:
    def test_reset_removes_doc_and_returns_defaults(self):
        # First save a custom config
        custom_prompt = "Save me {golden} {candidate} TEST_reset"
        requests.put(
            JUDGE_URL,
            json={"judge_prompt": custom_prompt, "judge_model": "claude-opus-4-7"},
            timeout=10,
        )
        # Confirm it persisted
        g1 = requests.get(JUDGE_URL, timeout=10).json()
        assert g1["is_default"] is False

        # Reset
        r = requests.post(RESET_URL, timeout=10)
        assert r.status_code == 200, r.text
        reset_data = r.json()
        assert reset_data["is_default"] is True
        assert reset_data["judge_model"] == "gemini-flash-latest"
        assert "{golden}" in reset_data["judge_prompt"]
        assert "{candidate}" in reset_data["judge_prompt"]

        # GET after reset should return defaults
        g2 = requests.get(JUDGE_URL, timeout=10).json()
        assert g2["is_default"] is True
        assert g2["updated_at"] is None
        assert g2["judge_model"] == "gemini-flash-latest"
