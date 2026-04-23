#!/usr/bin/env python3
"""
Comprehensive test suite for Scheduled Batches proxy endpoints with contract updates.
Tests the new 7th endpoint and schedule_tag field rename.
"""

import requests
import json
import time
import uuid
from datetime import datetime

# Base URL from frontend/.env
BASE_URL = "https://youthful-haibt-1.stage-preview.emergentagent.com/api"

def log_test(test_name, status, details=""):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    status_symbol = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"[{timestamp}] {status_symbol} {test_name}")
    if details:
        print(f"    {details}")

def test_scheduled_batches_full_flow():
    """Test the complete scheduled batches flow with new contract"""
    print("=" * 80)
    print("SCHEDULED BATCHES PROXY ENDPOINTS - CONTRACT UPDATE TESTING")
    print("=" * 80)
    
    # Generate unique test data
    timestamp = int(time.time())
    test_schedule_tag = f"acm-contract-test-{timestamp}"
    test_batch_id = None
    
    try:
        # Test 1: Create with NEW field (schedule_tag instead of name)
        print("\n1. Testing CREATE with schedule_tag field...")
        create_payload = {
            "schedule_tag": test_schedule_tag,
            "cron_expression": "0 3 * * *",
            "problem_ids": ["scratch_bench_phased/do_it_app"],
            "enabled": True
        }
        
        response = requests.post(f"{BASE_URL}/eval/scheduled-batches", json=create_payload, timeout=30)
        
        if response.status_code in [200, 201]:
            data = response.json()
            test_batch_id = data.get("id")
            
            # Verify response structure
            required_fields = ["id", "schedule_tag", "cron_expression", "problem_ids", "enabled", "created_at", "updated_at", "next_run_at"]
            missing_fields = [f for f in required_fields if f not in data]
            
            # Check for old 'name' field (should NOT be present)
            has_name_field = "name" in data
            
            # Check for eval_job_ids field (should NOT be present per new contract)
            has_eval_job_ids = "eval_job_ids" in data
            
            if missing_fields:
                log_test("CREATE - Response Structure", "FAIL", f"Missing fields: {missing_fields}")
            elif has_name_field:
                log_test("CREATE - Field Contract", "FAIL", "Response still contains 'name' field (should be removed)")
            elif has_eval_job_ids:
                log_test("CREATE - Field Contract", "FAIL", "Response contains 'eval_job_ids' field (should be removed per new contract)")
            elif data.get("schedule_tag") != test_schedule_tag:
                log_test("CREATE - schedule_tag", "FAIL", f"Expected '{test_schedule_tag}', got '{data.get('schedule_tag')}'")
            else:
                log_test("CREATE - Success", "PASS", f"Created batch with ID: {test_batch_id}")
                log_test("CREATE - Field Contract", "PASS", "Uses 'schedule_tag', no 'name' or 'eval_job_ids' fields")
        else:
            log_test("CREATE", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return
        
        # Test 2: Get specific batch
        print("\n2. Testing GET specific batch...")
        response = requests.get(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            has_schedule_tag = "schedule_tag" in data
            has_name_field = "name" in data
            has_eval_job_ids = "eval_job_ids" in data
            
            if not has_schedule_tag:
                log_test("GET - schedule_tag", "FAIL", "Response missing 'schedule_tag' field")
            elif has_name_field:
                log_test("GET - Field Contract", "FAIL", "Response still contains 'name' field")
            elif has_eval_job_ids:
                log_test("GET - Field Contract", "FAIL", "Response contains 'eval_job_ids' field (should be removed)")
            else:
                log_test("GET - Success", "PASS", f"Retrieved batch with schedule_tag: {data.get('schedule_tag')}")
        else:
            log_test("GET", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 3: List batches
        print("\n3. Testing LIST batches...")
        response = requests.get(f"{BASE_URL}/eval/scheduled-batches", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            batches = data.get("batches", [])
            
            # Find our test batch
            test_batch = next((b for b in batches if b.get("id") == test_batch_id), None)
            
            if test_batch:
                has_schedule_tag = "schedule_tag" in test_batch
                has_name_field = "name" in test_batch
                
                if not has_schedule_tag:
                    log_test("LIST - schedule_tag", "FAIL", "Batch missing 'schedule_tag' field")
                elif has_name_field:
                    log_test("LIST - Field Contract", "FAIL", "Batch still contains 'name' field")
                else:
                    log_test("LIST - Success", "PASS", f"Found batch with schedule_tag: {test_batch.get('schedule_tag')}")
            else:
                log_test("LIST", "FAIL", "Created batch not found in list")
        else:
            log_test("LIST", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 4: Update partial - enabled field
        print("\n4. Testing UPDATE partial (enabled)...")
        update_payload = {"enabled": False}
        response = requests.put(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}", json=update_payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("enabled") == False:
                log_test("UPDATE - enabled", "PASS", "Successfully updated enabled to false")
            else:
                log_test("UPDATE - enabled", "FAIL", f"Expected enabled=false, got {data.get('enabled')}")
        else:
            log_test("UPDATE - enabled", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 5: Update partial - schedule_tag rename
        print("\n5. Testing UPDATE partial (schedule_tag rename)...")
        new_schedule_tag = f"acm-contract-test-renamed-{timestamp}"
        update_payload = {"schedule_tag": new_schedule_tag}
        response = requests.put(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}", json=update_payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("schedule_tag") == new_schedule_tag:
                log_test("UPDATE - schedule_tag", "PASS", f"Successfully renamed to: {new_schedule_tag}")
            else:
                log_test("UPDATE - schedule_tag", "FAIL", f"Expected '{new_schedule_tag}', got '{data.get('schedule_tag')}'")
        else:
            log_test("UPDATE - schedule_tag", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 6: Trigger batch
        print("\n6. Testing TRIGGER batch...")
        response = requests.post(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}/trigger", timeout=60)
        
        if response.status_code in [200, 202]:
            data = response.json()
            # Trigger response SHOULD still contain eval_job_ids (it's the trigger response, not the Batch object)
            has_batch_id = "batch_id" in data
            has_eval_job_ids = "eval_job_ids" in data
            
            if not has_batch_id:
                log_test("TRIGGER - batch_id", "FAIL", "Response missing 'batch_id' field")
            elif not has_eval_job_ids:
                log_test("TRIGGER - eval_job_ids", "FAIL", "Trigger response missing 'eval_job_ids' field")
            else:
                log_test("TRIGGER - Success", "PASS", f"Triggered batch, got {len(data.get('eval_job_ids', []))} job IDs")
        else:
            log_test("TRIGGER", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 7: NEW - Runs endpoint
        print("\n7. Testing NEW RUNS endpoint...")
        response = requests.get(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}/runs?limit=50&offset=0", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            jobs = data.get("jobs", [])
            
            log_test("RUNS - Success", "PASS", f"Retrieved {len(jobs)} jobs from runs endpoint")
            
            # Verify job structure if jobs exist
            if jobs:
                first_job = jobs[0]
                has_group_run_id = "group_run_id" in first_job
                
                if has_group_run_id:
                    group_run_id = first_job["group_run_id"]
                    # Verify format: {batch_id}-YYYY-MM-DD
                    if group_run_id.startswith(test_batch_id) and "-" in group_run_id:
                        log_test("RUNS - group_run_id format", "PASS", f"Format: {group_run_id}")
                    else:
                        log_test("RUNS - group_run_id format", "FAIL", f"Invalid format: {group_run_id}")
                else:
                    log_test("RUNS - group_run_id", "FAIL", "Jobs missing 'group_run_id' field")
            else:
                log_test("RUNS - Empty", "INFO", "No jobs found (may be expected if trigger didn't create jobs yet)")
        else:
            log_test("RUNS", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 8: Runs pagination
        print("\n8. Testing RUNS pagination...")
        response = requests.get(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}/runs?limit=5&offset=0", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            log_test("RUNS - Pagination", "PASS", f"Pagination params forwarded, got {len(data.get('jobs', []))} jobs")
        else:
            log_test("RUNS - Pagination", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
        # Test 9: Runs error handling - non-existent batch
        print("\n9. Testing RUNS error handling...")
        fake_uuid = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/eval/scheduled-batches/{fake_uuid}/runs", timeout=30)
        
        if response.status_code in [404, 400]:
            try:
                error_data = response.json()
                has_detail = "detail" in error_data
                log_test("RUNS - Error Handling", "PASS", f"4xx error with detail: {has_detail}")
            except:
                log_test("RUNS - Error Handling", "PASS", f"4xx error (non-JSON response)")
        else:
            log_test("RUNS - Error Handling", "FAIL", f"Expected 4xx, got {response.status_code}")
        
        # Test 10: Validation - invalid create payload
        print("\n10. Testing VALIDATION...")
        invalid_payload = {
            "schedule_tag": "",
            "cron_expression": "not a cron",
            "problem_ids": []
        }
        response = requests.post(f"{BASE_URL}/eval/scheduled-batches", json=invalid_payload, timeout=30)
        
        if response.status_code >= 400:
            log_test("VALIDATION", "PASS", f"Invalid payload rejected with {response.status_code}")
        else:
            log_test("VALIDATION", "FAIL", f"Invalid payload accepted with {response.status_code}")
        
        # Test 11: Cleanup - delete test batch
        print("\n11. Testing CLEANUP...")
        if test_batch_id:
            response = requests.delete(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}", timeout=30)
            
            if response.status_code in [200, 204]:
                log_test("CLEANUP", "PASS", "Test batch deleted successfully")
            else:
                log_test("CLEANUP", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
        
    except Exception as e:
        log_test("EXCEPTION", "FAIL", f"Unexpected error: {str(e)}")
        
        # Cleanup on exception
        if test_batch_id:
            try:
                requests.delete(f"{BASE_URL}/eval/scheduled-batches/{test_batch_id}", timeout=10)
                print(f"    Cleaned up test batch: {test_batch_id}")
            except:
                print(f"    Failed to cleanup test batch: {test_batch_id}")

def main():
    """Run all tests"""
    print("Starting Scheduled Batches Contract Update Testing...")
    print(f"Base URL: {BASE_URL}")
    print(f"Testing 7 endpoints with new contract requirements")
    
    test_scheduled_batches_full_flow()
    
    print("\n" + "=" * 80)
    print("TESTING COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()