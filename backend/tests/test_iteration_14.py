"""
Backend API Tests for Iteration 14 Features
- Group Jobs API endpoint
- Eval API endpoints
- Capabilities endpoint
- Dataset CRUD endpoints
"""
import pytest
import requests
import os

# Use environment variable for base URL
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://youthful-haibt-1.stage-preview.emergentagent.com')


class TestCapabilitiesAPI:
    """Test capabilities endpoint returns correct feature flags"""
    
    def test_capabilities_endpoint(self):
        """Test GET /api/capabilities returns proper feature flags"""
        response = requests.get(f"{BASE_URL}/api/capabilities")
        assert response.status_code == 200
        
        data = response.json()
        assert "data_source" in data
        assert "features" in data
        assert "read_only" in data
        
        # Check features structure
        features = data["features"]
        assert "create" in features
        assert "update" in features
        assert "delete" in features
        assert "clone" in features
        
        print(f"Capabilities: data_source={data['data_source']}, read_only={data['read_only']}")


class TestGroupJobsAPI:
    """Test group jobs endpoint"""
    
    def test_group_jobs_existing_group(self):
        """Test GET /api/eval/groups/{group_id}/jobs for existing group"""
        response = requests.get(f"{BASE_URL}/api/eval/groups/grp-13/jobs")
        assert response.status_code == 200
        
        data = response.json()
        assert "jobs" in data
        print(f"Group grp-13 has {len(data.get('jobs', []))} jobs")
    
    def test_group_jobs_with_pagination(self):
        """Test group jobs endpoint with limit/offset params"""
        response = requests.get(
            f"{BASE_URL}/api/eval/groups/grp-13/jobs",
            params={"limit": 5, "offset": 0}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "jobs" in data
        assert len(data.get("jobs", [])) <= 5
    
    def test_group_jobs_nonexistent_group(self):
        """Test group jobs for non-existent group returns empty array"""
        response = requests.get(f"{BASE_URL}/api/eval/groups/nonexistent-group-xyz/jobs")
        # Should return 200 with empty jobs array
        assert response.status_code == 200
        
        data = response.json()
        assert "jobs" in data
        assert len(data.get("jobs", [])) == 0


class TestEvalAPI:
    """Test eval job endpoints"""
    
    def test_eval_stats(self):
        """Test GET /api/eval/stats returns status counts"""
        response = requests.get(f"{BASE_URL}/api/eval/stats")
        assert response.status_code == 200
        
        data = response.json()
        # Should have status keys
        expected_keys = ["queued", "generating", "running", "completed", "failed", "cancelled"]
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"
        
        print(f"Stats: {data}")
    
    def test_eval_jobs_list(self):
        """Test GET /api/eval/jobs returns job list"""
        response = requests.get(
            f"{BASE_URL}/api/eval/jobs",
            params={"limit": 10}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "jobs" in data
        
        # Verify job structure
        if len(data["jobs"]) > 0:
            job = data["jobs"][0]
            assert "id" in job
            assert "problem" in job
            assert "status" in job
            print(f"First job: id={job['id'][:8]}, status={job['status']}")
    
    def test_eval_jobs_with_status_filter(self):
        """Test GET /api/eval/jobs with status filter"""
        response = requests.get(
            f"{BASE_URL}/api/eval/jobs",
            params={"status": "completed", "limit": 5}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "jobs" in data
        
        # All jobs should have completed status
        for job in data.get("jobs", []):
            assert job.get("status") == "completed"


class TestDatasetAPI:
    """Test dataset CRUD endpoints"""
    
    def test_datasets_list(self):
        """Test GET /api/eval/datasets lists datasets"""
        response = requests.get(
            f"{BASE_URL}/api/eval/datasets",
            params={"limit": 10}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "datasets" in data
        
        if len(data["datasets"]) > 0:
            ds = data["datasets"][0]
            assert "id" in ds
            assert "name" in ds
            assert "dataset_type" in ds
            print(f"First dataset: {ds['name']}, type={ds['dataset_type']}")
    
    def test_datasets_by_type(self):
        """Test GET /api/eval/datasets/types/{type} filters by type"""
        response = requests.get(
            f"{BASE_URL}/api/eval/datasets/types/scratch_bench_phased",
            params={"limit": 5}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "datasets" in data
        
        # All datasets should be scratch_bench_phased type
        for ds in data.get("datasets", []):
            assert ds.get("dataset_type") == "scratch_bench_phased"
    
    def test_dataset_instance(self):
        """Test GET /api/eval/datasets/types/{type}/instances/{id}"""
        # First get a list to find a valid instance
        list_resp = requests.get(
            f"{BASE_URL}/api/eval/datasets/types/scratch_bench_phased",
            params={"limit": 1}
        )
        
        if list_resp.status_code == 200 and list_resp.json().get("datasets"):
            ds = list_resp.json()["datasets"][0]
            instance_id = ds.get("instance_id")
            
            if instance_id:
                response = requests.get(
                    f"{BASE_URL}/api/eval/datasets/types/scratch_bench_phased/instances/{instance_id}"
                )
                assert response.status_code == 200
                
                data = response.json()
                assert data.get("instance_id") == instance_id
                print(f"Got instance {instance_id}: has problem_statement={bool(data.get('problem_statement'))}")


class TestAgentAPI:
    """Test agent CRUD endpoints"""
    
    def test_agents_list(self):
        """Test GET /api/agents returns agent list"""
        response = requests.get(f"{BASE_URL}/api/agents")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            agent = data[0]
            assert "id" in agent
            assert "name" in agent
            print(f"Found {len(data)} agents")
    
    def test_agent_get_database_agent(self):
        """Test GET /api/agents/{id} for database agent"""
        response = requests.get(f"{BASE_URL}/api/agents/test123")
        
        # Agent may or may not exist
        if response.status_code == 200:
            data = response.json()
            assert data.get("id") == "test123"
            assert "source" in data  # Should indicate database source
            print(f"Agent test123: source={data.get('source')}")
        else:
            print(f"Agent test123 not found (status={response.status_code})")


class TestEvalHealth:
    """Test health endpoints"""
    
    def test_eval_health(self):
        """Test GET /api/eval/health"""
        response = requests.get(f"{BASE_URL}/api/eval/health")
        assert response.status_code == 200
        
        data = response.json()
        assert "healthy" in data
        print(f"Eval API healthy: {data['healthy']}")
    
    def test_builder_health(self):
        """Test GET /api/builder/health"""
        response = requests.get(f"{BASE_URL}/api/builder/health")
        assert response.status_code == 200
        
        data = response.json()
        assert "healthy" in data
        print(f"Builder API healthy: {data['healthy']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
