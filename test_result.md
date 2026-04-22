#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Add a new Scheduled Eval Batches feature to ACM. The backend (harbor-harness) now supports named
  bundles of problems that run automatically on a cron schedule. ACM must expose this feature in its UI:
  list/create/edit/enable-disable/delete/manually-trigger scheduled batches, and display the eval jobs
  each batch has fired. Add 6 new proxy routes to server.py plus new /schedules pages (List, Editor,
  Detail). Do not modify unrelated existing components.

backend:
  - task: "Scheduled Batches proxy endpoints"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Added 6 new proxy endpoints under /api/eval/scheduled-batches that forward to
            harbor-harness /api/v1/scheduled-batches:
              POST   /api/eval/scheduled-batches               → create
              GET    /api/eval/scheduled-batches?enabled=true  → list (optional enabled filter)
              GET    /api/eval/scheduled-batches/{id}          → get
              PUT    /api/eval/scheduled-batches/{id}          → update (partial allowed)
              DELETE /api/eval/scheduled-batches/{id}          → delete
              POST   /api/eval/scheduled-batches/{id}/trigger  → trigger now
            Pattern mirrors the existing proxy_list_eval_jobs / proxy_create_dataset routes.
            Local sanity: `curl http://localhost:8001/api/eval/scheduled-batches` returned 200.
        - working: true
          agent: "testing"
          comment: |
            ✅ ALL 6 SCHEDULED BATCHES PROXY ENDPOINTS WORKING CORRECTLY
            Comprehensive testing completed with 9/9 tests passed:
            
            Core CRUD Operations:
            ✅ GET /api/eval/scheduled-batches → 200 with {batches: []} structure
            ✅ GET /api/eval/scheduled-batches?enabled=true → 200, query param forwarded correctly
            ✅ POST /api/eval/scheduled-batches → 201, created batch with proper ID/fields
            ✅ GET /api/eval/scheduled-batches/{id} → 200, retrieved specific batch
            ✅ PUT /api/eval/scheduled-batches/{id} → 200, updated enabled field correctly
            ✅ POST /api/eval/scheduled-batches/{id}/trigger → 202, triggered with eval_job_ids
            ✅ DELETE /api/eval/scheduled-batches/{id} → 200, successfully deleted
            
            Error Handling:
            ✅ POST with invalid body → 400 with proper validation error message
            ✅ GET non-existent ID → 404 as expected
            
            All endpoints properly proxy to harbor-harness service and handle responses correctly.
            Backend logs show clean HTTP communication with upstream service.
            No critical issues found.

frontend:
  - task: "Schedules UI (List / Editor / Detail + nav entry + routes)"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/SchedulesList.js, ScheduleEditor.js, ScheduleDetail.js, services/schedulesApi.js, App.js, components/layout/AppShell.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Added new /schedules section:
              - SchedulesList: table of batches (Name, Schedule humanized, Problems count, Last/Next
                run relative, Jobs fired, Enabled Switch, Actions dropdown with Edit/Trigger Now/Delete),
                + "Show enabled only" filter, Refresh + New Schedule buttons, empty state.
              - ScheduleEditor: 4-step wizard (Name+Schedule with cron preset dropdown and live
                humanized preview, Problems multi-select reusing listDatasets/listDatasetsByType,
                Enabled toggle, Review), handles both /schedules/new and /schedules/:id/edit.
              - ScheduleDetail: two-column (Problems + Fired Jobs list linking to /evals/{id}) +
                sidebar (Details card with copyable ID, schedule, relative & absolute timestamps,
                Stats card). Polls every 30s for new fired jobs.
              - App.js: added imports + 4 routes (/schedules, /schedules/new, /schedules/:id,
                /schedules/:id/edit).
              - AppShell.js: added "Schedules" nav item with CalendarClock icon between Evals & Datasets.
            No existing pages/components modified beyond the minimal 3 files called out in the spec.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        Please test the 6 new backend proxy endpoints under /api/eval/scheduled-batches. They are pure
        pass-throughs to the external harbor-harness service
        (http://harness-eval.int-worker.dev.emergentagent.com/api/v1/scheduled-batches). Focus on:
          1. GET /api/eval/scheduled-batches returns 200 with {batches: [...]} shape (may be empty).
          2. GET /api/eval/scheduled-batches?enabled=true forwards the query param.
          3. POST /api/eval/scheduled-batches with a body like
               {"name":"acm-test-NNN", "cron_expression":"0 3 * * *",
                "problem_ids":["scratch_bench_phased/do_it_app"], "enabled":true}
             returns the created batch with an `id`. Save the id for subsequent tests and delete it at the end.
          4. GET /api/eval/scheduled-batches/{id} returns the same object.
          5. PUT /api/eval/scheduled-batches/{id} with {"enabled":false} returns updated object.
          6. POST /api/eval/scheduled-batches/{id}/trigger returns {batch_id, eval_job_ids:[...]}.
          7. DELETE /api/eval/scheduled-batches/{id} returns {status:"deleted"} (or similar 2xx).
          8. Validation: POST with {"name":"", "cron_expression":"not a cron", "problem_ids":[]}
             should surface a 4xx error from upstream.
        If the upstream service doesn't yet have scheduled-batches endpoints live, any 404/5xx error
        that comes back as a clean HTTPException with a readable message is acceptable — flag it so
        I can inform the user. Do NOT retest frontend; that will happen after user approval.
    - agent: "testing"
      message: |
        ✅ SCHEDULED BATCHES PROXY ENDPOINTS TESTING COMPLETE - ALL WORKING
        
        Successfully tested all 6 scheduled batches proxy endpoints with comprehensive test suite.
        All 9 test cases passed including CRUD operations and error handling.
        
        Key findings:
        • All endpoints properly proxy to harbor-harness service
        • Correct HTTP status codes and response structures
        • Query parameters forwarded correctly (?enabled=true)
        • Proper error handling for validation and non-existent resources
        • Clean backend logs with no errors
        • Upstream harbor-harness service is fully operational
        
        The implementation is production-ready. No issues found.
