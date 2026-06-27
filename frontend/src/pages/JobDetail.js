import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEvalJob, cancelEvalJob, getDatasetForProblem, updateBreakpoint, replayEvalJobs } from '@/services/evalApi';
import { getJobAgentName, getJobModelName } from '@/lib/jobShape';
import { getPhaseLabel, getJobStatusLabel } from '@/lib/phaseLabels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { ArrowLeft, Copy, XCircle, Loader2, CheckCircle, Clock, AlertTriangle, Cpu, ActivitySquare, Ban, FileText, ChevronDown, ChevronUp, ChevronRight, ExternalLink, Info, Play } from 'lucide-react';
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns';
import { formatDateTime } from '@/lib/utils';
import { LintRuleBreakdown } from '@/components/evals/LintRuleBreakdown';
import { useCreatedBy } from '@/contexts/AuthContext';

const STATUS_ICONS = {
  queued: Clock,
  generating: Cpu,
  running: ActivitySquare,
  replaying: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: Ban,
};

// Phases representing "real work" the agent is actively doing. Everything
// else (queue waits, preview-comes-online polling, post-run lint/cleanup)
// is treated as overhead and folded into a single summary line by default.
// The user can flip the "Show all phases" toggle to reveal every step so
// per-phase durations sum to the wall-clock elapsed time.
const MAJOR_PHASES = new Set(['harbor_running', 'browser_testing']);

