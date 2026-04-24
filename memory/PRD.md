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

## Architecture
- **Frontend**: React + Tailwind CSS + Shadcn UI (port 3000)
- **Backend**: FastAPI + MongoDB (port 8001)
- **External APIs**: Eval API (harness-eval), Builder API (cortex-eph-builder)
- **Pattern**: Backend-for-Frontend (BFF) with proxy endpoints
- **State Management**: React Context for environment (EnvContext)

## Pages
1. **Agent List** (`/`) - Table with search, filter, dual data source support, delete for DB agents
2. **Agent Editor** (`/agents/:id/edit`) - Multi-tab form with YAML preview
3. **Compare View** (`/compare`) - Side-by-side agent diff
4. **Version History** (`/agents/:id/history`) - Timeline of agent versions
5. **Wizard** (`/wizard`) - Chat-based agent creation
6. **Eval Runs** (`/evals`) - **Grouped view by group_id** with collapsible sections
7. **Job Detail** (`/evals/:id`) - Detailed view with scores, eval metrics, phase results, test breakdown
8. **Datasets** (`/datasets`) - Dataset CRUD with preview panel

## What's Been Implemented (Verified March 2026)
- [x] Phase 1-2: Core dual-mode switching (MongoDB <-> Builder API)
- [x] Phase 4: Eval API integration with problem statement display
- [x] Phase 5: Full Builder API CRUD (filesystem=read-only, database=full CRUD)
- [x] Phase 6A: Dataset CRUD (mandatory PS & NL Tests, format presets, type-specific attributes)
- [x] Phase 6B: Multi-Eval Submission with mandatory group_id
- [x] **Grouped Eval Runs**: Jobs displayed in collapsible groups by group_id
- [x] **Environment Switcher**: Dev/Ephemeral toggle controlling cortex-url
- [x] **Agent Deletion**: Delete option for database-sourced agents only
- [x] Agent association badges on EvalRuns and JobDetail
- [x] Eval Metrics: phase_results with test breakdown on JobDetail

## Bug Fixes (March 19, 2026)
- [x] Fixed group_id not being sent to API - moved from eval item level to payload top level
- [x] Updated sidebar layout with fixed positioning for better stability

## Scheduled Batches + Analytics (Feb 2026)
- [x] Scheduled Batches CRUD + trigger + runs history (proxy endpoints + UI)
- [x] Whole-hour cron restriction in ScheduleEditor
- [x] `schedule_tag` + `/runs` API contract migration
- [x] `group_id` -> `group_run_id` fix on EvalRuns
- [x] Row-clickable problem selection (ScheduleEditor, RunEvalModal)
- [x] ScheduleDetail Analytics section: SummaryKPIs, PhaseHeatmap
- [x] **Per-problem time series chart** (Feb 2026): one line per problem across dates with
      metric selector (combined_reward / lint_score / browser_reward / lintiq_score).
      Replaces the prior error-code breakdown which was removed at user request.
- [x] **Analytics UI polish** (Feb 2026):
      - KPI tiles: color-coded values by threshold, inline sparklines under reward means,
        drop "Total Cost —" / "Last Fire" when redundant, 6-col responsive grid.
      - Chart: end-of-line value labels, 0.5 reference line, legend hover-to-isolate,
        tooltip sorted by value.
      - New `ProblemLeaderboard` table — sortable per-problem rows with runs count,
        latest/mean scores (color-coded), trend arrow, combined-reward sparkline.
      - New reusable `Sparkline` SVG component.

## Testing Status (Iteration 14 - March 14, 2026)
- Backend: 14/14 pytest tests passed (100%)
- Frontend: 33/33 Playwright tests passed (100%)
- All features verified working

## Prioritized Backlog
### P1
- Refactor server.py into separate APIRouter files (agent_routes, proxy_routes, eval_routes)
- Dropdown metadata integration (Builder models/tools/prompts in editor)

### P2
- Clone Eval Groups feature (re-run batch with new group_id)
- Builder-side validation pre-save
- Builder YAML export integration

### P3
- Command palette (Cmd+K) for quick actions
- Batch operations on agent list
- Re-evaluate drag-and-drop for job reordering (DnD-kit portal issue)
