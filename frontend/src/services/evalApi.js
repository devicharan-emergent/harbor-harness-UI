import axios from 'axios';
import { attachOwnership } from './apiHelpers';
import { getApiBaseURL } from './apiBase';

const BACKEND_URL = getApiBaseURL();

const evalApiClient = axios.create({
  baseURL: `${BACKEND_URL}/api/eval`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Attach the session token as ?access_token=<acm_session_token> on every
// /api/eval/* request — protected routes (e.g. comments POST/DELETE) rely on
// `_get_session_user` resolving the token from cookie / Authorization /
// access_token query param. Without this interceptor the auth helper never
// sees the token and returns 401.
evalApiClient.interceptors.request.use((config) => {
  let token = null;
  try { token = window.localStorage.getItem('acm_session_token') || null; } catch { /* ignore */ }
  if (token) {
    config.params = { ...(config.params || {}), access_token: token };
  }
  return config;
});

// Inject created_by into write requests for eval-job + group-jobs endpoints.
// Datasets, cortex agent checks, stats, and health are shared resources and
// stay as-is. Reads (GET/DELETE) intentionally skip injection — server-side
// `created_by` filtering for "Mine only" is opt-in by the caller passing the
// param explicitly (see EvalRuns.fetchJobs).
attachOwnership(evalApiClient, [
  /\/jobs(\/|$|-with-es$)/,
  /\/testing-agent-evals(\/|$)/,
  /\/groups\/[^/]+\/jobs(\/|$)/,
]);

// ============ Eval Jobs ============

/**
 * Submit eval jobs using the correct API format
 * POST /api/eval/jobs
 * Body: { user_id, group_id?, evals: [{ problem, cpus?, memory?, storage?, headed?, force_build?, experiments? }] }
 * Returns: { jobs: [{ id, problem, status, k8s_job_name, created_at, ... }] }
 */
export const submitEvalJobs = async (payload) => {
  const response = await evalApiClient.post('/jobs', payload);
  return response.data;
};

/**
 * Submit evals via the eph-aware variant. When `payload.eph_name` is set,
 * the backend derives emergent_agents_url + per-eval cortex_url from it and
 * re-runs readiness preflight server-side. Falls back to explicit-URL
 * behavior when eph_name is absent (back-compat).
 * POST /api/eval/jobs-with-es  →  harness /api/v1/internal/evals-with-es
 */
export const submitEvalJobsWithEs = async (payload) => {
  const response = await evalApiClient.post('/jobs-with-es', payload, { skipOwnership: false });
  return response.data;
};

/**
 * Submit a single testing_agent_bench eval (forks a prod job).
 * POST /api/eval/testing-agent-evals  →  harness /api/v1/testing-agent-evals
 * Body: { prod_job_id, agent_name, hitl_input, golden_output, model_name?,
 *         group_run_id, user_id?, created_by (injected) }
 * Returns: { jobs: [{ id, problem, status, k8s_job_name, created_at }] }
 */
export const submitTestingAgentEval = async (payload) => {
  const response = await evalApiClient.post('/testing-agent-evals', payload);
  return response.data;
};

/**
 * Verifier-config CRUD (per-bench, singleton-per-bench). Stored in OUR
 * Mongo keyed by bench type ("testing_agent_bench" or "scratch_bench_phased").
 * The prompt MUST contain bench-specific tokens — server 400s otherwise.
 *
 * GET    /api/eval/verifier-config?bench=<bench>
 * PUT    /api/eval/verifier-config?bench=<bench>     { prompt, model }
 * POST   /api/eval/verifier-config/reset?bench=<bench>
 */
export const getVerifierConfig = async (bench) => {
  const response = await evalApiClient.get('/verifier-config', { params: { bench } });
  return response.data;
};

export const updateVerifierConfig = async (bench, payload) => {
  const response = await evalApiClient.put('/verifier-config', payload, { params: { bench } });
  return response.data;
};

export const resetVerifierConfig = async (bench) => {
  const response = await evalApiClient.post('/verifier-config/reset', null, { params: { bench } });
  return response.data;
};

/**
 * Legacy judge-config wrappers — kept for any older callers; both
 * surfaces below have been migrated to the verifier-config endpoints.
 */
export const getJudgeConfig = async () => {
  const response = await evalApiClient.get('/judge-config');
  return response.data;
};

export const updateJudgeConfig = async (payload) => {
  const response = await evalApiClient.put('/judge-config', payload);
  return response.data;
};

export const resetJudgeConfig = async () => {
  const response = await evalApiClient.post('/judge-config/reset');
  return response.data;
};

/**
 * Check whether a cortex agent exists in a given ephemeral DB.
 * GET /api/eval/cortex/agents/exists?eph_name=&agent_name=
 * Returns: { exists: boolean, eph_name, agent_name }
 */
export const checkAgentExists = async (ephName, agentName) => {
  const response = await evalApiClient.get('/cortex/agents/exists', {
    params: { eph_name: ephName, agent_name: agentName },
  });
  return response.data;
};

/**
 * Get eval job by ID
 * GET /api/eval/jobs/{id}
 * Returns: { id, problem, status, progress, browser_reward?, lintiq_score?, combined_reward?, error?, ... }
 */
export const getEvalJob = async (jobId) => {
  const response = await evalApiClient.get(`/jobs/${jobId}`);
  return response.data;
};

// ============ Eval Run Groups (editable name + comment) ============

/**
 * List eval run groups (paged).
 * GET /api/eval/eval-run-groups?limit=&offset=&created_by=
 * Returns { groups: [{ group_run_id, group_name, comment, batch_id, created_by, created_at, updated_at }], limit, offset }
 */
export const listEvalRunGroups = async (params = {}) => {
  const response = await evalApiClient.get('/eval-run-groups', { params });
  return response.data;
};

/**
 * Get a single eval run group.
 * GET /api/eval/eval-run-groups/{group_run_id}
 * Returns the group object; throws 404 if not found.
 */
export const getEvalRunGroup = async (groupRunId) => {
  const response = await evalApiClient.get(`/eval-run-groups/${groupRunId}`);
  return response.data;
};

/**
 * Rename / re-comment a group. PATCH semantics:
 *   omit field         → unchanged
 *   { group_name: 'x' } → rename (display only; jobs untouched)
 *   { comment: 'text' } → set
 *   { comment: '' }     → clear
 * Returns the updated group object.
 */
export const patchEvalRunGroup = async (groupRunId, updates) => {
  const body = {};
  if (updates.group_name !== undefined) body.group_name = updates.group_name;
  if (updates.comment !== undefined) body.comment = updates.comment;
  const response = await evalApiClient.patch(
    `/eval-run-groups/${groupRunId}`,
    body,
  );
  return response.data;
};

/**
 * List all eval jobs with filters
 * GET /api/eval/jobs?status=&limit=&offset=
 * Returns: { jobs: [...], limit, offset }
 */
export const listEvalJobs = async (params = {}) => {
  const response = await evalApiClient.get('/jobs', { params });
  return response.data;
};

/**
 * Cancel a running eval job
 * DELETE /api/eval/jobs/{id}
 */
export const cancelEvalJob = async (jobId) => {
  const response = await evalApiClient.delete(`/jobs/${jobId}`);
  return response.data;
};

/**
 * Prepare a harbor eval for viewing in the chat UI.
 * POST /api/eval/jobs/{job_id}/prepare-for-ui → harness POST /api/v1/evals/{eval_id}/prepare-for-ui
 * Idempotent. Backfills the agent-service rows the chat UI needs.
 * Returns: { eval_id, cortex_job_id, eph, db, repaired: string[] }
 * `repaired` is either a subset of ["payload.task","use_cortex","usages"]
 * or exactly ["already_healthy"].
 */
export const prepareEvalForUI = async (jobId) => {
  const response = await evalApiClient.post(`/jobs/${jobId}/prepare-for-ui`);
  return response.data;
};

/**
 * Build the chat URL from a prepare-for-ui response. Mirrors the spec's
 * lookup: default-dev cortex (empty eph) → app.dev.emergentagent.com;
 * eph-bound cortex → {eph}.dev.apps.emergentagent.com.
 */
export const buildChatURL = (eph, cortexJobId) => {
  if (!cortexJobId) return null;
  if (!eph) return `https://app.dev.emergentagent.com/?job_id=${cortexJobId}`;
  return `https://${eph}.dev.apps.emergentagent.com/?job_id=${cortexJobId}`;
};

/**
 * Get queue stats by status
 * GET /api/eval/stats
 * Returns: { queued: 5, generating: 2, running: 3, completed: 100, failed: 2, cancelled: 1 }
 */
export const getEvalStats = async () => {
  const response = await evalApiClient.get('/stats');
  return response.data;
};

// ============ Datasets ============

/**
 * List all datasets
 * GET /api/eval/datasets?limit=50&offset=0
 */
export const listDatasets = async (params = {}) => {
  const response = await evalApiClient.get('/datasets', { params });
  return response.data;
};

/**
 * List datasets by type
 * GET /api/eval/datasets/types/{type}?limit=50
 */
export const listDatasetsByType = async (datasetType, params = {}) => {
  const response = await evalApiClient.get(`/datasets/types/${datasetType}`, { params });
  return response.data;
};

/**
 * Get a specific dataset by type and instance ID
 * GET /api/eval/datasets/types/{type}/instances/{instance_id}
 * Returns full dataset with problem_statement, natural_language_tests, attributes, etc.
 */
export const getDatasetInstance = async (datasetType, instanceId) => {
  const response = await evalApiClient.get(`/datasets/types/${datasetType}/instances/${instanceId}`);
  return response.data;
};

/**
 * Parse a problem name into its type and instance parts
 * e.g. "scratch_bench_phased/aureus-monitor" -> { type: "scratch_bench_phased", instance: "aureus-monitor" }
 */
export const parseProblemName = (problemName) => {
  if (!problemName) return null;
  const slashIndex = problemName.indexOf('/');
  if (slashIndex === -1) return null;
  return {
    type: problemName.substring(0, slashIndex),
    instance: problemName.substring(slashIndex + 1),
  };
};

/**
 * Fetch the dataset details for a problem name
 * Uses the type/instance endpoint
 */
export const getDatasetForProblem = async (problemName) => {
  const parsed = parseProblemName(problemName);
  if (!parsed) return null;
  try {
    return await getDatasetInstance(parsed.type, parsed.instance);
  } catch (error) {
    console.warn(`Failed to fetch dataset for ${problemName}:`, error);
    return null;
  }
};

/**
 * Create a new dataset
 * POST /api/eval/datasets
 * Body: { dataset_type, instance_id, problem_statement?, natural_language_tests?, description?, tags?, attributes? }
 * Backend auto-activates (create v0 → update to v1)
 */
export const createDataset = async (data) => {
  const response = await evalApiClient.post('/datasets', data);
  return response.data;
};

/**
 * Update an existing dataset
 * PUT /api/eval/datasets/{id}
 * Creates a new version
 */
export const updateDataset = async (datasetId, data) => {
  const response = await evalApiClient.put(`/datasets/${datasetId}`, data);
  return response.data;
};

/**
 * Delete (soft) a dataset
 * DELETE /api/eval/datasets/{id}
 */
export const deleteDataset = async (datasetId) => {
  const response = await evalApiClient.delete(`/datasets/${datasetId}`);
  return response.data;
};

/**
 * Bulk-import datasets from one or more CSV files of the selected type.
 * POST /api/eval/datasets/import?dataset_type=<type>  (multipart `files`)
 * Returns the harness envelope verbatim:
 *   { created: [iid], skipped: [iid], errors: [{ index, instance_id, error }] }
 *
 * IMPORTANT: do NOT set Content-Type here. Setting it to
 * 'multipart/form-data' strips axios's auto-generated `; boundary=…`
 * parameter and FastAPI then can't parse the multipart body. Pass
 * `undefined` so the instance default (`application/json`) is removed
 * and axios+browser set the correct multipart Content-Type w/ boundary.
 */
export const importDatasetsCSV = async (datasetType, files) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const response = await evalApiClient.post(
    `/datasets/import?dataset_type=${encodeURIComponent(datasetType)}`,
    fd,
    {
      headers: { 'Content-Type': undefined },
      timeout: 120000,
    },
  );
  return response.data;
};

/**
 * Download dataset(s) as CSV (or a multi-type zip when datasetType="all").
 * GET /api/eval/datasets/export?dataset_type=T[&instance_id=…&instance_id=…]
 *
 * Self-triggers a browser download using the server-provided
 * Content-Disposition filename. Throws on non-2xx so callers can surface
 * a toast. Re-parses the blob error body back to JSON so `parseApiError`
 * gets the real message instead of "[object Blob]".
 */
export const exportDatasetsCSV = async (datasetType, instanceIds = []) => {
  const params = new URLSearchParams({ dataset_type: datasetType });
  for (const iid of instanceIds) params.append('instance_id', iid);
  let response;
  try {
    response = await evalApiClient.get(`/datasets/export?${params.toString()}`, {
      responseType: 'blob',
      timeout: 120000,
    });
  } catch (err) {
    const blob = err?.response?.data;
    if (blob && typeof blob.text === 'function') {
      try {
        const txt = await blob.text();
        try { err.response.data = JSON.parse(txt); }
        catch { err.response.data = { message: txt }; }
      } catch { /* keep original */ }
    }
    throw err;
  }
  const cd = response.headers['content-disposition'] || response.headers['Content-Disposition'] || '';
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(cd);
  const fallback = datasetType === 'all' ? 'datasets_export.zip' : `${datasetType}.csv`;
  const filename = (m && decodeURIComponent(m[1])) || fallback;

  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename };
};

