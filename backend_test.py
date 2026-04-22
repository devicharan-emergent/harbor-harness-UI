#!/usr/bin/env python3
"""
Backend API Testing for Scheduled Batches Proxy Endpoints
Tests the 6 new scheduled batches proxy endpoints in server.py
"""

import requests
import json
import time
import sys
from datetime import datetime

# Base URL from frontend/.env REACT_APP_BACKEND_URL
BASE_URL = "https://youthful-haibt-1.stage-preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

def log_test(test_name, status, details=""):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    status_symbol = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"[{timestamp}] {status_symbol} {test_name}")
    if details:
        print(f"    {details}")

def test_list_scheduled_batches():
    """Test 1: GET /api/eval/scheduled-batches"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches"
        response = requests.get(url, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if "batches" in data:
                log_test("GET /api/eval/scheduled-batches", "PASS", 
                        f"Status: {response.status_code}, Response has 'batches' key with {len(data['batches'])} items")
                return True
            else:
                log_test("GET /api/eval/scheduled-batches", "FAIL", 
                        f"Status: {response.status_code}, Missing 'batches' key in response: {data}")
                return False
        else:
            log_test("GET /api/eval/scheduled-batches", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test("GET /api/eval/scheduled-batches", "FAIL", f"Exception: {str(e)}")
        return False

def test_list_scheduled_batches_with_filter():
    """Test 2: GET /api/eval/scheduled-batches?enabled=true"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches"
        params = {"enabled": "true"}
        response = requests.get(url, params=params, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if "batches" in data:
                log_test("GET /api/eval/scheduled-batches?enabled=true", "PASS", 
                        f"Status: {response.status_code}, Query param forwarded successfully")
                return True
            else:
                log_test("GET /api/eval/scheduled-batches?enabled=true", "FAIL", 
                        f"Status: {response.status_code}, Missing 'batches' key in response")
                return False
        else:
            log_test("GET /api/eval/scheduled-batches?enabled=true", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test("GET /api/eval/scheduled-batches?enabled=true", "FAIL", f"Exception: {str(e)}")
        return False

def test_create_scheduled_batch():
    """Test 3: POST /api/eval/scheduled-batches"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches"
        timestamp = int(time.time())
        payload = {
            "name": f"acm-backend-test-{timestamp}",
            "cron_expression": "0 3 * * *",
            "problem_ids": ["scratch_bench_phased/do_it_app"],
            "enabled": True
        }
        
        response = requests.post(url, json=payload, timeout=30)
        
        if 200 <= response.status_code < 300:
            data = response.json()
            required_fields = ["id", "name", "cron_expression", "problem_ids", "enabled"]
            missing_fields = [field for field in required_fields if field not in data]
            
            if not missing_fields:
                batch_id = data["id"]
                log_test("POST /api/eval/scheduled-batches", "PASS", 
                        f"Status: {response.status_code}, Created batch with ID: {batch_id}")
                return batch_id
            else:
                log_test("POST /api/eval/scheduled-batches", "FAIL", 
                        f"Status: {response.status_code}, Missing fields: {missing_fields}")
                return None
        else:
            log_test("POST /api/eval/scheduled-batches", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return None
    except Exception as e:
        log_test("POST /api/eval/scheduled-batches", "FAIL", f"Exception: {str(e)}")
        return None

def test_get_scheduled_batch(batch_id):
    """Test 4: GET /api/eval/scheduled-batches/{id}"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches/{batch_id}"
        response = requests.get(url, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("id") == batch_id:
                log_test(f"GET /api/eval/scheduled-batches/{batch_id}", "PASS", 
                        f"Status: {response.status_code}, Retrieved batch successfully")
                return True
            else:
                log_test(f"GET /api/eval/scheduled-batches/{batch_id}", "FAIL", 
                        f"Status: {response.status_code}, ID mismatch in response")
                return False
        else:
            log_test(f"GET /api/eval/scheduled-batches/{batch_id}", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test(f"GET /api/eval/scheduled-batches/{batch_id}", "FAIL", f"Exception: {str(e)}")
        return False

def test_update_scheduled_batch(batch_id):
    """Test 5: PUT /api/eval/scheduled-batches/{id}"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches/{batch_id}"
        payload = {"enabled": False}
        
        response = requests.put(url, json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("enabled") is False:
                log_test(f"PUT /api/eval/scheduled-batches/{batch_id}", "PASS", 
                        f"Status: {response.status_code}, Successfully disabled batch")
                return True
            else:
                log_test(f"PUT /api/eval/scheduled-batches/{batch_id}", "FAIL", 
                        f"Status: {response.status_code}, Enabled field not updated correctly")
                return False
        else:
            log_test(f"PUT /api/eval/scheduled-batches/{batch_id}", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test(f"PUT /api/eval/scheduled-batches/{batch_id}", "FAIL", f"Exception: {str(e)}")
        return False

def test_trigger_scheduled_batch(batch_id):
    """Test 6: POST /api/eval/scheduled-batches/{id}/trigger"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches/{batch_id}/trigger"
        response = requests.post(url, timeout=60)
        
        if 200 <= response.status_code < 300:
            data = response.json()
            required_fields = ["batch_id", "eval_job_ids"]
            missing_fields = [field for field in required_fields if field not in data]
            
            if not missing_fields:
                eval_job_ids = data.get("eval_job_ids", [])
                log_test(f"POST /api/eval/scheduled-batches/{batch_id}/trigger", "PASS", 
                        f"Status: {response.status_code}, Triggered batch, eval_job_ids: {len(eval_job_ids)} jobs")
                return True
            else:
                log_test(f"POST /api/eval/scheduled-batches/{batch_id}/trigger", "FAIL", 
                        f"Status: {response.status_code}, Missing fields: {missing_fields}")
                return False
        else:
            log_test(f"POST /api/eval/scheduled-batches/{batch_id}/trigger", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test(f"POST /api/eval/scheduled-batches/{batch_id}/trigger", "FAIL", f"Exception: {str(e)}")
        return False

def test_delete_scheduled_batch(batch_id):
    """Test 7: DELETE /api/eval/scheduled-batches/{id}"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches/{batch_id}"
        response = requests.delete(url, timeout=30)
        
        if 200 <= response.status_code < 300:
            log_test(f"DELETE /api/eval/scheduled-batches/{batch_id}", "PASS", 
                    f"Status: {response.status_code}, Successfully deleted batch")
            return True
        else:
            log_test(f"DELETE /api/eval/scheduled-batches/{batch_id}", "FAIL", 
                    f"Status: {response.status_code}, Response: {response.text}")
            return False
    except Exception as e:
        log_test(f"DELETE /api/eval/scheduled-batches/{batch_id}", "FAIL", f"Exception: {str(e)}")
        return False

def test_validation_error():
    """Test 8: POST with invalid body for validation testing"""
    try:
        url = f"{API_BASE}/eval/scheduled-batches"
        payload = {
            "name": "",
            "cron_expression": "not a cron",
            "problem_ids": []
        }
        
        response = requests.post(url, json=payload, timeout=30)
        
        if 400 <= response.status_code < 500:
            try:
                data = response.json()
                detail = data.get("detail", "")
                log_test("POST /api/eval/scheduled-batches (validation error)", "PASS", 
                        f"Status: {response.status_code}, Validation error returned: {detail}")
                return True
            except:
                log_test("POST /api/eval/scheduled-batches (validation error)", "PASS", 
                        f"Status: {response.status_code}, Validation error returned (non-JSON response)")
                return True
        else:
            log_test("POST /api/eval/scheduled-batches (validation error)", "FAIL", 
                    f"Status: {response.status_code}, Expected 4xx error but got: {response.text}")
            return False
    except Exception as e:
        log_test("POST /api/eval/scheduled-batches (validation error)", "FAIL", f"Exception: {str(e)}")
        return False

def test_nonexistent_batch():
    """Test 9: GET non-existent batch ID"""
    try:
        fake_id = "does-not-exist-uuid"
        url = f"{API_BASE}/eval/scheduled-batches/{fake_id}"
        response = requests.get(url, timeout=30)
        
        if 400 <= response.status_code < 500:
            log_test(f"GET /api/eval/scheduled-batches/{fake_id} (non-existent)", "PASS", 
                    f"Status: {response.status_code}, Correctly returned 4xx for non-existent ID")
            return True
        else:
            log_test(f"GET /api/eval/scheduled-batches/{fake_id} (non-existent)", "FAIL", 
                    f"Status: {response.status_code}, Expected 4xx error but got: {response.text}")
            return False
    except Exception as e:
        log_test(f"GET /api/eval/scheduled-batches/does-not-exist-uuid (non-existent)", "FAIL", f"Exception: {str(e)}")
        return False

def main():
    """Run all scheduled batches proxy endpoint tests"""
    print("=" * 80)
    print("SCHEDULED BATCHES PROXY ENDPOINTS TEST")
    print("=" * 80)
    print(f"Testing against: {API_BASE}")
    print()
    
    results = []
    batch_id = None
    
    # Test 1: List batches
    results.append(test_list_scheduled_batches())
    
    # Test 2: List batches with filter
    results.append(test_list_scheduled_batches_with_filter())
    
    # Test 3: Create batch (save ID for subsequent tests)
    batch_id = test_create_scheduled_batch()
    results.append(batch_id is not None)
    
    if batch_id:
        # Test 4: Get specific batch
        results.append(test_get_scheduled_batch(batch_id))
        
        # Test 5: Update batch
        results.append(test_update_scheduled_batch(batch_id))
        
        # Test 6: Trigger batch
        results.append(test_trigger_scheduled_batch(batch_id))
        
        # Test 7: Delete batch (cleanup)
        results.append(test_delete_scheduled_batch(batch_id))
    else:
        print("⚠️  Skipping tests 4-7 because batch creation failed")
        results.extend([False, False, False, False])
    
    # Test 8: Validation error
    results.append(test_validation_error())
    
    # Test 9: Non-existent batch
    results.append(test_nonexistent_batch())
    
    # Summary
    print()
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(results)
    total = len(results)
    print(f"Tests passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All scheduled batches proxy endpoints are working correctly!")
        return 0
    else:
        print("❌ Some tests failed. Check the logs above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())