// Format a positive duration in seconds as "Xm Ys" / "Xs" — matches the
// per-step row formatting elsewhere in the timeline.
function fmtSecs(secs) {
  if (secs == null || isNaN(secs)) return null;
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

// Resolve a user-openable replay URL from a browser_results entry.
// The harness sometimes returns an internal `harness-eval.int.*` API URL
// for replay phases (e.g. `https://harness-eval.int.apis.emergentagent.com/api/v1/replays/<id>`)
// which 404s for end users. In that case fall back to the public Kernel
// dashboard URL keyed by `kernel_session_id`. Returns '' when nothing
// usable is available.
function resolveReplayUrl(test) {
  if (!test) return '';
  const url = test.replay_url || '';
  const isInternal = url.includes('harness-eval.int.') || url.includes('/api/v1/replays/');
  if (url && !isInternal) return url;
  if (test.kernel_session_id) {
    return `https://dashboard.onkernel.com/browsers/${test.kernel_session_id}`;
  }
  return url; // best effort — may still be the internal URL if nothing else
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const triggeredBy = useCreatedBy();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [nextPollIn, setNextPollIn] = useState(10);
  const [dataset, setDataset] = useState(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [showFullPS, setShowFullPS] = useState(false);
  const [showTests, setShowTests] = useState(false);
  // Progress timeline density toggle — `false` shows only the "real work"
  // phases (harbor_running + browser_testing). `true` reveals every phase
  // including queue + preview wait + lintiq + cleanup so the per-phase
  // durations sum to the wall-clock total.
  const [showAllPhases, setShowAllPhases] = useState(false);

  const isActive = job && ['queued', 'generating', 'running', 'replaying'].includes(job.status);

  useEffect(() => {
    fetchJob();
  }, [id]);

  // Fetch dataset for problem statement
  useEffect(() => {
    const problemName = job?.problem;
    if (!problemName || dataset) return;
    
    setDatasetLoading(true);
    getDatasetForProblem(problemName)
      .then(ds => {
        if (ds) setDataset(ds);
      })
      .catch(err => console.warn('Failed to fetch dataset:', err))
      .finally(() => setDatasetLoading(false));
  }, [job?.problem, dataset]);

  useEffect(() => {
    if (!isActive) return;

    // Replaying status polls faster (5s) since the harness flips back to
    // "completed" once browser_testing finishes — it's typically a short
    // window. Build phases poll every 10s as before.
    const pollMs = job?.status === 'replaying' ? 5000 : 10000;
    const pollSecs = Math.floor(pollMs / 1000);
    setNextPollIn(pollSecs);

    const pollInterval = setInterval(() => {
      fetchJob();
      setNextPollIn(pollSecs);
    }, pollMs);

    const countdownInterval = setInterval(() => {
      setNextPollIn(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
    };
  }, [isActive, id, job?.status]);

  const fetchJob = async () => {
    try {
      const data = await getEvalJob(id);
      setJob(data);
    } catch (error) {
      toast.error(`Failed to load job: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(id);
    toast.success('Job ID copied');
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this eval job?')) return;
    setCancelling(true);
    try {
      await cancelEvalJob(id);
      toast.success('Job cancelled');
      fetchJob();
    } catch (error) {
      toast.error(`Failed to cancel: ${error.message}`);
    } finally {
      setCancelling(false);
    }
  };

  // ── Replay: re-run browser verifier on this job's live preview ──────
  // Only allowed for completed scratch_bench_phased jobs. Each replay
  // appends a new `kind: "replay"` entry to phase_results — the original
  // build phases and top-level scores are never overwritten.
  const handleReplay = async () => {
    if (!confirm('Re-run browser tests on the live preview?\n\nThis appends a new "Replay" phase to this job. The original phases and scores are preserved.')) return;
    setReplaying(true);
    try {
      const resp = await replayEvalJobs([id], triggeredBy);
      const results = resp?.results || [];
      const r = results[0] || {};
      if (r.status === 'replaying') {
        toast.success('Replay started — polling for results');
      } else if (r.status === 'error') {
        toast.error(`Replay failed: ${r.error || r.message || 'unknown error'}`);
      } else {
        toast.success('Replay requested');
      }
      fetchJob();
    } catch (error) {
      toast.error(`Failed to start replay: ${error.message}`);
    } finally {
      setReplaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Job not found</p>
        <Button onClick={() => navigate('/evals')} variant="outline" size="sm" className="mt-4">
          Back to Eval Runs
        </Button>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[job.status] || Clock;

  // Scores at top level per API docs
  const browserReward = job.browser_reward;
  const lintiqScore = job.lintiq_score;
  const combinedReward = job.combined_reward;
  const hasScores = browserReward !== undefined || lintiqScore !== undefined || combinedReward !== undefined;
  const allPhaseResults = job.phase_results || [];
  // Build phases = original verifier output during the eval. Replay
  // phases = re-runs of just the browser verifier on the existing live
  // preview. We render them in two separate sections so users can tell
  // at a glance which signal is fresh vs original.
  const phaseResults = allPhaseResults.filter(p => p.kind !== 'replay');
  const replayPhases = allPhaseResults.filter(p => p.kind === 'replay');

  // Replay eligibility (mirrors backend): completed + scratch_bench_phased.
  // Note the harness also accepts the dataset_type embedded in the
  // problem name, so check both shapes.
  const datasetType = job.dataset_type || (job.problem || '').split('/')[0];
  const isReplayEligible = job.status === 'completed' && datasetType === 'scratch_bench_phased';

  return (
    <div className="space-y-6" data-testid="job-detail-page">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/evals')} className="h-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-bold">Eval Job</h1>
            <Badge variant="outline" className="font-mono text-xs" data-testid="job-status-badge">
              <StatusIcon className="w-3 h-3 mr-1" />
              {getJobStatusLabel(job.status)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground ml-[52px]">
            Problem: <span className="font-mono">{job.problem}</span>
          </p>
          {(() => {
            const agentName = getJobAgentName(job);
            const modelName = getJobModelName(job);
            if (!agentName && !modelName) return null;
            return (
              <div className="flex items-center gap-1.5 ml-[52px] mt-1">
                {agentName && (
                  <Badge variant="outline" className="text-[10px] font-mono bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" data-testid="job-agent-badge">
                    {agentName}
                  </Badge>
                )}
                {modelName && (
                  <Badge variant="outline" className="text-[10px] font-mono" data-testid="job-model-badge">
                    {modelName}
                  </Badge>
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <Badge variant="outline" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              Next poll in {nextPollIn}s
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={fetchJob} className="h-8">
            <Loader2 className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyId} className="h-8" data-testid="jobdetail-copy-id">
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy ID
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            data-testid="jobdetail-copy-link"
            onClick={() => {
              const url = window.location.origin + `/evals/${job.id}`;
              navigator.clipboard.writeText(url).then(
                () => toast.success('Deep link copied'),
                () => toast.error('Could not copy link'),
              );
            }}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Copy link
          </Button>
          {isReplayEligible && (
            <Button
              variant="default"
              size="sm"
              className="h-8"
              onClick={handleReplay}
              disabled={replaying}
              data-testid="jobdetail-replay-btn"
              title="Re-run the browser verifier on this job's live preview"
            >
              {replaying
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Play className="w-3.5 h-3.5 mr-1.5" />}
              Replay browser tests
            </Button>
          )}
          {isActive && (
            <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={async () => {
                const mins = prompt('Breakpoint duration in minutes (0 to disable):', '10');
                if (mins === null) return;
                const val = parseInt(mins, 10);
                if (isNaN(val) || val < 0) { toast.error('Invalid duration'); return; }
                try {
                  await updateBreakpoint(job.id, val);
                  toast.success(val > 0 ? `Breakpoint set to ${val} min` : 'Breakpoint disabled');
                  fetchJob();
                } catch (e) {
                  toast.error('Failed to update breakpoint');
                }
              }}
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              {job.progress?.phase === 'phase_breakpoint' ? 'Update Breakpoint' : 'Set Breakpoint'}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling} className="h-8">
              {cancelling ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />}
              Cancel
            </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Problem Statement + Progress + Scores */}
        <div className="lg:col-span-2 space-y-6">
          {/* Problem Statement */}
          {datasetLoading && (
            <Card data-testid="problem-statement-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Problem Statement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-4 bg-muted rounded w-5/6" />
                </div>
              </CardContent>
            </Card>
          )}
          {!datasetLoading && dataset && dataset.problem_statement && (
            <Card data-testid="problem-statement-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Problem Statement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Collapsible open={showFullPS} onOpenChange={setShowFullPS}>
                  <div className="relative">
                    <pre className={`text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed ${!showFullPS ? 'max-h-[200px] overflow-hidden' : ''}`} data-testid="problem-statement-text">
                      {dataset.problem_statement}
                    </pre>
                    {!showFullPS && dataset.problem_statement.length > 500 && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent" />
                    )}
                  </div>
                  {dataset.problem_statement.length > 500 && (
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs w-full" data-testid="toggle-problem-statement">
                        {showFullPS ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                        {showFullPS ? 'Show less' : 'Show full problem statement'}
                      </Button>
                    </CollapsibleTrigger>
                  )}
                </Collapsible>

                {/* Test Cases */}
                {dataset.natural_language_tests && (
                  <Collapsible open={showTests} onOpenChange={setShowTests} className="mt-3">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid="toggle-test-cases">
                        {showTests ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                        Test Cases
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/60 leading-relaxed mt-2 p-3 bg-muted/50 rounded-lg" data-testid="test-cases-text">
                        {dataset.natural_language_tests}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </CardContent>
            </Card>
          )}

          {/* Progress Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              {job.progress?.history && job.progress.history.length > 0 ? (
                <div className="space-y-3">
                  {(() => {
                    let phaseNum = 0;
                    // Best-effort total phase count: prefer any history step's
                    // metadata.total_phases, fall back to live progress.
                    const totalPhases =
                      job.progress.history.find((s) => s.metadata?.total_phases)?.metadata?.total_phases
                      ?? job.progress.metadata?.total_phases
                      ?? null;
                    const items = [];
                    job.progress.history.forEach((step, idx) => {
                      const isMajor = MAJOR_PHASES.has(step.phase);
                      // Hide non-major (overhead) steps when collapsed —
                      // they're summarised below in the Overhead row.
                      if (!showAllPhases && !isMajor) return;
                      // Insert phase divider before every harbor_running
                      if (step.phase === 'harbor_running') {
                        phaseNum++;
                        items.push(
                          <div key={`phase-${phaseNum}`} className="flex items-center gap-2 py-1.5">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
                              Phase {phaseNum}{totalPhases ? ` of ${totalPhases}` : ''}
                            </span>
                            <div className="h-px flex-1 bg-border" />
                          </div>
                        );
                      }
                      items.push(
                        <div key={idx} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="w-px h-8 bg-border mt-1" />
                          </div>
                          <div className="flex-1 pb-3">
                            <p className="text-sm font-medium" data-testid={`progress-step-${idx}-label`}>
                              {getPhaseLabel(step, { phaseNum: step.phase === 'harbor_running' ? phaseNum : undefined, totalPhases })}
                            </p>
                            {step.duration_seconds !== undefined && (
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {fmtSecs(step.duration_seconds)}
                              </p>
                            )}
                            {step.duration && step.duration_seconds === undefined && (
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{step.duration}</p>
                            )}
                            {(step.metadata?.preview_url || step.metadata?.url) && (
                              <a href={step.metadata.preview_url || step.metadata.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                                Preview URL
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    });
                    return items;
                  })()}
                  {/* Current Phase */}
                  {isActive && job.progress.phase && (
                    <div className="flex gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        job.progress.phase === 'phase_breakpoint'
                          ? 'bg-amber-100 dark:bg-amber-900'
                          : 'bg-blue-100 dark:bg-blue-900 animate-pulse'
                      }`}>
                        {job.progress.phase === 'phase_breakpoint' ? (
                          <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium" data-testid="progress-current-label">
                          {getPhaseLabel(
                            { phase: job.progress.phase, metadata: job.progress.metadata },
                            { totalPhases: job.progress.metadata?.total_phases },
                          )}
                        </p>
                        {job.progress.message && (
                          <p className="text-xs text-muted-foreground mt-0.5">{job.progress.message}</p>
                        )}
                        {job.progress.metadata?.phase_index !== undefined && (
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            Phase {job.progress.metadata.phase_index + 1}/{job.progress.metadata.total_phases}
                          </p>
                        )}
                        {job.progress.phase === 'phase_breakpoint' && (
                          <div className="mt-2 flex items-center gap-2">
                            {job.progress.metadata?.preview_url && (
                              <a
                                href={job.progress.metadata.preview_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:text-blue-400 underline font-mono"
                              >
                                Open Preview
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={async () => {
                                try {
                                  await updateBreakpoint(job.id, 0);
                                  toast.success('Breakpoint resumed');
                                } catch (e) {
                                  toast.error('Failed to resume');
                                }
                              }}
                            >
                              Resume Now
                            </Button>
                            {job.progress.metadata?.breakpoint_ends_at && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                ends {formatDistanceToNow(new Date(job.progress.metadata.breakpoint_ends_at), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Overhead summary + density toggle. Aggregates every
                      non-major phase (queued / preview_* / lintiq_* /
                      cleanup_* / harbor_starting / harbor_completed /
                      browser_completed / phase_breakpoint) into a single
                      line. Hovering the value reveals the per-bucket
                      breakdown so users can see exactly where the
                      unattributed wall-clock time went. */}
                  {(() => {
                    const buckets = {
                      'Queue': 0,
                      'Preview wait': 0,
                      'Code quality (lintiq)': 0,
                      'Cleanup': 0,
                      'Build setup': 0,
                      'Other overhead': 0,
                    };
                    const bucketOf = (phase) => {
                      if (phase === 'queued') return 'Queue';
                      if (phase === 'preview_waiting' || phase === 'preview_ready') return 'Preview wait';
                      if (phase === 'lintiq_running' || phase === 'lintiq_completed') return 'Code quality (lintiq)';
                      if (phase === 'cleanup_starting' || phase === 'cleanup_completed') return 'Cleanup';
                      if (phase === 'harbor_starting' || phase === 'harbor_completed' || phase === 'browser_completed') return 'Build setup';
                      return 'Other overhead';
                    };
                    let overheadTotal = 0;
                    for (const s of job.progress.history) {
                      if (MAJOR_PHASES.has(s.phase)) continue;
                      const d = Number(s.duration_seconds);
                      if (!Number.isFinite(d) || d <= 0) continue;
                      buckets[bucketOf(s.phase)] += d;
                      overheadTotal += d;
                    }
                    if (overheadTotal <= 0) return null;
                    const breakdownLines = Object.entries(buckets)
                      .filter(([, secs]) => secs > 0)
                      .sort((a, b) => b[1] - a[1]);
                    return (
                      <div className="pt-1">
                        <Separator className="mb-2" />
                        <div className="flex justify-between text-xs items-center">
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            Overhead
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3 h-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-[11px] font-semibold mb-1">Where the un-shown time went</p>
                                  <ul className="text-[10px] font-mono space-y-0.5">
                                    {breakdownLines.map(([bucket, secs]) => (
                                      <li key={bucket} className="flex justify-between gap-3">
                                        <span>{bucket}</span>
                                        <span>{fmtSecs(secs)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </span>
                          <span className="font-mono" data-testid="progress-overhead">
                            {fmtSecs(overheadTotal)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAllPhases(v => !v)}
                          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1.5"
                          data-testid="progress-toggle-all-phases"
                        >
                          {showAllPhases ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {showAllPhases ? 'Hide minor phases' : 'Show all phases'}
                        </button>
                      </div>
                    );
                  })()}
                  {/* Total Elapsed */}
                  {job.finished_at && job.created_at && (
                    <>
                      <Separator className="my-2" />
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total elapsed</span>
                        <span className="font-mono">
                          {(() => {
                            const dur = intervalToDuration({ start: new Date(job.created_at), end: new Date(job.finished_at) });
                            return formatDuration(dur, { format: ['hours', 'minutes', 'seconds'] });
                          })()}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No progress data yet</p>
              )}
            </CardContent>
          </Card>

          {/* Scores */}
          {hasScores && (
            <Card data-testid="scores-card">
              <CardHeader>
                <CardTitle className="text-sm">Scores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {browserReward !== undefined && browserReward !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium">Browser Reward</span>
                      <span className="text-xs font-mono">{Number(browserReward).toFixed(3)}</span>
                    </div>
                    <Progress value={Number(browserReward) * 100} className="h-2" />
                  </div>
                )}
                {lintiqScore !== undefined && lintiqScore !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium">Lintiq Score</span>
                      <span className="text-xs font-mono">{Number(lintiqScore).toFixed(3)}</span>
                    </div>
                    <Progress value={Number(lintiqScore) * 100} className="h-2" />
                  </div>
                )}
                {combinedReward !== undefined && combinedReward !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium">Combined Reward</span>
                      <span className="text-xs font-mono">{Number(combinedReward).toFixed(3)}</span>
                    </div>
                    <Progress value={Number(combinedReward) * 100} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Usage Metrics */}
          {job.eval_metrics && (
            <Card data-testid="usage-card">
              <CardHeader>
                <CardTitle className="text-sm">Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">LLM Calls</span>
                    <span className="font-mono">{job.eval_metrics.total_llm_calls ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tool Calls</span>
                    <span className="font-mono">{job.eval_metrics.total_tool_calls ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tool Errors</span>
                    <span className="font-mono">{job.eval_metrics.total_tool_errors ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sessions</span>
                    <span className="font-mono">{job.eval_metrics.total_sessions ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Main Iterations</span>
                    <span className="font-mono">{job.eval_metrics.main_iterations ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sub Iterations</span>
                    <span className="font-mono">{job.eval_metrics.subagent_iterations ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sub Sessions</span>
                    <span className="font-mono">{job.eval_metrics.subagent_sessions ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ctx Squash</span>
                    <span className="font-mono">{job.eval_metrics.context_squash_count ?? 0}</span>
                  </div>
                </div>
                <Separator className="my-3" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Input Tokens</span>
                    <span className="font-mono">{(job.eval_metrics.total_input_tokens ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Output Tokens</span>
                    <span className="font-mono">{(job.eval_metrics.total_output_tokens ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Read</span>
                    <span className="font-mono">{(job.eval_metrics.total_cache_read_tokens ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Create</span>
                    <span className="font-mono">{(job.eval_metrics.total_cache_creation_tokens ?? 0).toLocaleString()}</span>
                  </div>
                </div>
                <Separator className="my-3" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Cost</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                    ${(job.eval_metrics.total_cost_usd ?? 0).toFixed(4)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-Phase Metrics (cost, tokens, tool calls per phase) */}
          {job.eval_metrics?.cortex_phase_metrics?.length > 0 && (
            <Card data-testid="phase-metrics-card">
              <CardHeader>
                <CardTitle className="text-sm">Per-Phase Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {job.eval_metrics.cortex_phase_metrics.map((pm, idx) => {
                  const phaseDuration = pm.started_at && pm.finished_at
                    ? (new Date(pm.finished_at) - new Date(pm.started_at)) / 1000
                    : null;
                  const matchedPhase = phaseResults.find(p => p.phase_index === pm.phase_index);
                  const phaseLintiq = matchedPhase?.lintiq_score;
                  return (
                  <div key={idx} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold flex items-center gap-2">
                        Phase {pm.phase_index + 1}
                        {phaseDuration != null && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {phaseDuration < 60 ? `${phaseDuration.toFixed(0)}s` : `${Math.floor(phaseDuration / 60)}m ${Math.round(phaseDuration % 60)}s`}
                          </Badge>
                        )}
                        {phaseLintiq != null && (
                          <Badge variant={phaseLintiq >= 0.8 ? 'default' : phaseLintiq >= 0.5 ? 'secondary' : 'destructive'} className="text-[9px] font-mono">
                            Lintiq {(phaseLintiq * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </h4>
                      <Badge variant="outline" className="text-[10px] font-mono text-emerald-600 border-emerald-500/30">
                        ${(pm.total_cost_usd ?? 0).toFixed(4)}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">LLM Calls</span>
                        <span className="font-mono">{pm.total_llm_calls ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tool Calls</span>
                        <span className="font-mono">{pm.total_tool_calls ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tool Errors</span>
                        <span className="font-mono">{pm.total_tool_errors ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Auto-Compact</span>
                        <span className="font-mono">{pm.auto_compact_count ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Input Tokens</span>
                        <span className="font-mono">{(pm.total_input_tokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Output Tokens</span>
                        <span className="font-mono">{(pm.total_output_tokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cache Read</span>
                        <span className="font-mono">{(pm.total_cache_read_tokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cache Create</span>
                        <span className="font-mono">{(pm.total_cache_creation_tokens ?? 0).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Tool call breakdown */}
                    {pm.tool_call_counts && Object.keys(pm.tool_call_counts).length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground text-[10px]">Tools: </span>
                        <span className="font-mono text-[10px]">
                          {Object.entries(pm.tool_call_counts).map(([name, count]) => `${name}(${count})`).join(', ')}
                        </span>
                      </div>
                    )}

                    {/* Per-agent cost */}
                    {pm.agent_costs && Object.keys(pm.agent_costs).length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground text-[10px]">Agent Costs: </span>
                        <span className="font-mono text-[10px]">
                          {Object.entries(pm.agent_costs).map(([agentId, cost]) => `${pm.agent_names?.[agentId] || agentId}: $${cost.toFixed(4)}`).join(', ')}
                        </span>
                      </div>
                    )}

                    {idx < job.eval_metrics.cortex_phase_metrics.length - 1 && <Separator />}
                  </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Phase Results (detailed test breakdown) */}
          {phaseResults.length > 0 && (
            <Card data-testid="phase-results-card">
              <CardHeader>
                <CardTitle className="text-sm">Eval Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {phaseResults.map((phase, phaseIdx) => {
                  const totalPass = (phase.browser_results || []).reduce((s, r) => s + (r.pass_cases || 0), 0);
                  const totalFail = (phase.browser_results || []).reduce((s, r) => s + (r.fail_cases || 0), 0);
                  const totalCases = (phase.browser_results || []).reduce((s, r) => s + (r.total_cases || 0), 0);
                  const passRate = totalCases > 0 ? (totalPass / totalCases) * 100 : 0;

                  return (
                    <div key={phaseIdx} className="space-y-3">
                      {/* Phase header */}
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold flex items-center gap-2">
                          Phase {phase.phase_index !== undefined ? phase.phase_index + 1 : phaseIdx + 1}
                          {phase.browser_reward !== undefined && (
                            <Badge
                              variant={phase.browser_reward >= 0.8 ? 'default' : phase.browser_reward >= 0.5 ? 'secondary' : 'destructive'}
                              className="text-[9px] font-mono"
                              data-testid={`phase-${phaseIdx}-reward`}
                            >
                              Browser {(phase.browser_reward * 100).toFixed(0)}%
                            </Badge>
                          )}
                          {phase.lintiq_score != null && (
                            <Badge
                              variant={phase.lintiq_score >= 0.8 ? 'default' : phase.lintiq_score >= 0.5 ? 'secondary' : 'destructive'}
                              className="text-[9px] font-mono"
                              data-testid={`phase-${phaseIdx}-lintiq`}
                            >
                              Lintiq {(phase.lintiq_score * 100).toFixed(0)}%
                            </Badge>
                          )}
                        </h4>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {totalPass}/{totalCases} passed
                        </span>
                      </div>

                      {/* Pass rate bar */}
                      <Progress value={passRate} className="h-1.5" />

                      {/* Test results */}
                      {(phase.browser_results || []).map((test, testIdx) => {
                        const isPassing = test.status === 'pass';
                        return (
                          <Collapsible key={testIdx}>
                            <CollapsibleTrigger asChild>
                              <button
                                className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left text-xs transition-colors hover:bg-accent/50 ${
                                  isPassing
                                    ? 'border-emerald-500/20 bg-emerald-500/5'
                                    : 'border-red-500/20 bg-red-500/5'
                                }`}
                                data-testid={`test-result-${phaseIdx}-${testIdx}`}
                              >
                                <div className="flex-shrink-0 mt-0.5">
                                  {isPassing ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium truncate">
                                      {test.test_name
                                        ? (test.test_name.length > 80 ? test.test_name.substring(0, 80) + '...' : test.test_name)
                                        : `Test ${testIdx + 1}`
                                      }
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] font-mono flex-shrink-0 ${
                                        isPassing ? 'text-emerald-600 border-emerald-500/30' : 'text-red-600 border-red-500/30'
                                      }`}
                                    >
                                      {test.pass_cases}/{test.total_cases}
                                    </Badge>
                                  </div>
                                </div>
                                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="ml-5 mt-1 space-y-2 px-3 py-2 rounded-lg bg-muted/40 text-xs">
                                {test.test_name && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Test Steps</p>
                                    <pre className="font-mono text-foreground/70 whitespace-pre-wrap break-words mt-1 leading-relaxed">
                                      {test.test_name}
                                    </pre>
                                  </div>
                                )}
                                {test.details && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Details</p>
                                    <pre className="font-mono text-foreground/70 whitespace-pre-wrap break-words mt-1 leading-relaxed" data-testid={`test-details-${phaseIdx}-${testIdx}`}>
                                      {test.details}
                                    </pre>
                                  </div>
                                )}
                                {(test.replay_url || test.kernel_session_id) && (() => {
                                  const watchUrl = resolveReplayUrl(test);
                                  if (!watchUrl) return null;
                                  return (
                                    <a
                                      href={watchUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400 font-mono underline"
                                      data-testid={`watch-replay-${phaseIdx}-${testIdx}`}
                                    >
                                      Watch Replay
                                    </a>
                                  );
                                })()}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}

                      {/* Extra bugs — agent-reported issues NOT in golden.
                          Rendered in blue to clearly distinguish from the
                          golden test rows above (pass=green, fail=red).
                          Source: phase.extra[] (array of strings, populated
                          by the verifier on testing_agent_bench runs). */}
                      {Array.isArray(phase.extra) && phase.extra.length > 0 && (
                        <div className="mt-3 space-y-1.5" data-testid={`phase-${phaseIdx}-extra-bugs`}>
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-600 dark:text-blue-400">
                              Extra bugs found by agent
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[9px] font-mono text-blue-600 border-blue-500/30 bg-blue-500/10"
                              data-testid={`phase-${phaseIdx}-extra-count`}
                            >
                              {phase.extra.length}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground italic">
                              not in golden — bonus findings
                            </span>
                          </div>
                          {phase.extra.map((bug, extraIdx) => (
                            <div
                              key={extraIdx}
                              className="flex items-start gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs"
                              data-testid={`extra-bug-${phaseIdx}-${extraIdx}`}
                            >
                              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
                              <span className="flex-1 leading-relaxed whitespace-pre-wrap break-words">
                                {bug}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Phase Lint Report — handles three shapes:
                          (a) populated: raw_output.files[] with errors → full breakdown
                          (b) degraded:   lint_report.error string → red chip
                          (c) clean:      score present, no errors → small green chip */}
                      {phase.lint_report && (() => {
                        const lr = phase.lint_report;
                        const hasFileErrors = lr.raw_output?.files?.some(f => f.error_count > 0);
                        const errMsg = lr.error || lr.message;
                        const score = lr.normalized_score ?? lr.overall_score ?? phase.lint_score;
                        if (hasFileErrors) {
                          return (
                        <Collapsible className="mt-2">
                          <div className="rounded-lg border border-red-400/20 bg-red-50/40 dark:bg-red-950/20">
                            {/* Header / trigger */}
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-red-500/5 transition-colors rounded-lg [&[data-state=open]>svg]:rotate-180"
                                data-testid={`phase-${phaseIdx}-lint-toggle`}
                              >
                                <span className="text-[11px] font-semibold text-red-700 dark:text-red-400">Lint Issues</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    {phase.lint_report.summary?.files_with_errors} file{phase.lint_report.summary?.files_with_errors !== 1 ? 's' : ''} · {phase.lint_report.summary?.total_errors} error{phase.lint_report.summary?.total_errors !== 1 ? 's' : ''}
                                  </span>
                                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
                                </div>
                              </button>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="px-3 pb-3 space-y-3">
                                {/* Error breakdown — split by severity, grouped by rule id */}
                                <LintRuleBreakdown
                                  lintReport={phase.lint_report}
                                  testid={`phase-${phaseIdx}-lint-breakdown`}
                                />

                                {/* Files with errors */}
                                <div className="space-y-2">
                                  {phase.lint_report.raw_output.files
                                    .filter(f => f.error_count > 0)
                                    .map((file, fIdx) => (
                                      <div key={fIdx} className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-mono text-muted-foreground truncate flex-1 min-w-0">{file.file}</span>
                                          <Badge variant="outline" className="text-[9px] font-mono text-red-500 border-red-400/30 flex-shrink-0 py-0">
                                            {file.error_count} err{file.error_count !== 1 ? 's' : ''}
                                          </Badge>
                                        </div>
                                        <div className="pl-2 space-y-1">
                                          {file.errors.map((err, eIdx) => (
                                            <div key={eIdx} className="flex items-start gap-2 text-[10px] font-mono bg-white/60 dark:bg-black/20 rounded px-2 py-1">
                                              <span className="text-muted-foreground flex-shrink-0 w-12">L{err.line}:{err.column}</span>
                                              <Badge variant="outline" className="text-[8px] py-0 h-auto border-red-300 text-red-600 dark:text-red-400 flex-shrink-0">
                                                {err.code}
                                              </Badge>
                                              <span className="text-foreground/70 break-all leading-relaxed">
                                                {err.message.replace(new RegExp(`^${err.code}\\s*`), '')}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                          );
                        }
                        // Degraded — lint service returned an error string
                        if (errMsg) {
                          return (
                            <div
                              className="mt-2 rounded-lg border border-amber-400/30 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2 text-[11px] flex items-center gap-2"
                              data-testid={`phase-${phaseIdx}-lint-error`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                              <span className="text-amber-700 dark:text-amber-400 font-semibold">Lint Report unavailable</span>
                              <span className="text-muted-foreground font-mono text-[10px] truncate" title={errMsg}>· {errMsg}</span>
                            </div>
                          );
                        }
                        // Clean — score present but no errors, just show a green chip
                        if (score != null) {
                          return (
                            <div
                              className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2 text-[11px] flex items-center gap-2"
                              data-testid={`phase-${phaseIdx}-lint-clean`}
                            >
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Lint Report</span>
                              <span className="text-muted-foreground font-mono text-[10px]">
                                · no issues · score {(Number(score) * 100).toFixed(0)}%
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {phaseIdx < phaseResults.length - 1 && <Separator />}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Replays — re-runs of the browser verifier on the live
              preview. These are appended AFTER the build is complete and
              do NOT alter the original build phases or top-level scores.
              Rendered in a distinct cyan-tinted card so they're visually
              separate from the eval metrics above. */}
          {replayPhases.length > 0 && (
            <Card data-testid="replay-phases-card" className="border-cyan-500/30 bg-cyan-500/[0.02]">
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Play className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                    <span>Replays</span>
                    <Badge variant="outline" className="text-[10px] font-mono border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                      {replayPhases.length} run{replayPhases.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground font-normal">
                    Does not override original scores
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {replayPhases.map((phase, rIdx) => {
                  const browserResults = phase.browser_results || [];
                  // Some replay entries don't carry pass_cases/total_cases
                  // (timeouts, harness errors) — flag the case so the header
                  // shows a meaningful summary instead of "0/0 passed".
                  const hasCounts = browserResults.some(r => r.total_cases != null || r.pass_cases != null);
                  const totalPass = browserResults.reduce((s, r) => s + (r.pass_cases || 0), 0);
                  const totalCases = browserResults.reduce((s, r) => s + (r.total_cases || 0), 0);
                  const passRate = totalCases > 0 ? (totalPass / totalCases) * 100 : 0;
                  const failedCount = browserResults.filter(r => r.status === 'fail').length;
                  const replayLabel = phase.replay_index != null
                    ? `Replay ${phase.replay_index}`
                    : `Replay ${rIdx + 1}`;
                  return (
                    <div key={rIdx} className="space-y-3" data-testid={`replay-phase-${rIdx}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                          {replayLabel}
                          {phase.browser_reward !== undefined && (
                            <Badge
                              variant={phase.browser_reward >= 0.8 ? 'default' : phase.browser_reward >= 0.5 ? 'secondary' : 'destructive'}
                              className="text-[9px] font-mono"
                              data-testid={`replay-phase-${rIdx}-reward`}
                            >
                              Browser {(phase.browser_reward * 100).toFixed(0)}%
                            </Badge>
                          )}
                          {phase.triggered_by && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              by {phase.triggered_by}
                            </span>
                          )}
                          {(phase.triggered_at || phase.created_at) && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              · {formatDistanceToNow(new Date(phase.triggered_at || phase.created_at), { addSuffix: true })}
                            </span>
                          )}
                        </h4>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {hasCounts
                            ? `${totalPass}/${totalCases} passed`
                            : (failedCount > 0 ? `${failedCount} failed` : 'no counts reported')}
                        </span>
                      </div>
                      <Progress value={passRate} className="h-1.5" />

                      {phase.error && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs" data-testid={`replay-phase-${rIdx}-error`}>
                          <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                          <pre className="font-mono text-red-700 dark:text-red-300 whitespace-pre-wrap break-words flex-1">
                            {typeof phase.error === 'string' ? phase.error : JSON.stringify(phase.error, null, 2)}
                          </pre>
                        </div>
                      )}

                      {browserResults.map((test, testIdx) => {
                        const isPassing = test.status === 'pass';
                        const watchUrl = resolveReplayUrl(test);
                        const hasTestCounts = test.total_cases != null || test.pass_cases != null;
                        return (
                          <Collapsible key={testIdx}>
                            <CollapsibleTrigger asChild>
                              <button
                                className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors hover:bg-accent/50 ${
                                  isPassing
                                    ? 'border-emerald-500/20 bg-emerald-500/5'
                                    : 'border-red-500/20 bg-red-500/5'
                                }`}
                                data-testid={`replay-test-${rIdx}-${testIdx}`}
                              >
                                <div className="flex-shrink-0 mt-0.5">
                                  {isPassing ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium truncate" title={test.test_name}>
                                      {test.test_name
                                        ? (test.test_name.length > 80 ? test.test_name.substring(0, 80) + '…' : test.test_name)
                                        : `Test ${testIdx + 1}`}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] font-mono flex-shrink-0 ${
                                        isPassing ? 'text-emerald-600 border-emerald-500/30' : 'text-red-600 border-red-500/30'
                                      }`}
                                    >
                                      {hasTestCounts
                                        ? `${test.pass_cases ?? 0}/${test.total_cases ?? 0}`
                                        : (test.error_category || test.status || '—')}
                                    </Badge>
                                  </div>
                                </div>
                                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="ml-5 mt-1 space-y-2 px-3 py-2 rounded-lg bg-muted/40 text-xs">
                                {test.test_name && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Test Steps</p>
                                    <pre className="font-mono text-foreground/70 whitespace-pre-wrap break-words mt-1 leading-relaxed">
                                      {test.test_name}
                                    </pre>
                                  </div>
                                )}
                                {test.details && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Details</p>
                                    <pre className="font-mono text-foreground/70 whitespace-pre-wrap break-words mt-1 leading-relaxed" data-testid={`replay-test-details-${rIdx}-${testIdx}`}>
                                      {test.details}
                                    </pre>
                                  </div>
                                )}
                                {watchUrl && (
                                  <a
                                    href={watchUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400 font-mono underline"
                                    data-testid={`replay-watch-${rIdx}-${testIdx}`}
                                  >
                                    Watch replay
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}

                      {rIdx < replayPhases.length - 1 && <Separator />}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Custom Lint Report */}
          {job.eval_metrics?.lint_report && (
            <Card data-testid="lint-report-card">
              <CardHeader>
                <CardTitle className="text-sm">Custom Lint Report</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* Summary Stats */}
                {job.eval_metrics.lint_report.summary && (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: 'Total Files', value: job.eval_metrics.lint_report.summary.total_files },
                      { label: 'Total Errors', value: job.eval_metrics.lint_report.summary.total_errors },
                      { label: 'Files w/ Errors', value: job.eval_metrics.lint_report.summary.files_with_errors },
                    ].map((stat, idx) => (
                      <div key={idx} className="space-y-1">
                        <p className="text-[10px] text-muted-foreground leading-tight">{stat.label}</p>
                        <p className={`text-sm font-mono font-medium ${stat.value > 0 && idx > 0 ? 'text-red-500' : ''}`}>
                          {stat.value ?? 0}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Error breakdown — split by severity, grouped by rule id */}
                {(() => {
                  const hasAny = (job.eval_metrics.lint_report?.raw_output?.files || []).some((f) => (f.errors || []).length > 0);
                  if (!hasAny) return null;
                  return (
                    <>
                      <Separator />
                      <LintRuleBreakdown
                        lintReport={job.eval_metrics.lint_report}
                        testid="lint-report-breakdown"
                      />
                    </>
                  );
                })()}

                {/* Files with Errors */}
                {job.eval_metrics.lint_report.raw_output?.files?.some(f => f.error_count > 0) && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium mb-2">
                        Files with Errors ({job.eval_metrics.lint_report.raw_output.files.filter(f => f.error_count > 0).length})
                      </p>
                      <div className="space-y-3">
                        {job.eval_metrics.lint_report.raw_output.files
                          .filter(f => f.error_count > 0)
                          .map((file, fIdx) => (
                            <div key={fIdx} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">{file.file}</span>
                                <Badge variant="outline" className="text-[9px] font-mono text-red-500 border-red-400/40 flex-shrink-0">
                                  {file.error_count} error{file.error_count !== 1 ? 's' : ''}
                                </Badge>
                              </div>
                              <div className="pl-2 space-y-1">
                                {file.errors.map((err, eIdx) => (
                                  <div key={eIdx} className="flex items-start gap-2 text-[11px] font-mono bg-red-50 dark:bg-red-950/40 rounded px-2 py-1.5">
                                    <span className="text-muted-foreground flex-shrink-0 w-14">L{err.line}:{err.column}</span>
                                    <Badge variant="outline" className="text-[9px] py-0 h-auto border-red-300 text-red-600 dark:text-red-400 flex-shrink-0">
                                      {err.code}
                                    </Badge>
                                    <span className="text-foreground/75 break-all leading-relaxed">
                                      {err.message.replace(new RegExp(`^${err.code}\\s*`), '')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}

              </CardContent>
            </Card>
          )}

          {/* Lintiq Report */}
          {job.eval_metrics?.lintiq_report && (
            <Card data-testid="lintiq-report-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Lintiq Report</CardTitle>
                  <span className="text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400">
                    {job.eval_metrics.lintiq_report.overall_score?.toFixed(2)}/100
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary Stats */}
                {job.eval_metrics.lintiq_report.summary && (
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 text-center">
                    {[
                      { label: 'Files', value: job.eval_metrics.lintiq_report.summary.total_files },
                      { label: 'Functions', value: job.eval_metrics.lintiq_report.summary.total_functions },
                      { label: 'Classes', value: job.eval_metrics.lintiq_report.summary.total_classes },
                      { label: 'Security', value: job.eval_metrics.lintiq_report.summary.total_security_issues },
                      { label: 'Complexity', value: job.eval_metrics.lintiq_report.summary.total_complexity_issues },
                      { label: 'Anti-patterns', value: job.eval_metrics.lintiq_report.summary.total_antipattern_issues },
                      { label: 'Type Hints', value: job.eval_metrics.lintiq_report.summary.type_hint_coverage != null ? `${(job.eval_metrics.lintiq_report.summary.type_hint_coverage * 100).toFixed(0)}%` : 'N/A' },
                      { label: 'Analyzers', value: job.eval_metrics.lintiq_report.analyzers_run?.join(', ') || 'N/A' },
                    ].map((stat, idx) => (
                      <div key={idx} className="space-y-1">
                        <p className="text-[10px] text-muted-foreground leading-tight">{stat.label}</p>
                        <p className="text-sm font-mono font-medium">{stat.value ?? 0}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {job.eval_metrics.lintiq_report.recommendations?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium mb-2">Recommendations</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {job.eval_metrics.lintiq_report.recommendations.map((rec, idx) => {
                          const colors = ['text-red-500', 'text-amber-500', 'text-emerald-500', 'text-blue-500'];
                          return (
                            <div key={idx} className="flex items-start gap-2 text-xs">
                              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${colors[idx % colors.length]} bg-current`} />
                              <span className="text-foreground/70">{rec}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* Analyzer Errors */}
                {job.eval_metrics.lintiq_report.analyzer_errors && Object.keys(job.eval_metrics.lintiq_report.analyzer_errors).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium mb-2 text-red-600">Analyzer Errors</p>
                      {Object.entries(job.eval_metrics.lintiq_report.analyzer_errors).map(([analyzer, error]) => (
                        <div key={analyzer} className="text-xs text-red-500 font-mono bg-red-50 dark:bg-red-950 p-2 rounded mb-1">
                          <span className="font-semibold">{analyzer}:</span> {error}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Error */}
                {job.eval_metrics.lintiq_report.error && (
                  <>
                    <Separator />
                    <p className="text-xs text-red-500 font-mono">{job.eval_metrics.lintiq_report.error}</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Error Panel */}
          {job.status === 'failed' && job.error && (
            <Card className="border-red-200 dark:border-red-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  Error
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-red-50 dark:bg-red-950 p-3 rounded-lg overflow-auto max-h-[200px]">
                  {job.error}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Details Panel */}
        <div className="space-y-4">
          {/* Quick Links — persistent debug links from progress metadata */}
          {(() => {
            const meta = job.progress?.metadata || {};
            const pastPhases = (job.progress?.history || []).map(h => h.phase);
            const previewReady = pastPhases.includes('preview_ready') || job.progress?.phase === 'preview_ready';
            const previewUrl = previewReady ? meta.preview_url : null;
            const temporalUrl = meta.temporal_url;
            const cortexJobId = meta.cortex_job_id || job.cortex_job_id;
            const groupRunId = job.group_run_id || job.group_id;

            // Pre-fill `p_group_set_1` on the Redash comparison dashboards
            // with this job's group_run_id; leave p_group_set_2 unset so
            // the user picks the comparison group on Redash side.
            // `JSON.stringify(["x"])` → `["x"]` → URL-encoded for Redash.
            const buildRedashUrl = (dashId, extraParams = '') => {
              if (!groupRunId) return null;
              const groupArr = encodeURIComponent(JSON.stringify([groupRunId]));
              return `https://redash.internal-apps.emergentagent.com/dashboards/${dashId}?p_agent_name=All&p_group_set_1=${groupArr}&p_model=All${extraParams}`;
            };
            const redashSummaryUrl = buildRedashUrl(730);
            const redashToolUrl = buildRedashUrl(731, '&p_tool=execute_bash&p_window_end=All');

            if (!previewUrl && !temporalUrl && !cortexJobId && !redashSummaryUrl) return null;
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Quick Links</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      Preview App
                    </a>
                  )}
                  {temporalUrl && (
                    <a
                      href={temporalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      Temporal Workflow
                    </a>
                  )}
                  {cortexJobId && (
                    <a
                      href={`https://app.emergent.sh/home?job_id=${cortexJobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline"
                      data-testid="quicklinks-cortex"
                      title="Open the Cortex job in Emergent in a new tab"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="text-muted-foreground">Cortex:</span>
                      <span className="font-mono text-[10px] break-all">{cortexJobId}</span>
                    </a>
                  )}
                  {redashSummaryUrl && (
                    <a
                      href={redashSummaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      data-testid="quicklinks-redash-summary"
                      title="Open Eval Data Comparison (dashboard 730) with this group preselected"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      Eval Data Comparison
                    </a>
                  )}
                  {redashToolUrl && (
                    <a
                      href={redashToolUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      data-testid="quicklinks-redash-tools"
                      title="Open Eval Tool-Usage Comparison (dashboard 731) with this group preselected"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      Eval Tool-Usage Comparison
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-xs">
                {job.cortex_job_id && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Cortex Job ID</dt>
                      <dd className="font-mono mt-0.5 text-[10px] break-all">{job.cortex_job_id}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                <div>
                  <dt className="text-muted-foreground">Problem</dt>
                  <dd className="font-mono mt-0.5">{job.problem}</dd>
                </div>
                <Separator />
                {(() => {
                  const agentName = getJobAgentName(job);
                  const modelName = getJobModelName(job);
                  return (
                    <>
                      {agentName && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Agent</dt>
                            <dd className="font-mono mt-0.5 break-all">{agentName}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {modelName && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Model</dt>
                            <dd className="font-mono mt-0.5 break-all">{modelName}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                    </>
                  );
                })()}
                {(job.group_run_id || job.group_id) && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Group ID</dt>
                      <dd className="mt-0.5">
                        <a
                          href={`/evals/group/${job.group_run_id || job.group_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] break-all text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline inline-flex items-center gap-1"
                          data-testid="jobdetail-group-link"
                          title="Open group detail in new tab"
                        >
                          {job.group_run_id || job.group_id}
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      </dd>
                    </div>
                    <Separator />
                  </>
                )}
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="mt-0.5">{formatDateTime(job.created_at)}</dd>
                </div>
                {job.finished_at && (
                  <>
                    <Separator />
                    <div>
                      <dt className="text-muted-foreground">Duration</dt>
                      <dd className="font-mono mt-0.5">
                        {formatDuration(
                          intervalToDuration({
                            start: new Date(job.created_at),
                            end: new Date(job.finished_at)
                          }),
                          { format: ['hours', 'minutes', 'seconds'] }
                        )}
                      </dd>
                    </div>
                  </>
                )}

                {/* "More" — infra IDs + secondary timestamps tucked away */}
                <Collapsible className="pt-1">
                  <CollapsibleTrigger
                    className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground py-1 [&[data-state=open]>svg]:rotate-180"
                    data-testid="jobdetail-more-toggle"
                  >
                    <span className="font-semibold">More details</span>
                    <ChevronDown className="w-3 h-3 transition-transform" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-2 pt-2">
                      <div>
                        <dt className="text-muted-foreground">Job ID</dt>
                        <dd className="font-mono mt-0.5 text-[10px] break-all">{job.id}</dd>
                      </div>
                      <Separator />
                      {job.user_id && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">User ID</dt>
                            <dd className="font-mono mt-0.5 text-[10px] break-all">{job.user_id}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.k8s_job_name && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">K8s Job</dt>
                            <dd className="font-mono mt-0.5 text-[10px] break-all">{job.k8s_job_name}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.eval_metrics?.kernel_session_id && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Session</dt>
                            <dd className="font-mono mt-0.5 text-[10px] break-all">{job.eval_metrics.kernel_session_id}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.eval_metrics?.task_name && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Task</dt>
                            <dd className="font-mono mt-0.5 text-[10px]">{job.eval_metrics.task_name}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.eval_metrics?.dataset && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Dataset</dt>
                            <dd className="font-mono mt-0.5 text-[10px]">{job.eval_metrics.dataset}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.started_at && (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Started</dt>
                            <dd className="mt-0.5">{formatDateTime(job.started_at)}</dd>
                          </div>
                          <Separator />
                        </>
                      )}
                      {job.updated_at && (
                        <div>
                          <dt className="text-muted-foreground">Updated</dt>
                          <dd className="mt-0.5">{formatDateTime(job.updated_at)}</dd>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </dl>
            </CardContent>
          </Card>

          {/* Config Info — collapsed by default; raw JSON is verbose */}
          {job.config && (
            <Card>
              <Collapsible>
                <CollapsibleTrigger className="w-full text-left [&[data-state=open]>div>svg]:rotate-180">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Config</CardTitle>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <pre className="text-[10px] font-mono bg-muted/50 p-3 rounded-lg overflow-auto max-h-[200px]">
                      {JSON.stringify(job.config, null, 2)}
                    </pre>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          {/* Submission Config — small, but still secondary; collapse */}
          {job.config && (
            <Card data-testid="submission-config-card">
              <Collapsible>
                <CollapsibleTrigger className="w-full text-left [&[data-state=open]>div>svg]:rotate-180">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Submission Config</CardTitle>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <dl className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">CPUs</dt>
                        <dd className="font-mono">{job.config.cpus ?? 2}</dd>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Memory</dt>
                        <dd className="font-mono">{job.config.memory ?? 8192} MB</dd>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Storage</dt>
                        <dd className="font-mono">{job.config.storage ?? 10} GB</dd>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Cloud</dt>
                        <dd className="font-mono">{job.config.cloud ? 'Yes' : 'No'}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          {/* LLM Judge — Raw Request / Raw Response */}
          {(() => {
            // Aggregate raw_request + raw_response across phases. The
            // harness writes these as `raw_request` / `raw_response`
            // directly on the phase_result. Older / non-testing-agent
            // runs don't have either field → render nothing.
            const judgePhases = phaseResults
              .map((p, idx) => ({
                idx: p.phase_index !== undefined ? p.phase_index : idx,
                req: p.raw_request || '',
                resp: p.raw_response || '',
              }))
              .filter((p) => p.req || p.resp);
            if (judgePhases.length === 0) return null;
            return (
              <Card data-testid="llm-judge-raw-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    LLM Judge — Raw Request / Raw Response
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {judgePhases.length} phase{judgePhases.length !== 1 ? 's' : ''}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {judgePhases.map((p) => (
                    <JudgeRawBlock
                      key={`judge-${p.idx}`}
                      phaseIndex={p.idx}
                      request={p.req}
                      response={p.resp}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })()}

          {/* Phase Results — raw JSON, one labeled block per entry so it
              stays obvious how many phases vs replays the harness returned.
              The build entries can be enormous (each carries the full
              lint_report with hundreds of file_analyses), so dumping the
              whole array as a single blob made multi-entry runs look like
              a single phase. */}
          {job.phase_results && job.phase_results.length > 0 && (
            <Card>
              <Collapsible>
                <CollapsibleTrigger className="w-full text-left [&[data-state=open]>div>svg]:rotate-180">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm flex items-center gap-2">
                      Phase Results (raw)
                      <Badge variant="outline" className="text-[10px] font-mono" data-testid="phase-raw-count">
                        {job.phase_results.length} entr{job.phase_results.length === 1 ? 'y' : 'ies'}
                      </Badge>
                    </CardTitle>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-3">
                    {job.phase_results.map((entry, idx) => {
                      const isReplay = entry.kind === 'replay';
                      const phaseIdx = entry.phase_index != null ? entry.phase_index : idx;
                      const label = isReplay
                        ? `Replay ${entry.replay_index != null ? entry.replay_index : idx + 1} (phase ${phaseIdx + 1})`
                        : `Phase ${phaseIdx + 1}`;
                      return (
                        <PhaseRawBlock
                          key={idx}
                          label={label}
                          isReplay={isReplay}
                          entry={entry}
                          idx={idx}
                        />
                      );
                    })}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LLM Judge raw req/resp block ───────────────────────────────────────
function JudgeRawBlock({ phaseIndex, request, response }) {
  const [reqOpen, setReqOpen] = useState(false);
  const [respOpen, setRespOpen] = useState(false);

  const copy = async (text, label) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label}`);
    }
  };

  return (
    <div className="rounded-md border bg-muted/20" data-testid={`judge-raw-block-${phaseIndex}`}>
      <div className="px-3 py-1.5 border-b bg-muted/40 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Phase {phaseIndex + 1}
      </div>
      <div className="p-2 space-y-2">
        {request ? (
          <Collapsible open={reqOpen} onOpenChange={setReqOpen}>
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger
                className="flex items-center gap-1.5 text-[11px] font-medium hover:text-primary transition-colors"
                data-testid={`judge-raw-request-toggle-${phaseIndex}`}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${reqOpen ? 'rotate-90' : ''}`} />
                Raw Request
                <Badge variant="outline" className="text-[9px] font-mono ml-1">
                  {request.length} chars
                </Badge>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => copy(request, 'Raw request')}
                data-testid={`judge-raw-request-copy-${phaseIndex}`}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <CollapsibleContent className="mt-1.5">
              <pre
                className="text-[10px] font-mono bg-background border rounded p-2 overflow-auto max-h-[400px] whitespace-pre-wrap leading-relaxed"
                data-testid={`judge-raw-request-content-${phaseIndex}`}
              >
                {request}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="text-[10px] text-muted-foreground italic px-1">
            Raw request not captured for this phase.
          </div>
        )}
        {response ? (
          <Collapsible open={respOpen} onOpenChange={setRespOpen}>
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger
                className="flex items-center gap-1.5 text-[11px] font-medium hover:text-primary transition-colors"
                data-testid={`judge-raw-response-toggle-${phaseIndex}`}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${respOpen ? 'rotate-90' : ''}`} />
                Raw Response
                <Badge variant="outline" className="text-[9px] font-mono ml-1">
                  {response.length} chars
                </Badge>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => copy(response, 'Raw response')}
                data-testid={`judge-raw-response-copy-${phaseIndex}`}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <CollapsibleContent className="mt-1.5">
              <pre
                className="text-[10px] font-mono bg-background border rounded p-2 overflow-auto max-h-[400px] whitespace-pre-wrap leading-relaxed"
                data-testid={`judge-raw-response-content-${phaseIndex}`}
              >
                {response}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="text-[10px] text-muted-foreground italic px-1">
            Raw response not captured for this phase.
          </div>
        )}
      </div>
    </div>
  );
}


// ── Single raw phase_results entry block — collapsible per-entry so
// users can see at a glance how many phases vs replays the harness
// returned without scrolling through giant lint_report dumps.
function PhaseRawBlock({ label, isReplay, entry, idx }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(entry, null, 2);
  const sizeKb = (json.length / 1024).toFixed(1);
  return (
    <div
      className={`rounded-lg border ${isReplay ? 'border-cyan-500/30 bg-cyan-500/[0.02]' : 'border-border/50 bg-muted/30'}`}
      data-testid={`phase-raw-block-${idx}`}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-mono text-left hover:bg-accent/30 transition-colors rounded-lg"
            data-testid={`phase-raw-toggle-${idx}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ChevronRight
                className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}
              />
              <span className="font-semibold">{label}</span>
              {isReplay && (
                <Badge variant="outline" className="text-[9px] font-mono border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                  replay
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{sizeKb} KB</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3">
            <pre
              className="text-[10px] font-mono bg-background border rounded p-2 overflow-auto max-h-[400px] whitespace-pre-wrap leading-relaxed"
              data-testid={`phase-raw-content-${idx}`}
            >
              {json}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
