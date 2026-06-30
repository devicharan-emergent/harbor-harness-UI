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
- **2026-06-30: Multi-agent fan-out for testing_agent_bench (frontend-only).** RunEvalModal now uses the same `AgentMultiSelect` + `selectedAgentIds` for testing_agent_bench as the build benches. Catalog split by tags: `testingAgents` (tags include 'testing', fallback 'subagent') for testing_agent_bench, `builderAgents` (not tagged 'testing') for build benches. Submits via unified `/api/eval/jobs` with top-level `agent_names` (agent ids); evals carry `{problem, experiments:{prod_job_id,hitl_input,golden_output,model_name?,judge_prompt?,judge_model?}}` (no agent_name in experiments). BFF `_expand_agent_fanout` enforces 100-cap; harness validates agent_names server-side. Removed legacy `taAgentNames`/`submitTestingAgentEval` path. Verified e2e (iter 50–52): testing multiselect shows 40 testing-tagged agents, fan-out 2×2=4, review totals/agents correct; build-bench regression shows 356 builder agents with 0 testing leakage.

## Backlog
- **P1**: Refactor `server.py` (>2600 lines) into `routes/*` + `models.py`.
- **P2**: Decide whether "3 verifier config prompts (low/med/high versions)" is still desired.
- **Blocked (upstream)**: Re-importing CSV with previously-used name throws `23505 datasets_name_key` (harness soft-delete limitation).

## Notes
- Fix code in PREVIEW env; user redeploys to production (`https://ui-preview-debug.internal.emergent.host`) themselves.
- Respond in English.