/**
 * Get aggregate metrics for a group (time per problem, test pass rates)
 * GET /api/eval/jobs/aggregate?group_id=X
 * Returns: { group_id, problems: [{ problem, job_count, completed_count, duration_avg_secs, duration_p75_secs, duration_p90_secs, test_cases_passed, test_cases_total, test_case_pass_rate }] }
 */
export const getEvalAggregate = async (groupId) => {
  const response = await evalApiClient.get('/jobs/aggregate', { params: { group_id: groupId } });
  return response.data;
};

/**
 * Update breakpoint duration for a running job
 * PATCH /api/eval/jobs/{id}/breakpoint
 * Body: { duration_mins: 10 } (0 to cancel/resume)
 */
export const updateBreakpoint = async (jobId, durationMins) => {
  const response = await evalApiClient.patch(`/jobs/${jobId}/breakpoint`, { duration_mins: durationMins });
  return response.data;
};

/**
 * List eval jobs for a specific group
 * GET /api/eval/groups/{group_id}/jobs
 * Returns: { jobs: [...], group_id, limit, offset }
 */
export const listGroupJobs = async (groupId, params = {}) => {
  const response = await evalApiClient.get(`/groups/${groupId}/jobs`, { params });
  return response.data;
};

// ============ Health ============

/**
 * Health check
 * GET /api/eval/health
 * Returns: { healthy: true/false }
 */
export const checkEvalHealth = async () => {
  try {
    const response = await evalApiClient.get('/health', { timeout: 5000 });
    return { healthy: response.data.healthy };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
};

// Export the axios instance for custom requests
export default evalApiClient;
