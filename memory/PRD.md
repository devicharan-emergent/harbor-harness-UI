# Agent Config Manager (ACM) — PRD

## Problem Statement
ACM is a React + FastAPI + MongoDB BFF over an upstream eval harness. It provides
dataset management, eval job triggering, job/run monitoring, phase/status tracking,
and replay-verifier capabilities. Auth via Emergent-managed Google Auth (restricted
to `@emergent*` email domains).

## Architecture
```
/app/
├── backend/server.py        # FastAPI BFF proxy router (>2500 lines — needs split)
├── backend/tests/           # pytest backend validation
├── frontend/src/pages/      # DatasetsPage, GroupDetailPage, EvalRuns, JobDetail
├── frontend/src/components/evals/  # RunEvalModal, modals
├── frontend/src/services/evalApi.js
└── frontend/src/lib/        # jobShape.js, utils.js
```

## Implemented (chronological)
- Replay browser tests feature: bulk (GroupDetailPage) + single (JobDetail).
- `testing_agent_bench` dataset name formatting fixed in EvalRuns.
- "Watch Replay" link blindly uses backend `replay_url` (no FE URL construction).
- JobDetail "Phase Results (raw)" split into per-phase collapsible blocks.
- `/api/eval/stats` proxy computes the `replaying` status count.
- RunEvalModal Agent Name reverted from Combobox to plain Input.
- RunEvalModal "All Types" dataset truncation fixed via per-type parallel fan-out.
- **(2026-06-29) DatasetsPage "All Types" truncation fixed** — `fetchDatasets`
  now fans out `listDatasetsByType` per type (limit 200) and merges; pagination
  hidden for "All Types"/active-view. Verified: 153 datasets, multiple types shown.
- **(2026-06-29) Backend venv repair** — site-packages had zeroed/corrupted files
  (null bytes, invalid ELF). Force-reinstalled all requirements via system pip;
  backend healthy again.

## Backlog
- P1: Refactor `/app/backend/server.py` into `routes/*` + `models.py`.
- Blocked (upstream): CSV re-import with prior name throws `23505 datasets_name_key`
  due to soft-deleted rows persisting upstream. Not fixable from BFF side.

## Key Notes
- Upstream `/api/v1/datasets` caps at ~100 rows alphabetically — always bypass via
  per-type `listDatasetsByType` fan-out.
- Never construct replay/dashboard URLs in FE; pass backend `replay_url` as-is.
- Production vs Preview: cannot fix prod directly; user must redeploy.

## Credentials
See `/app/memory/test_credentials.md` (seeded Mongo session, `@emergent*` gate).
