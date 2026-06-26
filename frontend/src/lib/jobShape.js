// Helpers for extracting fields from harness eval jobs.
//
// Different dataset types store agent / model / template at different
// paths inside the job document:
//   • testing_agent_bench  → config.experiments.{agent_name,model_name}
//   • scratch_bench_phased → config.{agent_name,model_name}
//   • bug_bench            → config.{agent_name,model_name}
// And the harness sometimes hoists `agent_name` / `model_name` to the
// top of the job document for older runs. These helpers walk the full
// fallback chain in a single place so every UI component shows the same
// value for the same job.

export function getJobAgentName(job) {
  if (!job) return '';
  const cfg = job.config || {};
  const exp = cfg.experiments || {};
  return exp.agent_name || cfg.agent_name || job.agent_name || '';
}

export function getJobModelName(job) {
  if (!job) return '';
  const cfg = job.config || {};
  const exp = cfg.experiments || {};
  return exp.model_name || cfg.model_name || job.model_name || '';
}

export function getJobTemplateName(job) {
  if (!job) return '';
  const cfg = job.config || {};
  const exp = cfg.experiments || {};
  return cfg.template_name || exp.template_name || '';
}

// True when a job came from the testing_agent_bench fork flow. The
// harness doesn't always stamp `dataset_type` on the job document, so
// we fall back to looking for the smoking-gun `hitl_input` field that's
// only present for testing-agent runs, then to the `testing_agent_bench/`
// prefix on `problem`.
export function isTestingAgentJob(job) {
  if (!job) return false;
  if ((job.dataset_type || job.config?.dataset_type) === 'testing_agent_bench') return true;
  const exp = job.config?.experiments || {};
  if (exp.hitl_input != null || exp.golden_output != null) return true;
  return typeof job.problem === 'string' && job.problem.startsWith('testing_agent_bench/');
}

// Extract the user-meaningful "instance name" for a testing-agent job —
// i.e. the slugified Instance Name the user typed in the wizard
// (`testing_agent_bench/<this part>`). Falls back to `job.problem`
// untouched for legacy jobs that don't follow the prefix convention.
export function getTestingAgentInstanceName(job) {
  if (!job) return '';
  const p = job.problem || job.config?.problem || '';
  const prefix = 'testing_agent_bench/';
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

// Production job id for a testing-agent job. The harness puts it on
// the per-eval item; it may resurface at config.experiments.prod_job_id
// or, on legacy jobs created before the wizard split, the prod job id
// was overloaded into the dataset's instance_id (now the slug). Returns
// '' when nothing is available.
export function getTestingAgentProdJobId(job) {
  if (!job) return '';
  const exp = job.config?.experiments || {};
  return exp.prod_job_id || job.prod_job_id || '';
}
