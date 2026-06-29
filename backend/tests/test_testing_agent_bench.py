"""Backend tests for testing_agent_bench feature.

Covers:
- POST /api/eval/testing-agent-evals proxy → harness POST /api/v1/testing-agent-evals
- POST /api/eval/datasets with dataset_type=testing_agent_bench (no problem_set_ids, no phases, no test_cases)
- Error pass-through from upstream
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://replay-browser-tests.internal.preview.emergentagent.com",
).rstrip("/")
TOKEN = "pw_emergent_gate_post"
USER_ID = "0ee59a27-db9c-4647-aeee-f72173fcd757"
RUN_ID = uuid.uuid4().hex[:8]


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Backend proxy: /api/eval/testing-agent-evals ---
class TestTestingAgentEvalProxy:
    def test_proxy_returns_jobs(self, api_client):
        url = f"{BASE_URL}/api/eval/testing-agent-evals?access_token={TOKEN}"
        body = {
            "prod_job_id": f"TEST_iter21_prod_fork_001_{RUN_ID}",
            "agent_name": "testing-agent-v3-gpt-5-2-codex",
            "hitl_input": "Please continue with the task",
            "golden_output": "Task done successfully",
            "group_run_id": f"TEST_iter21_grp_{RUN_ID}",
            "created_by": USER_ID,
        }
        r = api_client.post(url, json=body)
        assert r.status_code in (200, 202), f"got {r.status_code}: {r.text}"
        data = r.json()
        assert "jobs" in data, data
        assert isinstance(data["jobs"], list) and len(data["jobs"]) >= 1
        job = data["jobs"][0]
        for key in ("id", "problem", "status", "k8s_job_name", "created_at"):
            assert key in job, f"missing {key} in {job}"
        # Problem should mirror prod_job_id (with namespace prefix)
        assert f"TEST_iter21_prod_fork_001_{RUN_ID}" in job["problem"]

    def test_proxy_with_optional_model_name(self, api_client):
        url = f"{BASE_URL}/api/eval/testing-agent-evals?access_token={TOKEN}"
        body = {
            "prod_job_id": f"TEST_iter21_prod_fork_002_{RUN_ID}",
            "agent_name": "testing-agent-v3-gpt-5-2-codex",
            "hitl_input": "Continue debugging",
            "golden_output": "Bug fixed",
            "model_name": "gpt-5.2",
            "group_run_id": f"TEST_iter21_grp_2_{RUN_ID}",
            "created_by": USER_ID,
        }
        r = api_client.post(url, json=body)
        assert r.status_code in (200, 202), r.text
        assert "jobs" in r.json()

    def test_proxy_surfaces_upstream_error(self, api_client):
        """Empty body should fail upstream validation - error surfaced as non-200."""
        url = f"{BASE_URL}/api/eval/testing-agent-evals?access_token={TOKEN}"
        r = api_client.post(url, json={})
        # Upstream surfaces error; we accept any non-2xx (4xx or 5xx)
        assert r.status_code >= 400, f"got {r.status_code}: {r.text}"
        assert "detail" in r.json() or "message" in r.json()


# --- Dataset POST /api/eval/datasets with dataset_type=testing_agent_bench ---
class TestTestingAgentBenchDataset:
    def test_create_dataset_minimal(self, api_client):
        instance_id = f"TEST_iter21_dataset_min_{RUN_ID}"
        body = {
            "dataset_type": "testing_agent_bench",
            "instance_id": instance_id,
            "name": f"testing_agent_bench/{instance_id}",
            "description": "iter21 backend test minimal",
            "problem_statement": "Please continue with the task",
            "natural_language_tests": "Task done successfully",
            "attributes": {
                "agent_name": "testing-agent-v3-gpt-5-2-codex",
                "prod_job_id": instance_id,
            },
            "tags": [],
        }
        url = f"{BASE_URL}/api/eval/datasets?access_token={TOKEN}"
        r = api_client.post(url, json=body)
        assert r.status_code in (200, 201), f"got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("dataset_type") == "testing_agent_bench"
        assert data.get("instance_id") == instance_id
        assert data.get("problem_statement") == "Please continue with the task"
        assert data.get("natural_language_tests") == "Task done successfully"
        attrs = data.get("attributes") or {}
        assert attrs.get("agent_name") == "testing-agent-v3-gpt-5-2-codex"
        # model_name should be absent when blank
        assert "model_name" not in attrs or not attrs.get("model_name")

    def test_create_dataset_with_model_name(self, api_client):
        instance_id = f"TEST_iter21_dataset_full_{RUN_ID}"
        body = {
            "dataset_type": "testing_agent_bench",
            "instance_id": instance_id,
            "name": f"testing_agent_bench/{instance_id}",
            "description": "iter21 backend test full",
            "problem_statement": "HITL: please continue",
            "natural_language_tests": "GOLDEN: success",
            "attributes": {
                "agent_name": "testing-agent-v3-gpt-5-2-codex",
                "model_name": "gpt-5.2",
                "prod_job_id": instance_id,
            },
            "tags": [],
        }
        url = f"{BASE_URL}/api/eval/datasets?access_token={TOKEN}"
        r = api_client.post(url, json=body)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        attrs = data.get("attributes") or {}
        assert attrs.get("model_name") == "gpt-5.2"

    def test_list_and_filter_by_type(self, api_client):
        """Ensure testing_agent_bench datasets exist in the listing."""
        url = f"{BASE_URL}/api/eval/datasets?access_token={TOKEN}"
        r = api_client.get(url)
        assert r.status_code == 200
        data = r.json()
        items = data.get("datasets") or data
        assert isinstance(items, list)
        tab = [d for d in items if d.get("dataset_type") == "testing_agent_bench"]
        assert len(tab) >= 1, "Expected at least one testing_agent_bench dataset"
        # Verify shape
        sample = tab[0]
        assert sample.get("instance_id")
        assert sample.get("name", "").startswith("testing_agent_bench/")
