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
