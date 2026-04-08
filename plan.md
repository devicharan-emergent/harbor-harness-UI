# ACM Dual-Mode Data Source Plan (MongoDB ↔ Builder API)

## 1) Objectives
- Maintain a **single backend abstraction** (`AgentService`) that routes **all Agent CRUD + versioning** and supports runtime switching.
- Provide a **capability-driven** Builder mode:
  - **Builder API is fully enabled** (CRUD is live against the Cloud Run Builder service).
  - Enforce **per-agent restrictions**:
    - `source=filesystem` agents are **view-only** (cannot update/delete).
    - `source=database` agents support **full CRUD**.
  - Ensure the UI reflects **capabilities** and prevents destructive actions:
    - MongoDB = full CRUD + versions.
    - Builder API = full CRUD for database agents; filesystem agents are view-only.
- Preserve all core product flows (Agents, Editor, Compare, Version History, Wizard, **Evals**) across both modes.
- **Eval UX and correctness (latest Eval API)**:
  - Eval submission matches the **latest Harbor Harness Eval API** format.
  - Users can **preview and view problem statements** used for evals.
  - Eval score display matches API truth (top-level fields).
- **Phase 6 Objectives (New, In Progress)**
  1) **Batch Eval Queueing**
     - Allow queuing **multiple evals at once**:
       - Multiple problems with the same agent.
       - Multiple agents with the same problem set (**fan-out**).
       - Explicit **1:1 pairing** (Agent A → Problem X, Agent B → Problem Y), including multi-row pair lists.
     - Agent association is **UI-level** only (Eval API doesn’t accept `agent_id`): store association in `experiments.agent_name` for later display/filtering.
  2) **Dataset / Problem Statement CRUD**
     - Provide full dataset management UI backed by Eval API CRUD endpoints via backend proxy:
       - View, create, edit (versioned), soft-delete.

---

## 2) Implementation Steps

### Phase 1 — Core Integration POC (Isolation) — **COMPLETED**
**Goal:** Prove dual-mode switching + safe Builder behavior works end-to-end without breaking Mongo.

**POC User Stories (Verified)**
1. As a user, I can toggle data source and immediately see which mode I’m in.
2. As a user, when Builder mode has no agent endpoints, I see an empty list with a clear explanation (not a spinner).
3. As a user, I cannot create/edit/delete agents in Builder mode.
4. As a user, switching back to MongoDB restores full CRUD and my existing agent list.
5. As a user, health indicators still report Eval API + Builder health correctly.

**Backend (Implemented)**
- Refactored **all** `server.py` agent endpoints to route through the service layer.
- Added capability endpoint:
  - `GET /api/capabilities` → `{ data_source, read_only, features, message? }`
- Implemented Builder read-only semantics with graceful handling (initially, endpoints returned 404/unreachable).
- Fixed backend configuration formatting:
  - Corrected `/app/backend/.env` formatting (separate `CORS_ORIGINS` and `USE_BUILDER_API`).

**Frontend (Implemented)**
- Added capability fetching + caching via context:
  - `CapabilitiesProvider` + `useCapabilities()` hook.
- AgentList/AgentEditor/VersionHistory/DataSourceIndicator updated to reflect read-only Builder mode.

**POC Verification (Completed)**
- Verified toggle MongoDB ↔ Builder API via UI and API.
- Confirmed **Builder API initially had no agent CRUD endpoints** (404s).

---

### Phase 2 — V1 App Development (Integrate + Polish) — **COMPLETED**
**Goal:** Make dual-mode behavior consistent across all pages and add user-facing clarity.

**V1 User Stories (Verified)**
1. User can always identify active data source.
2. Browsing agents works in both modes without broken navigation.
3. MongoDB mode remains fully functional.
4. Builder mode clearly communicates limitations via banners and UI state.
5. Errors are actionable.

**Testing (Completed)**
- Ran comprehensive end-to-end testing.

---

### Phase 3 — More Features (when Builder adds endpoints) — **SUPERSEDED**
**Original Goal:** Upgrade Builder mode from read-only/empty to fully functional as Builder endpoints roll out.

**Status Update**
- Builder agent endpoints are now live and fully integrated (see Phase 5).
- Remaining relevant items:
  - builder-provided dropdown metadata (models/tools/prompts) for richer UX
  - Builder-side validation integration

