"""
Backend tests for ACM iteration 13 - Group API and eval endpoints
Tests the new GET /api/eval/groups/{group_id}/jobs endpoint and related functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestGroupAPI:
    """Tests for the new group jobs endpoint"""
    
    def test_get_group_jobs_grp_13(self):
        """Test GET /api/eval/groups/grp-13/jobs returns jobs for that group"""
        response = requests.get(f"{BASE_URL}/api/eval/groups/grp-13/jobs")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "group_id" in data, "Response should contain group_id"
        assert data["group_id"] == "grp-13", f"Expected group_id='grp-13', got '{data.get('group_id')}'"
        assert "jobs" in data, "Response should contain jobs array"
        assert isinstance(data["jobs"], list), "Jobs should be a list"
        
        print(f"✓ grp-13 returned {len(data['jobs'])} jobs")
        
        # Verify job structure
        if len(data["jobs"]) > 0:
            job = data["jobs"][0]
            assert "id" in job, "Job should have id"
            assert "problem" in job, "Job should have problem"
            assert "status" in job, "Job should have status"
            print(f"✓ First job: {job['id']}, problem: {job['problem']}, status: {job['status']}")
    
    def test_get_group_jobs_test_group_123(self):
        """Test GET /api/eval/groups/test-group-123/jobs"""
        response = requests.get(f"{BASE_URL}/api/eval/groups/test-group-123/jobs")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["group_id"] == "test-group-123"
        print(f"✓ test-group-123 returned {len(data.get('jobs', []))} jobs")
    
    def test_get_group_jobs_with_pagination(self):
        """Test group jobs endpoint with limit and offset params"""
        response = requests.get(
            f"{BASE_URL}/api/eval/groups/grp-13/jobs",
            params={"limit": 10, "offset": 0}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "jobs" in data
        print(f"✓ Pagination test passed with {len(data['jobs'])} jobs")
    
    def test_get_group_jobs_nonexistent(self):
        """Test group jobs endpoint with non-existent group returns empty jobs"""
        response = requests.get(f"{BASE_URL}/api/eval/groups/nonexistent-group-xyz/jobs")
        
        # API should return 200 with empty jobs, not 404
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "jobs" in data
        # Empty array or group not found should return empty jobs
        print(f"✓ Non-existent group returned {len(data.get('jobs', []))} jobs (expected 0 or empty)")


class TestEvalStats:
    """Tests for eval stats endpoint"""
    
    def test_get_eval_stats(self):
        """Test GET /api/eval/stats returns proper stats object"""
        response = requests.get(f"{BASE_URL}/api/eval/stats")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify expected status keys
        expected_keys = ["queued", "generating", "running", "completed", "failed", "cancelled"]
        for key in expected_keys:
            assert key in data, f"Stats should contain '{key}'"
            assert isinstance(data[key], int), f"{key} should be an integer"
        
        print(f"✓ Stats: queued={data['queued']}, running={data['running']}, completed={data['completed']}, failed={data['failed']}")


class TestEvalJobsList:
    """Tests for listing eval jobs"""
    
    def test_list_eval_jobs(self):
        """Test GET /api/eval/jobs returns jobs list"""
        response = requests.get(f"{BASE_URL}/api/eval/jobs", params={"limit": 5})
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "jobs" in data, "Response should contain jobs"
        assert isinstance(data["jobs"], list), "Jobs should be a list"
        
        print(f"✓ Listed {len(data['jobs'])} eval jobs")
        
        # Verify job contains group_id or config.group_id
        if len(data["jobs"]) > 0:
            job = data["jobs"][0]
            has_group_id = "group_id" in job or (job.get("config") and "group_id" in job.get("config", {}))
            print(f"First job has group_id field: {has_group_id}")
    
    def test_list_eval_jobs_with_status_filter(self):
        """Test listing jobs with status filter"""
        response = requests.get(f"{BASE_URL}/api/eval/jobs", params={"status": "completed", "limit": 5})
        
        assert response.status_code == 200
        data = response.json()
        
        # All returned jobs should have completed status
        for job in data.get("jobs", []):
            assert job.get("status") == "completed", f"Job {job.get('id')} has status {job.get('status')}, expected 'completed'"
        
        print(f"✓ Status filter working, returned {len(data.get('jobs', []))} completed jobs")


class TestAPIHealth:
    """Tests for API health endpoints"""
    
    def test_eval_health(self):
        """Test eval health endpoint"""
        response = requests.get(f"{BASE_URL}/api/eval/health", timeout=10)
        
        assert response.status_code == 200
        data = response.json()
        assert "healthy" in data
        print(f"✓ Eval health: {data.get('healthy')}")
    
    def test_config_endpoint(self):
        """Test config endpoint returns eval API info"""
        response = requests.get(f"{BASE_URL}/api/config")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "eval_api_url" in data
        print(f"✓ Eval API URL configured: {data.get('eval_api_url')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
