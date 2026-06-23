# ACM - Agent Configuration Manager

## Original Problem Statement
Build an Agent Configuration Manager (ACM) for managing AI agent configurations, running evaluations, and managing datasets.

## Core Requirements
- **Agent CRUD**: Full create, read, update, delete for agent configurations
- **Dual Data Source**: Switch between MongoDB (local) and Builder API (external)
- **Evaluation Suite**: Submit and monitor evaluation jobs against the Eval API
- **Dataset Management**: Full CRUD for evaluation datasets/problem statements
- **Multi-Eval Submission**: Submit batches of evals with mandatory group_id
- **Environment Switching**: Toggle between dev and ephemeral deployment environments
- **Google Authentication + per-user ownership**: Gate the app behind login; every eval/schedule request carries the user's UUID as `created_by`.

## Architecture
- **Frontend**: React + Tailwind CSS + Shadcn UI (port 3000)
- **Backend**: FastAPI + MongoDB (port 8001)
- **External APIs**: Eval API (harness-eval), Builder API (cortex-eph-builder)
- **Pattern**: Backend-for-Frontend (BFF) with proxy endpoints
- **State Management**: React Context (EnvContext, AuthContext)
- **Auth**: Emergent-managed Google OAuth; session token in `localStorage` (`acm_session_token`) sent as `?access_token=` query param on auth calls.
- **Ownership**: `created_by` (user UUID) injected via axios interceptor — query param on GET/DELETE, JSON body on POST/PUT/PATCH. Scoped to `/api/eval/jobs*`, `/api/eval/groups/*/jobs*`, and `/api/eval/scheduled-batches*`.

## Pages
1. Agent List (`/`), Agent Editor, Compare, Version History, Wizard
2. Eval Runs (`/evals`), Job Detail (`/evals/:id`)
3. Datasets (`/datasets`)
4. Schedules (`/schedules`, `/schedules/:id`, editor)
5. Auth: `/login`, `/auth/callback`

