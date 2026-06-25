// Helpers for extracting fields from harness eval jobs.
//
// Different dataset types store agent / model / template at different
// paths inside the job document:
//   • testing_agent_bench  → config.experiments.{agent_name,model_name}
//   • scratch_bench_phased → config.{agent_name,model_name}
//   • bug_bench            → config.{agent_name,model_name}
//   • test_report_bench    → config.{agent_name,model_name}
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
