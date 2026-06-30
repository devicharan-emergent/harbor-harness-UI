import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Loader2, ArrowLeft, ExternalLink, RefreshCw, Layers, Clock, Cpu, ActivitySquare, CheckCircle, XCircle, Ban, Copy, Timer, Play, BarChart3, Wrench } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { getEvalRunGroup, listGroupJobs, getEvalAggregate, listEvalJobs, replayEvalJobs } from '@/services/evalApi';
import { getJobAgentName, getJobModelName, getJobTemplateName } from '@/lib/jobShape';
import { parseApiError } from '@/lib/errorUtils';
import { useCreatedBy } from '@/contexts/AuthContext';

const STATUS_CONFIG = {
  queued: { color: 'bg-amber-500', icon: Clock, label: 'Queued' },
  generating: { color: 'bg-violet-500', icon: Cpu, label: 'Preparing' },
  running: { color: 'bg-blue-500', icon: ActivitySquare, label: 'Running' },
  replaying: { color: 'bg-cyan-500', icon: Loader2, label: 'Replaying' },
  completed: { color: 'bg-emerald-500', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'bg-red-500', icon: XCircle, label: 'Failed' },
  cancelled: { color: 'bg-slate-400', icon: Ban, label: 'Cancelled' },
};

// ── Status bar across the top — counts per status, total progress ─────
function GroupStatusBar({ jobs }) {
  const counts = useMemo(() => {
    const c = { queued: 0, generating: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const j of jobs) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [jobs]);
  const total = jobs.length || 1;
  const segments = Object.entries(counts).filter(([_, n]) => n > 0);
  return (
    <Card data-testid="group-status-bar">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
          <span className="text-[10px] font-mono text-muted-foreground">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex w-full h-2 rounded-full overflow-hidden bg-muted/40" data-testid="group-status-progress">
          {segments.map(([status, n]) => {
            const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
            const pct = (n / total) * 100;
            return (
              <div
                key={status}
                className={cfg.color}
                style={{ width: `${pct}%` }}
                title={`${cfg.label}: ${n}`}
                data-testid={`group-status-segment-${status}`}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          {Object.entries(counts).map(([status, n]) => {
            if (n === 0) return null;
            const cfg = STATUS_CONFIG[status];
            return (
              <div key={status} className="flex items-center gap-1.5 text-[11px]" data-testid={`group-status-count-${status}`}>
                <div className={`w-2 h-2 rounded-full ${cfg.color}`} />
                <span className="font-mono">{n}</span>
                <span className="text-muted-foreground">{cfg.label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Config card — first job's submission config = point-in-time snap ──
function ConfigSnapshotCard({ firstJob }) {
  if (!firstJob) return null;
  const cfg = firstJob.config || {};
  // For scratch_bench / bug_bench / test_report_bench the harness does
  // NOT return a separate `model_name` — the model is baked into the
  // agent_name itself (e.g. `..._sonnet_4_5`). Only testing_agent_bench
  // jobs carry an explicit model_name. Same story for template_name.
  // Render those cells only when they actually exist; show "—" only for
  // Agent (which every job has).
  const agentName = getJobAgentName(firstJob) || '—';
  const modelName = getJobModelName(firstJob);
  const templateName = getJobTemplateName(firstJob);
  return (
    <Card data-testid="group-config-card">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Config (point-in-time)</span>
          <span className="text-[10px] font-mono text-muted-foreground font-normal">
            from job {firstJob.id?.substring(0, 8)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Agent</dt>
            <dd className="font-mono mt-0.5 truncate" title={agentName} data-testid="group-config-agent">{agentName}</dd>
          </div>
          {modelName ? (
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Model</dt>
              <dd className="font-mono mt-0.5 truncate" title={modelName} data-testid="group-config-model">{modelName}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Model</dt>
              <dd
                className="mt-0.5 text-[10px] text-muted-foreground italic"
                title="Model is encoded inside the agent name (e.g. ..._sonnet_4_5). Only testing_agent_bench runs send a separate model_name."
                data-testid="group-config-model"
              >
                implicit (from agent)
              </dd>
            </div>
          )}
          {templateName ? (
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Template</dt>
              <dd className="font-mono mt-0.5 truncate" title={templateName} data-testid="group-config-template">{templateName}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Template</dt>
              <dd className="mt-0.5 text-[10px] text-muted-foreground italic" data-testid="group-config-template">none</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Resources</dt>
            <dd className="font-mono mt-0.5">
              {cfg.cpus ?? '—'} cpu · {cfg.memory ?? '—'} MB · {cfg.storage ?? '—'} GB
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Aggregate scores card — avg Lintiq + Browser ──────────────────────
function GroupScoresCard({ jobs, aggregate }) {
  const stats = useMemo(() => {
    const lintiq = jobs.map(j => j.lintiq_score).filter(v => v != null);
    const browser = jobs.map(j => j.browser_reward).filter(v => v != null);
    const combined = jobs.map(j => j.combined_reward).filter(v => v != null);
    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return {
      lintiqAvg: avg(lintiq), lintiqCount: lintiq.length,
      browserAvg: avg(browser), browserCount: browser.length,
      combinedAvg: avg(combined), combinedCount: combined.length,
    };
  }, [jobs]);

  const passRate = aggregate?.test_pass_rate != null ? aggregate.test_pass_rate * 100 : null;
  const passColor = passRate == null ? '' : passRate >= 80 ? 'text-emerald-600' : passRate >= 50 ? 'text-amber-600' : 'text-red-600';

  const ScoreCell = ({ label, value, count, testId }) => {
    const pct = value == null ? null : value * 100;
    const color = pct == null ? '' : pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
    return (
      <div>
        <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</dt>
        <dd className="flex items-baseline gap-2 mt-0.5" data-testid={testId}>
          {pct != null ? (
            <>
              <span className={`text-lg font-mono font-bold ${color}`}>{pct.toFixed(0)}%</span>
              <span className="text-[10px] text-muted-foreground font-mono">({count} job{count === 1 ? '' : 's'})</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </dd>
      </div>
    );
  };

  return (
    <Card data-testid="group-scores-card">
      <CardHeader>
        <CardTitle className="text-sm">Scores</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <ScoreCell label="Lintiq (avg)" value={stats.lintiqAvg} count={stats.lintiqCount} testId="score-lintiq-avg" />
          <ScoreCell label="Browser (avg)" value={stats.browserAvg} count={stats.browserCount} testId="score-browser-avg" />
          <ScoreCell label="Combined (avg)" value={stats.combinedAvg} count={stats.combinedCount} testId="score-combined-avg" />
          <div>
            <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Test Pass Rate</dt>
            <dd className="flex items-baseline gap-2 mt-0.5" data-testid="score-test-pass-rate">
              {passRate != null ? (
                <>
                  <span className={`text-lg font-mono font-bold ${passColor}`}>{passRate.toFixed(0)}%</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ({aggregate.test_cases_passed ?? 0}/{aggregate.test_cases_total ?? 0})
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Job row — clicking opens that job's eval detail in a new tab ──────
function JobRow({ job, selectable, selected, onToggleSelect }) {
  const cfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
  const StatusIcon = cfg.icon;
  const agentName = getJobAgentName(job);
  const modelName = getJobModelName(job);
  // Replay-eligible: only completed scratch_bench_phased jobs can be
  // replayed (browser verifier only re-runs on a built preview). The
  // harness will also enforce this server-side, but client filtering
  // keeps the checkbox UI honest.
  const isReplayEligible =
    job.status === 'completed' &&
    (job.dataset_type === 'scratch_bench_phased' ||
      (job.problem || '').startsWith('scratch_bench_phased/'));
  const isReplaying = job.status === 'replaying';
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-accent/40 transition-colors text-xs ${isReplaying ? 'ring-1 ring-cyan-500/40' : ''}`}
      data-testid={`group-job-row-${job.id}`}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          disabled={!isReplayEligible}
          onCheckedChange={(v) => onToggleSelect?.(job.id, !!v)}
          aria-label={`Select ${job.problem}`}
          className="flex-shrink-0"
          data-testid={`group-job-select-${job.id}`}
        />
      )}
      <Link
        to={`/evals/${job.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 flex-1 min-w-0 no-underline text-foreground"
      >
        <div className="flex items-center gap-1.5 w-[110px] flex-shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.color}`} />
          <StatusIcon className={`w-3 h-3 text-muted-foreground ${isReplaying ? 'animate-spin' : ''}`} />
          <span className="text-[10px] capitalize">{cfg.label}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono font-medium truncate">{job.problem}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {agentName && (
              <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400">
                {agentName}
              </Badge>
            )}
            {modelName && (
              <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
                {modelName}
              </Badge>
            )}
            <span className="text-[9px] text-muted-foreground/50 font-mono">{job.id.substring(0, 8)}</span>
          </div>
        </div>
        {job.lintiq_score != null && (
          <Badge variant="outline" className="text-[9px] font-mono" data-testid={`group-job-lintiq-${job.id}`}>
            L {(job.lintiq_score * 100).toFixed(0)}%
          </Badge>
        )}
        {job.browser_reward != null && (
          <Badge variant="outline" className="text-[9px] font-mono" data-testid={`group-job-browser-${job.id}`}>
            B {(job.browser_reward * 100).toFixed(0)}%
          </Badge>
        )}
        {job.combined_reward != null && (
          <Badge variant="outline" className="text-[9px] font-mono font-bold">
            C {(job.combined_reward * 100).toFixed(0)}%
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground flex-shrink-0 w-24 text-right">
          {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
        </span>
        <ExternalLink className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
      </Link>
      {job.cortex_job_id && (
        <a
          href={`https://app.emergent.sh/home?job_id=${job.cortex_job_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 flex-shrink-0 text-[10px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline whitespace-nowrap"
          data-testid={`group-job-emergent-link-${job.id}`}
          title="Open the Emergent job in a new tab"
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          View Emergent Job
        </a>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export default function GroupDetailPage() {
  const { groupRunId } = useParams();
  const navigate = useNavigate();
  const triggeredBy = useCreatedBy();
  const [meta, setMeta] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [aggregate, setAggregate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [replaying, setReplaying] = useState(false);

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [metaRes, jobsRes, aggRes] = await Promise.all([
        getEvalRunGroup(groupRunId).catch(err => {
          console.warn('group meta fetch failed:', err);
          return null;
        }),
        listGroupJobs(groupRunId, { limit: 100 }).catch(err => {
          console.warn('group jobs fetch failed:', err);
          return { jobs: [] };
        }),
        getEvalAggregate(groupRunId).catch(err => {
          console.warn('aggregate fetch failed:', err);
          return null;
        }),
      ]);
      let foundJobs = (jobsRes && jobsRes.jobs) || [];
      // Fallback: harness `/groups/{id}/evals` is 404 for some run IDs.
      // Scan recent `/jobs` pages and filter client-side by group_run_id.
      // Capped at 5 pages × 100 jobs to keep latency bounded.
      if (foundJobs.length === 0) {
        const PAGE_SIZE = 100;
        const MAX_PAGES = 5;
        const collected = [];
        for (let i = 0; i < MAX_PAGES; i++) {
          // eslint-disable-next-line no-await-in-loop
          const page = await listEvalJobs({
            limit: PAGE_SIZE,
            offset: i * PAGE_SIZE,
          }).catch(() => null);
          if (!page || !page.jobs || page.jobs.length === 0) break;
          for (const j of page.jobs) {
            const gid = j.group_run_id || j.group_id || j.config?.group_run_id || j.config?.group_id;
            if (gid === groupRunId) collected.push(j);
          }
          if (page.jobs.length < PAGE_SIZE) break;
        }
        foundJobs = collected;
      }
      setMeta(metaRes);
      setJobs(foundJobs);
      setAggregate(aggRes);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to load group details'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupRunId]);

  useEffect(() => { fetchAll(false); }, [fetchAll]);

  // ── Live polling while any job is in transient "replaying" status ───
  // We poll every 5s until none remain in `replaying`. This keeps the
  // status pill + cyan ring in sync without a hard refresh.
  const anyReplaying = useMemo(
    () => jobs.some(j => j.status === 'replaying'),
    [jobs],
  );
  useEffect(() => {
    if (!anyReplaying) return;
    const interval = setInterval(() => fetchAll(true), 5000);
    return () => clearInterval(interval);
  }, [anyReplaying, fetchAll]);

  // ── Replay-eligibility helper (mirrors JobRow's gate) ────────────────
  const isJobReplayEligible = useCallback((j) => (
    j.status === 'completed' &&
    (j.dataset_type === 'scratch_bench_phased' ||
      (j.problem || '').startsWith('scratch_bench_phased/'))
  ), []);

  const eligibleJobs = useMemo(
    () => jobs.filter(isJobReplayEligible),
    [jobs, isJobReplayEligible],
  );

  const toggleSelect = useCallback((jobId, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(jobId); else next.delete(jobId);
      return next;
    });
  }, []);

  const toggleSelectAllEligible = useCallback(() => {
    setSelectedIds(prev => {
      const allEligibleIds = eligibleJobs.map(j => j.id);
      const allSelected = allEligibleIds.length > 0 &&
        allEligibleIds.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allEligibleIds);
    });
  }, [eligibleJobs]);

  const handleReplaySelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setReplaying(true);
    try {
      const resp = await replayEvalJobs(ids, triggeredBy);
      const results = resp?.results || [];
      const ok = results.filter(r => r.status === 'replaying').length;
      const errs = results.filter(r => r.status === 'error');
      if (ok > 0) toast.success(`Replaying ${ok} job${ok === 1 ? '' : 's'}`);
      if (errs.length > 0) {
        toast.error(`${errs.length} replay${errs.length === 1 ? '' : 's'} failed: ${errs[0].error || errs[0].message || 'unknown error'}`);
      }
      setSelectedIds(new Set());
      // Refresh once immediately — polling will pick up subsequent updates.
      fetchAll(true);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to start replay'));
    } finally {
      setReplaying(false);
    }
  }, [selectedIds, triggeredBy, fetchAll]);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [jobs],
  );

  const copyId = () => {
    navigator.clipboard.writeText(groupRunId).then(
      () => toast.success('Group ID copied'),
      () => toast.error('Could not copy'),
    );
  };

  const displayName = meta?.group_name || groupRunId;
  // Redash comparison dashboards, pre-filled with this group as group_set_1.
  const redashGroupArr = encodeURIComponent(JSON.stringify([groupRunId]));
  const redashSummaryUrl = `https://redash.internal-apps.emergentagent.com/dashboards/730?p_agent_name=All&p_group_set_1=${redashGroupArr}&p_model=All`;
  const redashToolUrl = `https://redash.internal-apps.emergentagent.com/dashboards/731?p_agent_name=All&p_group_set_1=${redashGroupArr}&p_model=All&p_tool=execute_bash&p_window_end=All`;
  const groupComment = meta?.comment || '';
  const createdAt = meta?.created_at;
  const updatedAt = meta?.updated_at;
  const firstJob = jobs.length > 0 ? jobs[jobs.length - 1] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="group-detail-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="group-detail-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => navigate('/evals')}
            title="Back to Eval Runs"
            data-testid="group-detail-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <h1 className="text-xl font-bold truncate" data-testid="group-detail-name">{displayName}</h1>
              <Badge variant="secondary" className="text-[10px] font-mono">{jobs.length} job{jobs.length === 1 ? '' : 's'}</Badge>
              <a
                href={redashSummaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 hover:bg-accent flex-shrink-0"
                data-testid="group-detail-redash-summary"
                aria-label="Open Eval Data Comparison (Redash dashboard 730)"
                title="Eval Data Comparison (Redash 730) — this group preselected"
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </a>
              <a
                href={redashToolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 hover:bg-accent flex-shrink-0"
                data-testid="group-detail-redash-tools"
                aria-label="Open Eval Tool-Usage Comparison (Redash dashboard 731)"
                title="Eval Tool-Usage Comparison (Redash 731) — this group preselected"
              >
                <Wrench className="w-3.5 h-3.5" />
              </a>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <code className="text-[10px] font-mono text-muted-foreground break-all" data-testid="group-detail-id">{groupRunId}</code>
              <button
                onClick={copyId}
                className="text-muted-foreground hover:text-foreground"
                title="Copy group_run_id"
                data-testid="group-detail-copy-id"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            {groupComment && (
              <p className="text-xs text-muted-foreground mt-1.5" data-testid="group-detail-comment">{groupComment}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/80 font-mono">
              {createdAt && <span>created {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>}
              {updatedAt && <span>· updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}</span>}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          data-testid="group-detail-refresh"
        >
          {refreshing
            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Refresh
        </Button>
      </div>

      <Separator />

      {/* Status bar */}
      <GroupStatusBar jobs={jobs} />

      {/* Config + Scores */}
      <ConfigSnapshotCard firstJob={firstJob} />
      <GroupScoresCard jobs={jobs} aggregate={aggregate} />

      {/* Aggregate timing — small block from harness aggregate (if present) */}
      {aggregate && (aggregate.avg_duration_secs != null || aggregate.p90_duration_secs != null) && (
        <Card data-testid="group-aggregate-timing-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" />
              Timing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Avg</dt>
                <dd className="font-mono mt-0.5 font-semibold">{formatSec(aggregate.avg_duration_secs)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">P75</dt>
                <dd className="font-mono mt-0.5 font-semibold">{formatSec(aggregate.p75_duration_secs)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">P90</dt>
                <dd className="font-mono mt-0.5 font-semibold">{formatSec(aggregate.p90_duration_secs)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Jobs list */}
      <Card data-testid="group-jobs-list-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span>Jobs</span>
              {eligibleJobs.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAllEligible}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  data-testid="group-select-all-eligible"
                >
                  {eligibleJobs.every(j => selectedIds.has(j.id)) && selectedIds.size > 0
                    ? `Clear (${selectedIds.size})`
                    : `Select all eligible (${eligibleJobs.length})`}
                </button>
              )}
              {selectedIds.size > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono" data-testid="group-selection-count">
                  {selectedIds.size} selected
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={selectedIds.size === 0 || replaying}
                onClick={handleReplaySelected}
                data-testid="group-replay-browser-tests-btn"
                className="h-7 text-xs"
                title={selectedIds.size === 0
                  ? 'Select one or more completed scratch_bench_phased jobs to replay'
                  : `Re-run browser verifier on ${selectedIds.size} job${selectedIds.size === 1 ? '' : 's'}`}
              >
                {replaying
                  ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  : <Play className="w-3 h-3 mr-1.5" />}
                Replay browser tests{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
              <span className="text-[10px] font-mono text-muted-foreground font-normal">click a row to open</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedJobs.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">No jobs in this group.</div>
          ) : (
            <div className="space-y-1.5" data-testid="group-jobs-list">
              {sortedJobs.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  selectable
                  selected={selectedIds.has(job.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatSec(secs) {
  if (secs == null) return '—';
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
