# Eval UI (Agent Config Manager / ACM) — PRD

## Problem Statement
ACM is a React + FastAPI + MongoDB app acting as a frontend and BFF proxy for an upstream evaluation harness. It manages datasets, triggers eval jobs (incl. multi-agent fan-out), monitors live job progress, and lets users configure/replay verifier (judge) settings.

## Architecture
```
/app/backend/server.py        # FastAPI BFF proxy router (~2680 lines, NEEDS REFACTOR)
/app/backend/tests/           # Pytest backend validation
/app/frontend/src/components/evals/  # RunEvalModal, JudgeConfigDialog, AgentMultiSelect, LiveEvalResults
/app/frontend/src/pages/             # DatasetsPage, GroupDetailPage, EvalRuns, JobDetail
/app/frontend/src/lib/               # jobShape.js, utils.js
/app/frontend/src/services/          # evalApi.js
```

## Key API Endpoints
- GET/PUT `/api/eval/verifier-config`, POST `/api/eval/verifier-config/reset`
- GET `/api/v1/agents`
- GET `/api/v1/evals/{id}/live-results`, `/api/v1/evals/{id}/llm-calls`

## DB Schema
- `dataset_views`: {view_id, name, description, items:[{dataset_type, instance_id}]}
- `judge_config`: {_id:<bench_type>, prompt, model, updated_at}

## Integrations
- Emergent-managed Google Auth.

## Completed
- Multi-agent eval fan-out (≤100 jobs), live results polling, verifier config surfacing in Review step.
- DatasetsPage pagination + "All Types" fan-out fetch fixes.
- Extra Options collapsible, Redash links on group cards, AgentMultiSelect chips, ModelNamePicker `(default)`.
- **2026-06-30: Fully reverted `reasoning_effort` feature** (backend + JudgeConfigDialog + RunEvalModal). Verified via curl; frontend compiles clean.
- **2026-06-30: Multi-agent fan-out for testing_agent_bench (frontend-only).** RunEvalModal now uses the same `AgentMultiSelect` + `selectedAgentIds` for testing_agent_bench as the build benches. Catalog split by tags: `testingAgents` (tags include 'testing', fallback 'subagent') for testing_agent_bench, `builderAgents` (not tagged 'testing') for build benches. Submits via unified `/api/eval/jobs` with top-level `agent_names` (agent ids); evals carry `{problem, experiments:{prod_job_id,hitl_input,golden_output,model_name?,judge_prompt?,judge_model?}}` (no agent_name in experiments). BFF `_expand_agent_fanout` enforces 100-cap; harness validates agent_names server-side. Removed legacy `taAgentNames`/`submitTestingAgentEval` path. Verified e2e (iter 50–52).
- **2026-06-30: Replay eligibility → preview-URL based (frontend-only).** Replay button/checkbox in `JobDetail.js` and `GroupDetailPage.js` now gate on `job.progress.metadata.preview_url` presence (+ scratch_bench_phased) instead of `status === 'completed'`. Harness already updated to allow preview-based replay (confirmed: it still hard-rejects non-completed via "job must be completed to replay" UNTIL their backend change — user confirmed handled). Verified iter 53.
- **2026-06-30: 'Test Cases' section on Eval Job detail (frontend-only).** `LiveEvalResults.jsx` now fetches `/live-results` once on mount (polls every 4s only while active), groups results by `phase_index` (header shown only when >1 phase), orders by `test_index`, renders per-test status chip (added `cancelled`) + `pass_cases/total_cases`. Renders whenever results non-empty — including cancelled & terminal jobs; returns null when terminal+empty. Now always mounted in JobDetail. Verified e2e at 100% (iter 53).
- **2026-06-30: 'Eval credits' indicator (frontend-only).** `components/layout/EvalCredits.js` — admin-only (renders only when `user.role==='admin'`; never calls the API otherwise). Calls `authAxios.get('/credits')` on mount + manual refresh (no polling). Headlines `ecu` as a whole number with thousands separators + ' ECU'; tooltip shows `total`; amber when `ecu<2000`, rose when `<=0`; shows muted 'unavailable' for `{available:false}` or on 404/403/error (degrades gracefully, never throws/toasts/blocks). Mounted in AppShell sidebar footer. Backend team provides `/api/credits` + `role` on `/auth/me` (NOT implemented in this repo). Verified e2e at 100% via route-interception (iter 54).
- **Replay (status note):** Replay eligibility is preview-URL based in the FE, but the upstream **harness** still hard-rejects non-completed jobs ("job must be completed to replay"). Our `/eval/replay` is a pure proxy — once the harness allows preview-based replay it works with no FE change; until then non-completed replays surface the harness error toast gracefully.
- **2026-07-02: Eval-list search + filters moved server-side.** BFF `GET /api/eval/jobs` now forwards `search`, `status`, `created_by`, `include_shared`, `agent_name`, `problem`, `date_from`, `date_to`, `limit`, `offset` verbatim to harness `/api/v1/evals` (AND-combined). `EvalRuns.js` builds these params from the (300ms-debounced) filter bar instead of the old fetch-all + client-side `buildJobFilter` predicate; offset resets to 0 on any filter/status change; pagination now applies even with active filters. Removed the AND/OR "Combine" toggle (harness is AND-only) and the now-dead `buildJobFilter`/`filterPredicate`/`hasActiveFilter`. "Mine only" → `created_by=<me>&include_shared=false`. Verified via network trace + backend curls.
- **2026-07-02: Group jobs listing paginated + duration stats.** `GET /api/eval/groups/{id}/jobs` proxy fixed to `/api/v1/group-runs/{id}/evals` (was 404). Added `listAllGroupJobs()` (paginates all pages, no truncation >100). Aggregate proxy fixed to forward `group_run_id` (+ derives `test_pass_rate`); avg/p75/p90 durations computed client-side from job created/finished timestamps. Group Detail page gained a "Cancel group (N)" button (fans out DELETE per active job).
- **2026-07-01: Eval Credits header shows `total` (incl. monthly/daily), can be negative, rose when ≤0.** Tooltip: total primary, spendable secondary.

## Backlog
- **P1**: Refactor `server.py` (>2600 lines) into `routes/*` + `models.py`.
- **P2**: Decide whether "3 verifier config prompts (low/med/high versions)" is still desired.
- **Blocked (upstream)**: Re-importing CSV with previously-used name throws `23505 datasets_name_key` (harness soft-delete limitation).

## Notes
- Fix code in PREVIEW env; user redeploys to production (`https://ui-preview-debug.internal.emergent.host`) themselves.
- Respond in English.
