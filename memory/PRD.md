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
- **(2026-06-29) Live Results on eval-detail + multi-agent eval submit**:
  - Multi-agent New Eval: searchable multi-select sourced from harness
    `/api/v1/agents` (396 agents) → submitted as `agent_names[]`; BFF
    `_expand_agent_fanout` cross-products agent×problem (stamps agent_name per
    eval row), enforces 100-job cap with exact message. Results grouped by
    agent in EvalRuns (per-agent sub-headers). Inline submit-error banner.
  - Live Results card (JobDetail, placed below Progress): polls
    `/eval/jobs/{id}/live-results` + `/llm-calls` every 4s while
    generating/running, merges rows by key (no flicker), shows status chips +
    pass/total + grouped LLM-call feed; click a call → lazy
    `/llm-calls/{call_id}` viewer (request transcript + raw response).
    Stops/unmounts on terminal → final phase_results view renders. 3 new BFF
    proxies added. Verified testing_agent iteration_45 (5/5 BE + 5/5 FE).
- **(2026-06-29) Evals UI batch (testing_agent iteration_43, 5/5 pass)**:
  - RunEvalModal Step 2: removed Model picker + Comment textarea; moved the
    3 run-behaviour toggles (Headed browser / Force rebuild / Phase breakpoint)
    into a collapsed-by-default "Extra Options" collapsible.
  - JobDetail Quick Links: relabeled Cortex → "View Emergent Job"; added
    "Replay Eval" deep link (`eval-ui-replay.internal.preview.emergentagent.com/?job_id=<cortex>&env=prod&autoload=1`);
    removed the two Redash comparison links.
  - Moved the Redash Data/Tool-Usage comparison links onto the Evals group
    name card (icon links, dashboards 730/731, group preselected).
  - Added "View Emergent Job" (app.emergent.sh) link to job rows in EvalRuns
    (expanded) and GroupDetailPage; all open in new tab with stopPropagation.
- **(2026-06-29) DatasetsPage pagination + view bugs fixed** — (1) Dataset
  views now fetch exactly the view's members by instance (`fetchViewDatasets`
  via `getDatasetInstance`) instead of fetching the first 200 and client-
  filtering, so all members show regardless of upstream ordering; (2) row
  selection is now a `Map<key, fullObject>` that persists across pages (was
  wiped by a page/type-change effect) — bulk delete/export operate on the
  full cross-page selection. "All Types" + view modes paginate client-side.
  Verified by testing_agent (iteration_42, 5/5 pass).
- **(2026-06-29) DatasetsPage "All Types" truncation fixed** — `fetchDatasets`
  now fans out `listDatasetsByType` per type (limit 200) and merges; pagination
  hidden for "All Types"/active-view. Verified: 153 datasets, multiple types shown.
- **(2026-06-29) Backend venv repair** — site-packages had zeroed/corrupted files
  (null bytes, invalid ELF). Force-reinstalled all requirements via system pip;
  backend healthy again.

## Backlog
- Blocked (upstream): CSV re-import with prior name throws `23505 datasets_name_key`
  due to soft-deleted rows persisting upstream. Not fixable from BFF side.

## Key Notes
- Upstream `/api/v1/datasets` caps at ~100 rows alphabetically — always bypass via
  per-type `listDatasetsByType` fan-out.
- Never construct replay/dashboard URLs in FE; pass backend `replay_url` as-is.
- Production vs Preview: cannot fix prod directly; user must redeploy.

## Credentials
See `/app/memory/test_credentials.md` (seeded Mongo session, `@emergent*` gate).
