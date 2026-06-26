"""Iteration 39 — agent_name placeholder shim for testing_agent_bench.

Tests the BFF-side injection of attributes.agent_name='agent_set_at_runtime'
on POST /api/eval/datasets and PUT /api/eval/datasets/{id} when:
- dataset_type == 'testing_agent_bench'
- AND no agent_name is supplied by client.

Scope: shim must NOT touch other dataset_types, must NOT overwrite an
explicit agent_name.
"""
import os
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://ui-preview-debug.internal.preview.emergentagent.com"
).rstrip("/")
TOKEN = "pw_emergent_gate_post"
RUN_ID = uuid.uuid4().hex[:8]
PLACEHOLDER = "agent_set_at_runtime"


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}",
    })
    return s


def _datasets_url():
    return f"{BASE_URL}/api/eval/datasets?access_token={TOKEN}"


def _dataset_id_url(ds_id):
    return f"{BASE_URL}/api/eval/datasets/{ds_id}?access_token={TOKEN}"


class TestAgentNameShim:
    """Verifies the 4 backend cases requested for iteration 39."""

    # Case 1
    def test_create_testing_agent_bench_empty_attrs_injects_placeholder(self, api_client):
        instance_id = f"TEST_iter39_empty_{RUN_ID}_{uuid.uuid4().hex[:6]}"
        body = {
            "dataset_type": "testing_agent_bench",
            "instance_id": instance_id,
            "name": f"testing_agent_bench/{instance_id}",
            "description": "iter39 — empty attrs, expect placeholder injection",
            "problem_statement": "HITL: continue with the task",
            "natural_language_tests": "GOLDEN: task done successfully",
            "attributes": {},
            "tags": [],
        }
        r = api_client.post(_datasets_url(), json=body)
        if r.status_code == 409:
            pytest.skip(f"upstream 409 duplicate instance_id (known limitation): {r.text}")
        assert r.status_code in (200, 201), f"got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("dataset_type") == "testing_agent_bench"
        attrs = data.get("attributes") or {}
        assert attrs.get("agent_name") == PLACEHOLDER, (
            f"expected agent_name='{PLACEHOLDER}', got attrs={attrs}"
        )

    # Case 2
    def test_create_testing_agent_bench_explicit_agent_name_preserved(self, api_client):
        instance_id = f"TEST_iter39_explicit_{RUN_ID}_{uuid.uuid4().hex[:6]}"
        explicit_name = "my_custom_agent"
        body = {
            "dataset_type": "testing_agent_bench",
            "instance_id": instance_id,
            "name": f"testing_agent_bench/{instance_id}",
            "description": "iter39 — explicit agent_name should be preserved",
            "problem_statement": "HITL: please continue",
            "natural_language_tests": "GOLDEN: ok",
            "attributes": {"agent_name": explicit_name},
            "tags": [],
        }
        r = api_client.post(_datasets_url(), json=body)
        if r.status_code == 409:
            pytest.skip(f"upstream 409 duplicate instance_id: {r.text}")
        assert r.status_code in (200, 201), f"got {r.status_code}: {r.text}"
        data = r.json()
        attrs = data.get("attributes") or {}
        assert attrs.get("agent_name") == explicit_name, (
            f"expected explicit agent_name preserved, got attrs={attrs}"
        )
        assert attrs.get("agent_name") != PLACEHOLDER

    # Case 3
    def test_create_non_testing_agent_bench_no_injection(self, api_client):
        """scratch_bench_phased with empty attrs should NOT get the placeholder."""
        instance_id = f"TEST_iter39_scratch_{RUN_ID}_{uuid.uuid4().hex[:6]}"
        body = {
            "dataset_type": "scratch_bench_phased",
            "instance_id": instance_id,
            "name": f"scratch_bench_phased/{instance_id}",
            "description": "iter39 — non-testing-agent type, shim should NOT fire",
            "problem_statement": "Build a thing",
            "natural_language_tests": "It works",
            "attributes": {},
            "tags": [],
            # scratch_bench_phased typically needs phases — but the upstream
            # validation order is what we care about: shim should NOT inject
            # agent_name regardless of whether the create succeeds.
            "phases": [],
        }
        r = api_client.post(_datasets_url(), json=body)
        # The create may legitimately fail upstream (e.g. missing phases),
        # but in EVERY case, the shim must not have added agent_name.
        if r.status_code in (200, 201):
            data = r.json()
            attrs = data.get("attributes") or {}
            assert "agent_name" not in attrs, (
                f"shim leaked into non-testing-agent type: attrs={attrs}"
            )
            assert attrs.get("agent_name") != PLACEHOLDER
        else:
            # Failure path — verify the error is NOT the agent_name missing
            # one (proving shim didn't add it AND upstream didn't require it
            # for this dataset_type).
            text = r.text.lower()
            assert "agent_name" not in text or "missing" not in text, (
                f"unexpected agent_name validation error for scratch_bench_phased: {r.text}"
            )

    # Case 4
    def test_update_testing_agent_bench_empty_attrs_injects_placeholder(self, api_client):
        # First create a dataset (with explicit agent so create is independent of Case 1)
        instance_id = f"TEST_iter39_upd_{RUN_ID}_{uuid.uuid4().hex[:6]}"
        create_body = {
            "dataset_type": "testing_agent_bench",
            "instance_id": instance_id,
            "name": f"testing_agent_bench/{instance_id}",
            "description": "iter39 — seed for PUT test",
            "problem_statement": "HITL: initial",
            "natural_language_tests": "GOLDEN: initial",
            "attributes": {"agent_name": "initial_agent"},
            "tags": [],
        }
        cr = api_client.post(_datasets_url(), json=create_body)
        if cr.status_code == 409:
            pytest.skip(f"upstream 409 dup during seed: {cr.text}")
        assert cr.status_code in (200, 201), f"seed create failed: {cr.status_code} {cr.text}"
        ds_id = cr.json().get("id")
        assert ds_id, f"no id in create response: {cr.json()}"

        # Now PUT with empty attributes — placeholder should be injected
        update_body = {
            "dataset_type": "testing_agent_bench",
            "problem_statement": "HITL: updated",
            "natural_language_tests": "GOLDEN: updated",
            "description": "iter39 — updated, empty attrs",
            "attributes": {},
        }
        ur = api_client.put(_dataset_id_url(ds_id), json=update_body)
        assert ur.status_code == 200, f"PUT failed: {ur.status_code} {ur.text}"
        data = ur.json()
        attrs = data.get("attributes") or {}
        assert attrs.get("agent_name") == PLACEHOLDER, (
            f"expected agent_name='{PLACEHOLDER}' after PUT with empty attrs, got attrs={attrs}"
        )
        # Also verify the description / problem_statement updated to confirm PUT took effect
        assert data.get("problem_statement") == "HITL: updated"
        assert data.get("natural_language_tests") == "GOLDEN: updated"
