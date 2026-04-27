import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Play,
  Loader2,
  CalendarClock,
  Copy,
  ExternalLink,
  Clock,
  FileText,
  History,
  CheckCircle2,
  XCircle,
  RefreshCw,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  getScheduledBatch,
  updateScheduledBatch,
  deleteScheduledBatch,
  triggerScheduledBatch,
  listScheduledBatchRuns,
} from '@/services/schedulesApi';
import { parseApiError } from '@/lib/errorUtils';
import { humanizeCron } from './SchedulesList';
import useScheduleAnalytics from '@/hooks/useScheduleAnalytics';
import SummaryKPIs from '@/components/analytics/SummaryKPIs';
import ScoreTimeSeries from '@/components/analytics/ScoreTimeSeries';
import PhaseHeatmap from '@/components/analytics/PhaseHeatmap';
import ProblemLeaderboard from '@/components/analytics/ProblemLeaderboard';

function formatRelativeOrDash(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '—';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '—';
  }
}

function formatAbsoluteOrDash(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '—';
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

// Parse "YYYY-MM-DD" from a group_run_id like "{batch_id}-YYYY-MM-DD".
// Safer than split("-") because batch_id itself contains hyphens (UUID).
function extractDateFromGroupRunId(groupRunId) {
  if (!groupRunId || typeof groupRunId !== 'string') return null;
  const m = groupRunId.match(/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

// Normalise status for counting — harness may return varied casing
function normaliseStatus(s) {
  return (s || '').toString().toLowerCase().trim();
}

const DONE_STATUSES = new Set(['done', 'completed', 'success', 'succeeded']);
const FAILED_STATUSES = new Set(['failed', 'error', 'errored']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'pending', 'in_progress']);

function classifyStatus(s) {
  const n = normaliseStatus(s);
  if (DONE_STATUSES.has(n)) return 'done';
  if (FAILED_STATUSES.has(n)) return 'failed';
  if (ACTIVE_STATUSES.has(n)) return 'running';
  return 'other';
}

function statusBadge(status) {
  const kind = classifyStatus(status);
  const labelMap = {
    done: { text: status || 'done', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    failed: { text: status || 'failed', cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
    running: { text: status || 'running', cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    other: { text: status || 'unknown', cls: 'bg-muted text-muted-foreground' },
  };
  const { text, cls } = labelMap[kind];
  return (
    <Badge variant="outline" className={`text-[10px] font-mono ${cls}`}>
      {text}
    </Badge>
  );
}

export default function ScheduleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Run history
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsRefreshing, setRunsRefreshing] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(true);
  const pollRef = useRef(null);

  const fetchBatch = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const data = await getScheduledBatch(id);
        setBatch(data);
      } catch (error) {
        if (!silent) {
          toast.error(parseApiError(error, 'Failed to load schedule'));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id]
  );

  const fetchRuns = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRunsLoading(true);
      else setRunsRefreshing(true);
      try {
        const data = await listScheduledBatchRuns(id, { limit: 200, offset: 0 });
        setRuns(data?.jobs || []);
      } catch (error) {
        if (!silent) {
          toast.error(parseApiError(error, 'Failed to load run history'));
          setRuns([]);
        }
      } finally {
        if (!silent) setRunsLoading(false);
        else setRunsRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchBatch();
    fetchRuns();
  }, [fetchBatch, fetchRuns]);

  // Group jobs by group_run_id, sort runs by date DESC
  const groupedRuns = useMemo(() => {
    const map = new Map();
    for (const job of runs) {
      const gid = job.group_run_id || 'ungrouped';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid).push(job);
    }
    const arr = Array.from(map.entries()).map(([groupRunId, jobs]) => {
      let done = 0;
      let failed = 0;
      let running = 0;
      for (const j of jobs) {
        const c = classifyStatus(j.status);
        if (c === 'done') done += 1;
        else if (c === 'failed') failed += 1;
        else if (c === 'running') running += 1;
      }
      return {
        groupRunId,
        date: extractDateFromGroupRunId(groupRunId),
        jobs,
        total: jobs.length,
        done,
        failed,
        running,
      };
    });
    // Sort: most recent date first. Unparseable dates fall to the end.
    arr.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });
    return arr;
  }, [runs]);

  const hasActiveJobs = useMemo(
    () => runs.some((j) => classifyStatus(j.status) === 'running'),
    [runs]
  );

  // Derive analytics data from runs (pure transform, no fetching)
  const analytics = useScheduleAnalytics(runs);

  // Poll every 10s while any job is queued/running
  useEffect(() => {
    // Clear previous interval whenever dependencies change
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hasActiveJobs) {
      pollRef.current = setInterval(() => {
        fetchRuns({ silent: true });
        fetchBatch({ silent: true });
      }, 10000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveJobs, fetchRuns, fetchBatch]);

  const handleToggleEnabled = async (next) => {
    if (!batch) return;
    setTogglingEnabled(true);
    setBatch((prev) => ({ ...prev, enabled: next }));
    try {
      const updated = await updateScheduledBatch(batch.id, { enabled: next });
      setBatch(updated);
      toast.success(`Schedule ${next ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setBatch((prev) => ({ ...prev, enabled: !next }));
      toast.error(parseApiError(error, 'Failed to update schedule'));
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleTrigger = async () => {
    if (!batch) return;
    setTriggering(true);
    try {
      const result = await triggerScheduledBatch(batch.id);
      const count = result?.eval_job_ids?.length || 0;
      toast.success(`Triggered: ${count} eval job${count === 1 ? '' : 's'} fired`);
      fetchBatch({ silent: true });
      fetchRuns({ silent: true });
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to trigger schedule'));
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = async () => {
    if (!batch) return;
    setDeleting(true);
    try {
      await deleteScheduledBatch(batch.id);
      toast.success(`Deleted schedule: ${batch.schedule_tag}`);
      navigate('/schedules');
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to delete schedule'));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Schedule not found</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/schedules')}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
          Back to Schedules
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="schedule-detail-page">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/schedules')} data-testid="detail-back-btn">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold font-mono" data-testid="detail-tag">
              {batch.schedule_tag}
            </h1>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!batch.enabled}
                disabled={togglingEnabled}
                onCheckedChange={handleToggleEnabled}
                data-testid="detail-enabled-toggle"
              />
              <Badge
                variant="outline"
                className={
                  batch.enabled
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : 'bg-muted text-muted-foreground'
                }
              >
                {batch.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="detail-schedule">
              {humanizeCron(batch.cron_expression)}
            </p>
            <Badge variant="outline" className="font-mono text-[10px]">
              {batch.cron_expression}
            </Badge>
            {(batch.agent_id || batch.experiments?.agent_name) && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20"
                data-testid="detail-agent-badge"
                title="Cortex agent override sent as experiments.agent_name on every fire"
              >
                agent: {batch.agent_id || batch.experiments?.agent_name}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/schedules/${batch.id}/edit`)}
          data-testid="detail-edit-btn"
        >
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTrigger}
          disabled={triggering}
          data-testid="detail-trigger-btn"
        >
          {triggering ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-1.5" />
          )}
          Trigger Now
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="text-destructive hover:text-destructive"
          data-testid="detail-delete-btn"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Left: main content */}
        <div className="space-y-4">
          {/* Problems */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Problems
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {(batch.problem_ids || []).length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(batch.problem_ids || []).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No problems configured</p>
              ) : (
                <div className="flex flex-wrap gap-1.5" data-testid="detail-problems-list">
                  {batch.problem_ids.map((pid) => (
                    <Badge
                      key={pid}
                      variant="outline"
                      className="font-mono text-[10px]"
                      data-testid={`detail-problem-${pid}`}
                    >
                      {pid}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analytics */}
          <Card data-testid="analytics-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Analytics
                {analytics.summary.hasData && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    across {analytics.summary.totalRuns} run
                    {analytics.summary.totalRuns === 1 ? '' : 's'}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!analytics.summary.hasData ? (
                <div
                  className="flex flex-col items-center justify-center py-10 text-center gap-2"
                  data-testid="analytics-empty"
                >
                  <BarChart3 className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No analytics yet</p>
                  <p className="text-xs text-muted-foreground max-w-md">
                    The first fire will populate this section.
                  </p>
                </div>
              ) : (
                <>
                  {/* 1. KPI strip */}
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                      Summary
                    </h3>
                    <SummaryKPIs summary={analytics.summary} />
                  </div>

                  {/* 2. Per-problem time series across runs */}
                  {analytics.timeSeries.show && (
                    <div data-testid="analytics-time-series-section">
                      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                        Per-problem metric over time
                      </h3>
                      <ScoreTimeSeries timeSeries={analytics.timeSeries} />
                    </div>
                  )}

                  {/* 3. Per-problem leaderboard table */}
                  {analytics.leaderboard.show && (
                    <div data-testid="analytics-leaderboard-section">
                      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                        Problem performance
                      </h3>
                      <ProblemLeaderboard leaderboard={analytics.leaderboard} />
                    </div>
                  )}

                  {/* 4. Phase heatmap (only if any job has >1 phase) */}
                  {analytics.heatmap.show && (
                    <div data-testid="analytics-heatmap-section">
                      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                        Per-phase lint score heatmap
                      </h3>
                      <PhaseHeatmap heatmap={analytics.heatmap} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: sidebar */}
        <div className="space-y-4">
          {/* Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarClock className="w-4 h-4" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  ID
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <code className="text-[11px] font-mono truncate flex-1" data-testid="detail-id">
                    {batch.id}
                  </code>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 flex-shrink-0"
                          onClick={() => copyToClipboard(batch.id)}
                          data-testid="copy-id-btn"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy ID</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Cron
                </p>
                <code className="text-[11px] font-mono mt-0.5 block">
                  {batch.cron_expression}
                </code>
              </div>
              <Separator />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Last Run (IST)
                </p>
                <p className="text-xs mt-0.5" data-testid="detail-last-run">
                  {formatRelativeOrDash(batch.last_run_at)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatAbsoluteOrDash(batch.last_run_at)}
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Next Run (IST)
                </p>
                <p className="text-xs mt-0.5" data-testid="detail-next-run">
                  {formatRelativeOrDash(batch.next_run_at)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatAbsoluteOrDash(batch.next_run_at)}
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Created
                </p>
                <p className="text-xs mt-0.5">{formatRelativeOrDash(batch.created_at)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Updated
                </p>
                <p className="text-xs mt-0.5">{formatRelativeOrDash(batch.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Run History (collapsible) */}
          <Card data-testid="run-history-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setRunHistoryOpen((v) => !v)}
                  className="flex items-center gap-2 text-left group flex-1 min-w-0"
                  aria-expanded={runHistoryOpen}
                  data-testid="run-history-toggle"
                >
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${
                      runHistoryOpen ? '' : '-rotate-90'
                    }`}
                  />
                  <CardTitle className="text-sm flex items-center gap-2 min-w-0">
                    <History className="w-4 h-4 flex-shrink-0" />
                    <span>Run History</span>
                    <Badge variant="secondary" className="ml-1 text-[10px] flex-shrink-0">
                      {groupedRuns.length} fire{groupedRuns.length === 1 ? '' : 's'}
                    </Badge>
                    {hasActiveJobs && (
                      <Badge
                        variant="outline"
                        className="ml-1 text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20 flex items-center gap-1 flex-shrink-0"
                        data-testid="polling-indicator"
                      >
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        live
                      </Badge>
                    )}
                  </CardTitle>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchRuns();
                  }}
                  disabled={runsLoading}
                  className="h-7 flex-shrink-0"
                  data-testid="refresh-runs-btn"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${runsRefreshing || runsLoading ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </CardHeader>
            {runHistoryOpen && (
              <CardContent className="pt-0">
                {runsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : groupedRuns.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-6 text-center">
                    This batch hasn't fired yet.
                  </p>
                ) : (
                  <Accordion
                    type="multiple"
                    className="w-full"
                    data-testid="run-history-accordion"
                  >
                    {groupedRuns.map((run) => (
                      <AccordionItem
                        key={run.groupRunId}
                        value={run.groupRunId}
                        data-testid={`run-${run.groupRunId}`}
                      >
                        <AccordionTrigger className="text-xs hover:no-underline py-2.5">
                          <div className="flex items-center gap-2 flex-1 pr-2 min-w-0">
                            <div className="flex flex-col items-start min-w-0 flex-1">
                              <span
                                className="font-mono font-semibold text-xs"
                                data-testid={`run-date-${run.groupRunId}`}
                              >
                                {run.date || run.groupRunId}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {run.total} job{run.total === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {run.done > 0 && (
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5"
                                  data-testid={`run-done-${run.groupRunId}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-0.5" />
                                  {run.done}
                                </Badge>
                              )}
                              {run.failed > 0 && (
                                <Badge
                                  variant="outline"
                                  className="bg-rose-500/10 text-rose-600 border-rose-500/20 text-[10px] px-1.5"
                                  data-testid={`run-failed-${run.groupRunId}`}
                                >
                                  <XCircle className="w-3 h-3 mr-0.5" />
                                  {run.failed}
                                </Badge>
                              )}
                              {run.running > 0 && (
                                <Badge
                                  variant="outline"
                                  className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-1.5"
                                  data-testid={`run-running-${run.groupRunId}`}
                                >
                                  <Loader2 className="w-3 h-3 mr-0.5 animate-spin" />
                                  {run.running}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-1.5 pb-2">
                            {run.jobs.map((job) => (
                              <div
                                key={job.id || job.job_id}
                                onClick={() => navigate(`/evals/${job.id || job.job_id}`)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer transition-colors border"
                                data-testid={`run-job-${job.id || job.job_id}`}
                              >
                                <span className="font-mono text-[11px] flex-1 truncate">
                                  {(job.id || job.job_id || '').substring(0, 6)}
                                  <span className="text-muted-foreground">…</span>
                                </span>
                                {statusBadge(job.status)}
                                <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </CardContent>
            )}
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total fires</span>
                <span className="text-sm font-mono font-semibold" data-testid="stats-total-fires">
                  {groupedRuns.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total jobs</span>
                <span className="text-sm font-mono font-semibold" data-testid="stats-total-jobs">
                  {runs.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Problems</span>
                <span className="text-sm font-mono font-semibold" data-testid="stats-problem-count">
                  {(batch.problem_ids || []).length}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid="detail-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-mono font-medium">{batch.schedule_tag}</span>? This will permanently
              remove the schedule. Previously fired eval jobs remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="detail-confirm-delete"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
