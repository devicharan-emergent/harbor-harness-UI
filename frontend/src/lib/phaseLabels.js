// Phase + status label mapping for the eval timeline.
//
// The backend emits raw snake_case enums coming straight from the harness
// (harbor_*, lintiq_*, browser_*, preview_*, cleanup_*). Those names leak
// internal product details ("harbor" = the build framework, "lintiq" = the
// static analyzer) and read like log lines, not UI. This module converts
// them into user-facing copy and folds the outcome (score) into the label
// whenever the step's metadata carries it.
//
// Keep the raw values intact when you need to drive logic (icons, dividers,
// links). Only the human-readable string lives here.

// Top-level job.status — used by the status pill in lists and details.
//   `generating` is the harness slot where it spins up the env + first
//   phase before the agent really starts. "Preparing" reads better than
//   "Generating" for non-devs.
export const JOB_STATUS_LABELS = {
  queued: 'Queued',
  generating: 'Preparing',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function getJobStatusLabel(status) {
  return JOB_STATUS_LABELS[status] || (status ? String(status) : 'Unknown');
}

// Format a 0..1 reward as either a fraction ("8/10") + score ("0.80") when
// the step carries pass/total counts, or just the score otherwise.
function formatBrowserOutcome(meta = {}) {
  const reward = meta.browser_reward ?? meta.reward;
  const pass = meta.pass_cases ?? meta.passed;
  const total = meta.total_cases ?? meta.total;
  if (pass != null && total != null) {
    const r = reward != null ? ` (${Number(reward).toFixed(2)})` : '';
    return `${pass}/${total} passed${r}`;
  }
  if (reward != null) return Number(reward).toFixed(2);
  return null;
}

function formatScore(value) {
  return value != null ? Number(value).toFixed(2) : null;
}

// Translate a single step from `job.progress.history[]` (or the live
// `job.progress.{phase, metadata}` pair) into a friendly label.
//
// `phaseContext` lets callers pass the running phase counter so we can
// surface "Applying Phase 2 (out of 3) changes" instead of just a flat
// "Applying changes". Falls back to step.metadata.phase_index when caller
// can't compute it.
export function getPhaseLabel(step, phaseContext = {}) {
  if (!step) return '';
  const phase = step.phase;
  const meta = step.metadata || {};

  // 0-indexed in the harness; UI is 1-indexed.
  const phaseIdx =
    phaseContext.phaseNum != null
      ? phaseContext.phaseNum
      : meta.phase_index != null
        ? meta.phase_index + 1
        : null;
  const totalPhases =
    phaseContext.totalPhases != null
      ? phaseContext.totalPhases
      : meta.total_phases ?? null;

  const phaseSuffix =
    phaseIdx != null && totalPhases != null
      ? ` ${phaseIdx} (out of ${totalPhases})`
      : phaseIdx != null
        ? ` ${phaseIdx}`
        : '';

  switch (phase) {
    case 'queued':
      return 'Queued';

    case 'harbor_starting':
      return 'Setting up environment';
    case 'harbor_running':
      return `Applying Phase${phaseSuffix} changes`;
    case 'harbor_completed':
      return 'Build complete';

    case 'preview_waiting':
      return 'Waiting for app to come online';
    case 'preview_ready':
      return 'App is live';

    case 'browser_testing':
      return 'Running tests';
    case 'browser_completed': {
      const outcome = formatBrowserOutcome(meta);
      return outcome ? `Tests done — ${outcome}` : 'Tests done';
    }

    case 'lintiq_running':
      return 'Checking code quality';
    case 'lintiq_completed': {
      const score = formatScore(meta.lintiq_score ?? meta.lint_score);
      return score ? `Code quality — ${score}` : 'Code quality';
    }

    case 'cleanup_starting':
      return 'Cleaning up';
    case 'cleanup_completed':
      return 'Cleanup complete';

    case 'phase_breakpoint':
      return 'Breakpoint — Paused for manual testing';

    case 'completed': {
      const score = formatScore(meta.combined_reward);
      return score ? `Done — combined ${score}` : 'Done';
    }
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';

    default:
      // Unknown phase — humanise the snake_case so we never show raw enums
      // to the user. e.g. `something_new` → "Something new".
      if (!phase) return '';
      return String(phase)
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
  }
}