## What's Been Implemented
- [x] Dual-mode switching (MongoDB <-> Builder API)
- [x] Eval API integration + problem-statement display
- [x] Full Builder API CRUD
- [x] Dataset CRUD with problem-type wizards (incl. scratch_bench_phased multi-phase editor)
- [x] Multi-Eval Submission with mandatory group_id (moved to payload top level)
- [x] Grouped Eval Runs, Environment Switcher, Agent Deletion
- [x] Scheduled Batches CRUD + trigger + runs history
- [x] ScheduleDetail Analytics: SummaryKPIs, PhaseHeatmap, per-problem time series, sortable ProblemLeaderboard, Sparkline component
- [x] Run-Evaluation 3-step wizard with `agent_name` free-text + existence check via `/cortex/agents/exists`
- [x] Bug-bench image_available indicator (green/red dot)
- [x] **Google Authentication** (Feb 2026) — Emergent-managed OAuth, login page, protected routes, user menu with logout
- [x] **Per-user ownership** (Feb 2026) — `created_by` UUID threaded through every relevant request via centralised axios interceptor (`src/services/apiHelpers.js`) and backend proxy pass-through
- [x] **Runtime same-origin API baseURL** (Feb 2026) — `src/services/apiBase.js::getApiBaseURL()` falls back to `window.location.origin` when the served page origin differs from `REACT_APP_BACKEND_URL`, avoiding the preview 307 cross-origin trampoline.
- [x] **EvalRuns filter bar** (Feb 2026) — batch-name search + independent agent / prompt / date-range filters with AND/OR combine toggle, active-filter chips, clear-all, and empty-state copy (`src/components/evals/EvalFilterBar.js`).
- [x] **Cortex Agents editor** (Feb 2026) — `/cortex/agents` page: eph gate + agent list + Monaco YAML editor with quick-fields strip + comment-preserving edits (`eemeli/yaml`). v1.1 polish: schema-aware Monaco (`monaco-yaml` + `agentSchema.json`, blob-shim same-origin worker, opt-out flag `acm_cortex_disable_yaml_lsp`), diff-before-save modal, dirty-state guard + `beforeunload`, located server-error validation (Monaco marker + quick-field red border via `locateServerError.js`), delete-with-consequence-copy, provider-aware `model.id` combobox, list search/sort, optimistic delete + Undo toast, Cmd/Ctrl+S + Esc, scoped health chip (hidden on `/cortex/*`), focus-revalidate eph gate, error boundary around the editor.
- [x] **Eph-driven eval submission** (Feb 2026) — `EphPicker` (shared component) at the top of `RunEvalModal` step 2 with live DB / emergent / cortex readiness badge gating Next + Submit. Free-text `cortex_url` hidden by default; resurfaced via `?advanced=1`. Backend stub `/api/eval/cortex/ephs/{eph}/readiness` keyed off eph name (`cluster3-test` → emergent:false) until harness ships the real endpoint; submission routes via new `/api/eval/jobs-with-es` proxy.
- [x] **Testing Agent Bench dataset type + fork-eval flow** (Feb 2026 — fork iter 21) — Added `testing_agent_bench` to `DATASET_TYPE_OPTIONS` in `DatasetEditorModal.js`. Step 1 relabels "Instance ID" → "Production Job ID" with prod-fork helper text. Step 2 renamed "Task & Golden" — replaces Phases/Tests UI with two required textareas: HITL Input (→ `problem_statement`) + Golden Output (→ `natural_language_tests`). Step 3 collapses to Agent Name (required, in `attributes.agent_name`) + Model Name (optional, omitted if blank); `attributes.prod_job_id` mirrors `instance_id`. Create payload omits `problem_set_ids` and sets `name = "${dataset_type}/${instance_id}"`. RunEvalModal: new `isTestingAgentMode` / `hasMixedTypes` memos hide Target eph picker, Template, batch agent override (the legacy one), Resources (CPUs/Memory/Storage), Experiment Config when ALL selected problems are testing_agent_bench — only Group Run ID + User ID + new optional "Agent Name (override)" remain. Mixed selections (some testing_agent_bench + some scratch/bug) blocked at Step 1 with a rose warning banner; Next disabled. Submit branches: testing_agent_mode loops one POST per problem to `/api/eval/testing-agent-evals`, hydrating dataset via `getDatasetForProblem` if list endpoint trimmed the body, and per-eval body uses `agentNameOverride.trim() || attrs.agent_name` (override wins for A/B testing). Backend adds `proxy_submit_testing_agent_eval` route pass-through to `${EVAL_API_BASE}/api/v1/testing-agent-evals`. `attachOwnership` regex extended to inject `created_by` on the new endpoint. Verified end-to-end: dataset creation 200 with `version:1, is_active:true`; eval submission 200 with `{jobs:[{id, problem, status:'queued', k8s_job_name, created_at}]}`. Wizard test-ids: `dataset-hitl-input-textarea`, `dataset-golden-output-textarea`, `eval-testing-agent-name-override`, `testing-agent-mode-banner`, `step1-mixed-types-warning`.
- [x] **Testing Agent Bench `model_name` picker + per-run override** (Feb 2026 — fork iter 21) — New shared `ModelNamePicker` (`/app/frontend/src/components/evals/ModelNamePicker.js`) — Select dropdown with `(default)` sentinel + 5 presets (`claude-sonnet-4-5`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-fable-5`) + `Custom…` swap-to-Input for free-text. Used in two places: (1) DatasetEditorModal Step 3 Model Name field — persists to `attributes.model_name`, blank = omitted from payload, value round-trips on edit. (2) RunEvalModal Step 2 testing_agent_mode — new `modelNameOverride` state + `modelOverrideTouched` flag; effect pre-fills from `selectedProblems[0].attributes.model_name` on entering Step 2 (only if user hasn't touched the field). In `handleSubmit` per-problem branch: if user touched the field, `modelNameOverride.trim()` wins (blank → key omitted); otherwise fall back to `attrs.model_name`. Verified via Playwright + network intercept: scenario A (untouched + prefilled) sends `model_name: "claude-opus-4-8"`; scenario B (override to preset) sends `model_name: "claude-sonnet-4-5"`; scenario C (cleared to default) submits with `model_name` key absent from body. Dataset record is NEVER mutated. Test-ids: `attr-model-name-select`, `attr-model-name-custom`, `eval-testing-model-override-select`, `eval-testing-model-override-custom`.
- [x] **Monaco editor cross-origin "Script error." crash fixed** (Feb 2026 — fork) — `@monaco-editor/react` was loading `monaco-editor` from the public CDN (jsdelivr) via the AMD loader; any error in that cross-origin script surfaced as opaque "Script error." with no message/filename/lineno, uncatchable by try/catch. Rewrote `lib/agentMonaco.js` to expose `bootstrapMonacoLoader()` which (a) installs a same-origin inline noop Web Worker as `MonacoEnvironment.getWorker` and (b) lazy-imports the locally-bundled `monaco-editor` and calls `loader.config({ monaco })` + `loader.init()` to redirect `@monaco-editor/react` away from the CDN. `AgentEditor` gates the `<Editor>` render on the bootstrap promise. Verified end-to-end: editor mounts cleanly, console logs `[acm] monaco bound to local monaco-editor (no CDN, no cross-origin workers)`, zero Script-error events. The earlier `monaco-yaml` LSP schema-validation path stays a no-op (opt-in re-enable is future work — separate issue).
- [x] **"Open in eval" deep link from Cortex Agents → RunEvalModal** (Feb 2026 — fork) — Edit-mode `AgentEditor` now has an "Open in eval" button (rocket icon) that navigates to `/evals?run=1&eph=<eph>&agent=<agent_id>`. `EvalRuns` consumes those query params on mount, auto-opens `RunEvalModal` with `initialEph` + `initialAgentName` props, then strips the params from the URL (`replace: true`) so closing + reopening starts clean. `RunEvalModal` seeds `submitEph`, `ephName`, and `agentNameOverride` from those props in its open-reset effect. Unsaved-edits guard (`window.confirm`) before navigating since `beforeunload` doesn't catch React Router transitions. Verified end-to-end: created `dl_test_agent_v1` on `cluster3-test`, clicked Open in eval → modal Step 2 pre-filled with both fields, zero Script-error events.

## Testing Status (Iteration 19 – Feb 2026)
- Backend: 6/6 auth + **11/11 created_by pass-through** tests pass (`/app/backend/tests/test_created_by_passthrough.py`)
- Frontend: RunEvalModal POST /api/eval/jobs now carries `created_by` in body. /evals + /schedules GETs carry `?created_by=…`. /datasets/cortex/stats/health clean. See `/app/test_reports/iteration_19.json`.

## Bug Fix (Feb 2026 — iter19)
Backend proxy endpoints were silently dropping `created_by` by rebuilding outbound payloads with a strict allowlist. Fixed in `server.py`:
- `proxy_submit_eval` (POST /eval/jobs) now forwards `created_by` in body.
- List/Get/Delete on `/eval/jobs`, `/eval/jobs/{id}`, `/eval/jobs/aggregate`, `/eval/groups/{id}/jobs`, `/eval/scheduled-batches*`, `/eval/scheduled-batches/{id}/runs` now accept `created_by: Optional[str]` and pass it through as a query param.
- `proxy_trigger_scheduled_batch` forwards its body wholesale.

## Prioritized Backlog
### P1
- Split `server.py` (~1100 lines) into `auth_routes.py`, `agent_routes.py`, `eval_proxy_routes.py`
- Dropdown metadata integration (Builder models/tools/prompts in editor)

### P2
- Add Jest/RTL tests for `components/analytics/*` (skipped previously)
- Theme picker dropdown (multiple palettes – Solarized, GitHub-like, etc.)
- Clone Eval Groups feature

### P3
- Command palette (Cmd+K)
- Batch operations on agent list
- Re-evaluate drag-and-drop (DnD-kit portal issue)