---

### Phase 4 — Eval Enhancement & Problem Statement Display — **COMPLETED**
**Goal:** Make eval creation correct against the latest Eval API, and make eval results understandable by surfacing the dataset problem statement.

**Context / API Truths (Confirmed)**
- Eval API base: `http://harness-eval.int-worker.dev.emergentagent.com`
- Correct eval submit request: `{ user_id?, group_id?, evals: [{ problem, cpus?, memory?, storage?, headed?, force_build?, experiments? }] }`
- Job score fields appear at **top level** (`browser_reward`, `lintiq_score`, `combined_reward`).
- Dataset lookup by **type + instance** is reliable.

#### Phase 4A — Backend (Proxy) — **DONE**
- Fixed eval submission proxy (`POST /api/eval/jobs`) + legacy support.
- Added dataset proxy endpoints:
  - `GET /api/eval/datasets`
  - `GET /api/eval/datasets/types/{dataset_type}`
  - `GET /api/eval/datasets/types/{dataset_type}/instances/{instance_id}`
  - `GET /api/eval/datasets/by-name/{name:path}` (present but not relied on)

#### Phase 4B — Frontend — **DONE**
- RunEvalModal rewritten as a 3-step wizard (select problems → configure → review/submit) with dataset preview.
- EvalRuns shows problem statement snippet; JobDetail shows full problem statement and correct scores.
- Added **New Eval** button to `/evals`.

#### Phase 4C — Testing — **DONE**
- Backend + Frontend tested end-to-end against real Eval API.

---

### Phase 5 — Enable Full Builder API CRUD — **COMPLETED**
**Goal:** Make Builder mode fully functional using the live Builder service, while respecting filesystem vs database constraints.

#### Phase 5A — Builder API Reality Check (Confirmed)
**Service URL (new):** `https://cortex-eph-builder-1035522277200.us-central1.run.app`

- Agents:
  - List: `GET /api/v1/builder/agents` → ~110 agents (mix of `filesystem` and `database`).
  - CRUD + validate + YAML export supported.
  - **Quirk:** ensure `metadata.version = 1` on create.
- Metadata:
  - Models/Tools/Prompts endpoints available.

#### Phase 5B — Backend Work — **DONE**
- Updated Builder base URL + health check.
- Rewrote `BuilderAPIAgentService` for real CRUD + transformations.
- Enforced filesystem restrictions with clear **403**.
- Added backend proxy endpoints:
  - `GET /api/builder/models`
  - `GET /api/builder/tools`
  - `GET /api/builder/prompts`

#### Phase 5C — Frontend Work — **DONE**
- Builder mode now mixed-mode:
  - New Agent enabled.
  - Filesystem agents show lock + `fs` badge; database agents show `db` badge.
  - Filesystem AgentEditor is read-only but supports **Clone → edit saved copy**.

#### Phase 5D — Testing — **DONE**
- Backend: toggle, list/get, create/update/delete database agent, clone, filesystem protection.
- Frontend: Builder list rendering, badges, filesystem editor behavior, mode switching.

---

### Phase 6 — Batch Eval Queueing + Dataset CRUD — **IN PROGRESS**

#### Feature 1: Batch Eval Queueing — **Planned / In Progress**
**Goal:** Make it obvious and easy to submit multiple eval jobs in one action, across many problems and/or many agents.

**User Stories**
1. As a user, I can select **multiple problems** and submit them as a batch for the same agent.
2. As a user, I can select **multiple agents** and run the same problem set for all of them (**fan-out**).
3. As a user, I can explicitly create **pairings** of agent ↔ problem (1:1 mapping), and queue all of them at once.
4. As a user, I can see which agent a job was run with (association only) on EvalRuns + JobDetail.

**Backend Changes**
- No Eval API contract change needed.
- Ensure submission payload uses `evals: [...]` where each eval includes agent association:
  - Store agent reference in `experiments.agent_name`.
  - If user selects an agent but leaves experiments blank, auto-inject `experiments.agent_name = <agent display name or id>`.

**Frontend Changes**
- Update RunEvalModal flow:
  - **Select Problems → Select Agents → Configure → Review & Submit**
  - Add mode selector:
    - Fan-out: problems × agents.
    - 1:1 mapping: editable pairing table.
