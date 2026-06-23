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

// Inject created_by into every eval-job + group-jobs request. Datasets,
// cortex agent checks, stats, and health are shared resources and stay as-is.
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