- Review step should show the expanded list of jobs to be queued and allow removing rows.
- Show agent association in:
  - EvalRuns rows (e.g., badge “Agent: X”).
  - JobDetail details panel.

**Testing**
- Submit batch in each mode:
  - Multiple problems single agent.
  - Multiple agents same problems.
  - 1:1 mapping list.
- Confirm jobs appear in `/evals` with agent association visible.

---

#### Feature 2: Dataset / Problem Statement CRUD — **Planned / In Progress**
**Goal:** Allow users to view/create/edit/delete datasets directly from ACM.

**Backend Changes (Proxy)**
Add CRUD proxies to Eval API:
- `POST /api/eval/datasets` → forwards to `POST /api/v1/datasets`
- `PUT /api/eval/datasets/{id}` → forwards to `PUT /api/v1/datasets/{id}`
- `DELETE /api/eval/datasets/{id}` → forwards to `DELETE /api/v1/datasets/{id}` (soft delete)

**Frontend Changes**
- Add **Datasets page** at `/datasets`:
  - List view with:
    - type filter (Scratch Bench Phased / Bug Bench / Test Report Bench)
    - search
    - view details drawer (problem statement + NL tests)
  - Create/Edit modal (versioned updates)
  - Delete with confirmation (soft delete)

**Create Dataset Form (per latest requirements)**
- Required:
  - Dataset Type (dropdown)
  - Instance ID
  - Attributes:
    - scratch_bench_phased: **Phased NL Test Cases** required (attributes)
- Optional:
  - Description
  - Problem Statement
  - Natural Language Tests
  - Tags
  - Subagents
  - Preview URL
  - Image
  - Agent Name

**Type-specific attribute requirements**
- `scratch_bench_phased`:
  - `problem_statement` and `natural_language_tests` must be wrapped in `<phases>...</phases>` when present.
  - attributes may include: `subagents`, `preview_url`, `image`, `agent_name`.
- `bug_bench`:
  - attributes required: `repo`, `eph_job_id`.
  - optional: commits, PR/issue numbers, request_id, plus `image`, `agent_name`, `model_name`.
- `test_report_bench`:
  - attributes required: `repo`, `eph_job_id`, `testing_hitl`, `Bug_description`, `Bug_fix_status`.

**Testing**
- Create dataset for each dataset_type.
- Edit dataset (verify version increments).
- Delete dataset (verify `is_active=false` and removed from default list).
- Confirm datasets appear in RunEvalModal selection and problem statement preview.

---

## 3) Next Actions
1. **Phase 6 — Batch Eval Queueing**
   - Add agent selection step + pairing UX.
   - Display agent association on eval list/detail.
2. **Phase 6 — Dataset CRUD**
   - Add Eval API CRUD proxies.
   - Build `/datasets` management page + forms.
3. **Dropdown metadata integration (Builder)**
   - Use `/api/builder/models`, `/api/builder/tools`, `/api/builder/prompts` to populate editor dropdowns.
4. **Builder-side validation pre-save**
   - Call Builder `POST /agents/validate` before create/update; surface warnings/errors inline.
5. **Builder YAML export integration (optional UX)**
   - Use Builder `/agents/{id}/yaml` endpoint to export canonical YAML in Builder mode.

---

## 4) Success Criteria
- Data source toggling never breaks navigation; no indefinite loading spinners.
- MongoDB mode: all current agent flows work (list/create/edit/clone/delete/versions/restore/compare).
- Builder mode:
  - Shows real agents and supports full CRUD **for database agents**.
  - Filesystem agents are clearly indicated as read-only and cannot be edited/deleted.
  - Users can **clone filesystem agents** to a database-backed editable copy.
- **Evals**:
  - Submitting an eval produces real jobs (queued/accepted) with correct request format.
  - Users can see the **problem statement** for each eval.
  - Score display matches API reality.
- **Batch eval queueing**:
  - Users can queue multiple evals at once with fan-out and 1:1 pairing.
  - Agent association is visible on runs and detail pages.
- **Datasets**:
  - Users can view, create, edit, and soft-delete datasets via Eval API.
  - Dataset forms enforce required fields per dataset_type.
  - Newly created/updated datasets appear in the eval creation UX.
- Evals and health indicators remain functional in both modes.
