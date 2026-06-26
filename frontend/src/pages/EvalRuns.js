import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getEvalStats, listEvalJobs, listGroupJobs, getEvalAggregate, cancelEvalJob, listEvalRunGroups, patchEvalRunGroup } from '@/services/evalApi';
import { getJobAgentName, getJobModelName, isTestingAgentJob, getTestingAgentInstanceName, getTestingAgentProdJobId } from '@/lib/jobShape';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Clock, Cpu, CheckCircle, XCircle, Ban, ActivitySquare, RefreshCw, Plus, ChevronDown, ChevronRight, Layers, ExternalLink, Timer, Pencil, MessageSquare } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/errorUtils';
import { RunEvalModal } from '@/components/evals/RunEvalModal';
import { EvalFilterBar, EMPTY_FILTERS, buildJobFilter } from '@/components/evals/EvalFilterBar';

const STATUS_CONFIG = {
  queued: { color: 'bg-amber-500', icon: Clock, label: 'Queued' },
  generating: { color: 'bg-violet-500', icon: Cpu, label: 'Preparing' },
  running: { color: 'bg-blue-500', icon: ActivitySquare, label: 'Running' },
  replaying: { color: 'bg-cyan-500', icon: Loader2, label: 'Replaying' },
  completed: { color: 'bg-emerald-500', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'bg-red-500', icon: XCircle, label: 'Failed' },
  cancelled: { color: 'bg-slate-400', icon: Ban, label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${config.color}`} />
      <span className="text-xs capitalize">{config.label}</span>
    </div>
  );
}

function ScoreBadges({ job }) {
  if (job.browser_reward === undefined && job.combined_reward === undefined) return null;
  return (
    <div className="flex items-center gap-1">
      {job.combined_reward !== undefined && (
        <Badge variant="outline" className="text-[9px] font-mono" data-testid={`score-${job.id}`}>
          {(job.combined_reward * 100).toFixed(0)}%
        </Badge>
      )}
    </div>
  );
}

// Group summary badges
function GroupStatusSummary({ jobs }) {
  const counts = {};
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] || 0) + 1;
  }
  return (
    <div className="flex items-center gap-1">
      {Object.entries(counts).map(([status, count]) => {
        const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
        return (
          <Badge key={status} variant="outline" className="text-[9px] font-mono px-1.5 py-0 flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${config.color}`} />
            {count}
          </Badge>
        );
      })}
    </div>
  );
}

// ── CancelJobButton ────────────────────────────────────────────────────
// Inline cancel button rendered next to the status pill on each row.
// Only active jobs (queued / generating / running) can be cancelled; for
// every other status we render nothing so the row stays compact.
// Click is stopped so the parent row's navigate-to-detail handler doesn't
// fire when the user is trying to cancel.
const CANCELLABLE_STATUSES = new Set(['queued', 'generating', 'running']);
function CancelJobButton({ jobId, status, onCancelled }) {
  const [cancelling, setCancelling] = useState(false);
  if (!CANCELLABLE_STATUSES.has(status)) return null;

  const handleClick = async (e) => {
    e.stopPropagation();
    if (cancelling) return;
    if (!window.confirm('Cancel this eval job? In-flight phases will be terminated.')) return;
    setCancelling(true);
    try {
      await cancelEvalJob(jobId);
      toast.success(`Job ${jobId.substring(0, 8)} cancelled`);
      onCancelled && onCancelled(jobId);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to cancel job'));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 flex-shrink-0"
      onClick={handleClick}
      disabled={cancelling}
      title="Cancel this job"
      aria-label={`Cancel job ${jobId.substring(0, 8)}`}
      data-testid={`cancel-job-${jobId}`}
    >
      {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
    </Button>
  );
}

function formatDuration(secs) {
  if (secs == null) return '—';
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function GroupAggregateSummary({ aggregate }) {
  if (!aggregate || !aggregate.problems || aggregate.problems.length === 0) return null;

  const totalJobs = aggregate.total_jobs ?? 0;
  const completedJobs = aggregate.completed_jobs ?? 0;
  const avgDuration = aggregate.avg_duration_secs ?? null;
  const p75Duration = aggregate.p75_duration_secs ?? null;
  const p90Duration = aggregate.p90_duration_secs ?? null;
  const totalPassed = aggregate.test_cases_passed ?? 0;
  const totalCases = aggregate.test_cases_total ?? 0;
  const passRate = aggregate.test_pass_rate != null ? aggregate.test_pass_rate * 100 : null;
  const passColor = passRate == null ? '' : passRate >= 80 ? 'text-emerald-600' : passRate >= 50 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="mb-3 rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <Timer className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Eval Summary</span>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{completedJobs}/{totalJobs} completed</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-4 py-3">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Avg Time</div>
          <div className="text-sm font-mono font-semibold">{formatDuration(avgDuration)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">P75 Time</div>
          <div className="text-sm font-mono font-semibold">{formatDuration(p75Duration)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">P90 Time</div>
          <div className="text-sm font-mono font-semibold">{formatDuration(p90Duration)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Test Pass Rate</div>
          {passRate != null ? (
            <div className="flex items-center gap-2">
              <span className={`text-sm font-mono font-semibold ${passColor}`}>{passRate.toFixed(0)}%</span>
              <span className="text-[10px] text-muted-foreground font-mono">({totalPassed}/{totalCases})</span>
            </div>
          ) : (
            <div className="text-sm font-mono font-semibold text-muted-foreground">—</div>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupAvgScore({ jobs }) {
  const scored = jobs.filter(j => j.combined_reward !== undefined);
  if (scored.length === 0) return null;
  const avg = scored.reduce((s, j) => s + j.combined_reward, 0) / scored.length;
  const color = avg >= 0.8 ? 'text-emerald-600' : avg >= 0.5 ? 'text-amber-600' : 'text-red-600';
  return (
    <Badge variant="outline" className={`text-[10px] font-mono font-bold ${color}`}>
      avg {(avg * 100).toFixed(0)}%
    </Badge>
  );
}

export default function EvalRuns() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The harness now stamps `created_by = <email>` on every owner-tagged row
  // (changed from user_id UUID). Use the same value for the "Mine only"
  // filter and the predicate so we match correctly post-migration.
  const currentUserCreatedBy = user?.email || null;
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const [evalModalOpen, setEvalModalOpen] = useState(false);
  // Deep-link entry: /evals?run=1&eph=<eph>&agent=<agent_id> auto-opens the
  // RunEvalModal pre-filled. Sourced once on mount from the URL; the params
  // are then stripped so closing + reopening starts clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepLinkInitial, setDeepLinkInitial] = useState({ eph: '', agent: '', viewId: '' });
  useEffect(() => {
    const runFlag = searchParams.get('run') === '1';
    const viewId = (searchParams.get('view') || '').trim();
    // Open the modal when either deep-link form is present.
    if (runFlag || viewId) {
      const eph = (searchParams.get('eph') || '').trim();
      const agent = (searchParams.get('agent') || '').trim();
      setDeepLinkInitial({ eph, agent, viewId });
      setEvalModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('run');
      next.delete('eph');
      next.delete('agent');
      next.delete('view');
      setSearchParams(next, { replace: true });
    }
    // Run once on mount — the URL params are consumed and stripped, so we
    // don't want this to re-trigger if the user later edits the URL or
    // setSearchParams above bumps the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Expanded group detail jobs (from group API)
  const [groupDetailJobs, setGroupDetailJobs] = useState({});
  const [loadingGroup, setLoadingGroup] = useState({});
  const [groupAggregates, setGroupAggregates] = useState({});

  // Editable group metadata (group_name + comment) keyed by group_run_id.
  // Sourced from GET /api/eval/eval-run-groups; jobs themselves don't carry
  // these fields. Loaded alongside jobs on every fetch + refresh tick.
  const [groupMeta, setGroupMeta] = useState({});
  // Edit modal state: { open, groupRunId, name, comment, saving }
  const [editModal, setEditModal] = useState({ open: false, groupRunId: '', name: '', comment: '', saving: false });

  const fetchGroupsMeta = useCallback(async () => {
    try {
      const data = await listEvalRunGroups({ limit: 200 });
      const list = data?.groups || data?.items || (Array.isArray(data) ? data : []);
      const map = {};
      for (const g of list) {
        if (!g || !g.group_run_id) continue;
        map[g.group_run_id] = {
          group_name: g.group_name || '',
          comment: g.comment || '',
        };
      }
      setGroupMeta(map);
    } catch (err) {
      // Non-fatal — UI falls back to group_run_id rendering.
      console.warn('Failed to fetch eval-run-groups metadata:', err);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getEvalStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  // True when any advanced filter is set. Batch-name search + agent + prompt
  // + date-range all behave as "narrow across the whole dataset"; with normal
  // server pagination the filter can only see the current page which looks
  // broken when matches live on later pages. So we auto-fetch-all here.
  const hasActiveFilter = useMemo(() => (
    Boolean(
      (filters.batch || '').trim() ||
      (filters.agent || '').trim() ||
      (filters.prompt || '').trim() ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.mineOnly,
    )
  ), [filters]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      // When "Mine only" is on we pass `created_by` to the server so the
      // filter works across pagination (server-side narrowing) instead of
      // only on whatever happens to be in the current page.
      const mineParam = (filters.mineOnly && currentUserCreatedBy) ? { created_by: currentUserCreatedBy } : {};
      if (hasActiveFilter) {
        // Exhaustive fetch (capped) so client-side filters see everything.
        const all = [];
        const MAX_JOBS = 2000; // safety cap — stops well before OOM
        for (let offset = 0; offset < MAX_JOBS; offset += pageSize) {
          const params = { limit: pageSize, offset, ...mineParam };
          if (selectedStatus !== 'all') params.status = selectedStatus;
          // eslint-disable-next-line no-await-in-loop
          const chunk = await listEvalJobs(params);
          const jobsChunk = chunk.jobs || [];
          all.push(...jobsChunk);
          if (jobsChunk.length < pageSize) break;
        }
        setJobs(all);
      } else {
        const params = { limit: pageSize, offset: page * pageSize, ...mineParam };
        if (selectedStatus !== 'all') params.status = selectedStatus;
        const data = await listEvalJobs(params);
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, page, hasActiveFilter, filters.mineOnly, currentUserCreatedBy]);

  useEffect(() => { fetchStats(); fetchGroupsMeta(); }, []);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  // When a filter toggles on, reset pagination so `page` never ends up stale.
  useEffect(() => { if (hasActiveFilter) setPage(0); }, [hasActiveFilter]);

  // Group jobs by group_run_id (falling back to legacy group_id for compatibility)
  // Filter first — groups with zero matching jobs disappear entirely.
  // The predicate also gets a `{group_run_id: group_name}` resolver so the
  // search input matches against the friendly editable group name in
  // addition to the raw immutable `group_run_id`.
  const groupNameByRunId = useMemo(() => {
    const map = {};
    for (const [gid, meta] of Object.entries(groupMeta || {})) {
      if (meta?.group_name) map[gid] = meta.group_name;
    }
    return map;
  }, [groupMeta]);

  const filterPredicate = useMemo(
    () => buildJobFilter(filters, currentUserCreatedBy, groupNameByRunId),
    [filters, currentUserCreatedBy, groupNameByRunId],
  );

  const filteredJobs = useMemo(
    () => jobs.filter(filterPredicate),
    [jobs, filterPredicate],
  );

  const groups = useMemo(() => {
    const map = {};
    for (const job of filteredJobs) {
      const gid =
        job.group_run_id ||
        job.group_id ||
        job.config?.group_run_id ||
        job.config?.group_id ||
        '_ungrouped';
      if (!map[gid]) {
        map[gid] = { groupId: gid, jobs: [], latestCreated: job.created_at };
      }
      map[gid].jobs.push(job);
      if (job.created_at > map[gid].latestCreated) {
        map[gid].latestCreated = job.created_at;
      }
    }
    // Sort groups by latest created descending
    return Object.values(map).sort((a, b) => new Date(b.latestCreated) - new Date(a.latestCreated));
  }, [filteredJobs]);

  const toggleGroup = async (groupId) => {
    const isOpen = expandedGroups[groupId];
    setExpandedGroups(prev => ({ ...prev, [groupId]: !isOpen }));

    // Fetch group detail jobs and aggregate metrics if not already loaded
    if (!isOpen && groupId !== '_ungrouped' && !groupDetailJobs[groupId]) {
      setLoadingGroup(prev => ({ ...prev, [groupId]: true }));
      try {
        const [jobsData, aggData] = await Promise.all([
          listGroupJobs(groupId, { limit: 100 }),
          getEvalAggregate(groupId).catch(err => {
            console.error(`Failed to fetch aggregate for ${groupId}:`, err);
            return null;
          }),
        ]);
        setGroupDetailJobs(prev => ({ ...prev, [groupId]: jobsData.jobs || [] }));
        if (aggData) {
          setGroupAggregates(prev => ({ ...prev, [groupId]: aggData }));
        }
      } catch (err) {
        console.error(`Failed to fetch group ${groupId}:`, err);
      } finally {
        setLoadingGroup(prev => ({ ...prev, [groupId]: false }));
      }
    }
  };

  const getGroupJobs = (group) => {
    if (group.groupId === '_ungrouped') return group.jobs;
    // When expanded we fetch the full per-group job list (may include jobs
    // not in the current page). Apply the same filter so expanded content
    // respects what the user is narrowing on.
    const detail = groupDetailJobs[group.groupId];
    if (!detail) return group.jobs;
    return detail.filter(filterPredicate);
  };

  // Unique agents in a group — uses the same fallback chain as JobDetail
  // so scratch_bench (config.agent_name) and testing_agent_bench
  // (config.experiments.agent_name) both light up.
  const getGroupAgents = (jobsList) => {
    const agents = new Set();
    for (const j of jobsList) {
      const name = getJobAgentName(j);
      if (name) agents.add(name);
    }
    return [...agents];
  };

  // Open the edit modal pre-filled with the current name + comment.
  const openEditGroupModal = (groupRunId) => {
    const meta = groupMeta[groupRunId] || {};
    setEditModal({
      open: true,
      groupRunId,
      name: meta.group_name || '',
      comment: meta.comment || '',
      saving: false,
    });
  };

  const closeEditGroupModal = () => {
    setEditModal({ open: false, groupRunId: '', name: '', comment: '', saving: false });
  };

  // Optimistic PATCH: stamp the new values into local state immediately,
  // then call the backend. On failure, revert to the previous snapshot
  // (read off the modal's `groupRunId`) and toast the error.
  const submitEditGroup = async () => {
    const { groupRunId, name, comment } = editModal;
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      toast.error('Group name is required');
      return;
    }
    const prev = groupMeta[groupRunId] || { group_name: '', comment: '' };
    setEditModal(prev2 => ({ ...prev2, saving: true }));
    // Optimistic update
    setGroupMeta(m => ({ ...m, [groupRunId]: { group_name: trimmedName, comment: comment || '' } }));
    try {
      const updated = await patchEvalRunGroup(groupRunId, {
        group_name: trimmedName,
        comment: comment || '',
      });
      // Sync from server response if it returns the canonical row.
      if (updated && updated.group_run_id === groupRunId) {
        setGroupMeta(m => ({
          ...m,
          [groupRunId]: {
            group_name: updated.group_name || trimmedName,
            comment: updated.comment || '',
          },
        }));
      }
      toast.success('Group updated');
      closeEditGroupModal();
    } catch (err) {
      // Roll back
      setGroupMeta(m => ({ ...m, [groupRunId]: prev }));
      toast.error(parseApiError(err) || 'Failed to update group');
      setEditModal(prev2 => ({ ...prev2, saving: false }));
    }
  };

  return (
    <div className="space-y-6 pb-16" data-testid="eval-runs-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Eval Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">Evaluation jobs grouped by batch ID</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { fetchJobs(); fetchStats(); fetchGroupsMeta(); }} variant="outline" size="sm" data-testid="refresh-evals-btn">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => setEvalModalOpen(true)} size="sm" data-testid="new-eval-btn">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Eval
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {/* Total — sum of all per-status counts. Clickable, resets selected
              status to "all" for parity with the per-status cards below. */}
          <Card
            className={`cursor-pointer transition-all hover:scale-105 ${selectedStatus === 'all' ? 'ring-2 ring-ring' : ''}`}
            onClick={() => { setSelectedStatus('all'); setPage(0); }}
            data-testid="stat-card-total"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <div className="w-2 h-2 rounded-full bg-foreground" />
              </div>
              <div className="mt-2">
                <div className="text-2xl font-bold" data-testid="stat-total-count">
                  {Object.keys(STATUS_CONFIG).reduce((sum, s) => sum + (stats[s] || 0), 0)}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</div>
              </div>
            </CardContent>
          </Card>
          {Object.entries(STATUS_CONFIG).map(([status, config]) => {
            const Icon = config.icon;
            const count = stats[status] || 0;
            return (
              <Card
                key={status}
                className={`cursor-pointer transition-all hover:scale-105 ${selectedStatus === status ? 'ring-2 ring-ring' : ''}`}
                onClick={() => { setSelectedStatus(status); setPage(0); }}
                data-testid={`stat-card-${status}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <div className={`w-2 h-2 rounded-full ${config.color}`} />
                  </div>
                  <div className="mt-2">
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{config.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant={selectedStatus === 'all' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => { setSelectedStatus('all'); setPage(0); }}
          className="h-7 text-xs"
        >
          All
        </Button>
        {Object.entries(STATUS_CONFIG).map(([status, config]) => (
          <Button
            key={status}
            variant={selectedStatus === status ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setSelectedStatus(status); setPage(0); }}
            className="h-7 text-xs"
            data-testid={`status-filter-${status}`}
          >
            {config.label}
          </Button>
        ))}
      </div>

      {/* Advanced filters (batch / agent / prompt / date range) */}
      <EvalFilterBar value={filters} onChange={setFilters} />

      {/* Groups */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {jobs.length > 0 ? 'No eval runs match the current filters' : 'No eval runs found'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map(group => {
            const isOpen = expandedGroups[group.groupId];
            const isLoading = loadingGroup[group.groupId];
            const groupJobs = getGroupJobs(group);
            const agents = getGroupAgents(groupJobs);
            const isUngrouped = group.groupId === '_ungrouped';
            const meta = !isUngrouped ? (groupMeta[group.groupId] || {}) : {};
            const displayTitle = meta.group_name || group.groupId;
            const groupComment = meta.comment || '';

            return (
              <Collapsible key={group.groupId} open={Boolean(isOpen)} onOpenChange={() => toggleGroup(group.groupId)}>
                <CollapsibleTrigger asChild>
                  <Card className="cursor-pointer hover:bg-accent/30 transition-colors" data-testid={`group-${group.groupId}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        {/* Expand icon */}
                        <div className="flex-shrink-0">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </div>

                        {/* Group title: display name (or fallback to group_run_id) + edit pencil */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span
                              className="text-sm font-semibold truncate"
                              data-testid={`group-name-${group.groupId}`}
                              title={isUngrouped ? 'Ungrouped Jobs' : `${displayTitle}\n${group.groupId}`}
                            >
                              {isUngrouped ? 'Ungrouped Jobs' : displayTitle}
                            </span>
                            {!isUngrouped && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditGroupModal(group.groupId);
                                  }}
                                  data-testid={`edit-group-${group.groupId}`}
                                  aria-label="Edit group name and comment"
                                  title="Edit group name and comment"
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <a
                                  href={`/evals/group/${group.groupId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0"
                                  data-testid={`open-group-${group.groupId}`}
                                  aria-label="Open group detail in new tab"
                                  title="Open group detail in new tab"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </>
                            )}
                            <Badge variant="secondary" className="text-[9px] font-mono" data-testid={`group-jobs-count-${group.groupId}`}>
                              {group.jobs.length} job{group.jobs.length !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {!isUngrouped && meta.group_name && (
                              <span
                                className="text-[9px] font-mono text-muted-foreground/70 truncate"
                                data-testid={`group-id-sub-${group.groupId}`}
                                title={group.groupId}
                              >
                                {group.groupId}
                              </span>
                            )}
                            {agents.length > 0 && agents.slice(0, 3).map(a => (
                              <Badge key={a} variant="outline" className="text-[9px] font-mono px-1.5 py-0 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400">
                                {a}
                              </Badge>
                            ))}
                            {agents.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">+{agents.length - 3} more</span>
                            )}
                          </div>
                        </div>

                        {/* Status summary */}
                        <GroupStatusSummary jobs={group.jobs} />

                        {/* Average score */}
                        <GroupAvgScore jobs={group.jobs} />

                        {/* Comment (right of jobs/status/score, left of time).
                            Truncated to keep the row compact; full text in the
                            native title tooltip. Hidden when empty. */}
                        {!isUngrouped && groupComment && (
                          <div
                            className="flex items-center gap-1 max-w-[240px] flex-shrink-0 text-[10px] text-muted-foreground italic"
                            data-testid={`group-comment-${group.groupId}`}
                            title={groupComment}
                          >
                            <MessageSquare className="w-3 h-3 flex-shrink-0 opacity-60" />
                            <span className="truncate">{groupComment}</span>
                          </div>
                        )}

                        {/* Created time */}
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatDateTime(group.latestCreated)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="ml-6 mt-1 space-y-2 pb-2">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (<>
                      <GroupAggregateSummary aggregate={groupAggregates[group.groupId]} />
                      <div className="space-y-1">
                      {groupJobs.map(job => (
                        <div
                          key={job.id}
                          onClick={() => navigate(`/evals/${job.id}`)}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-accent/40 cursor-pointer transition-colors text-xs"
                          data-testid={`eval-job-row-${job.id}`}
                        >
                          {/* Problem (or testing-agent instance name) */}
                          <div className="flex-1 min-w-0">
                            {(() => {
                              const isTA = isTestingAgentJob(job);
                              const label = isTA ? getTestingAgentInstanceName(job) : job.problem;
                              const prod = isTA ? getTestingAgentProdJobId(job) : '';
                              return (
                                <>
                                  <div className="font-mono font-medium truncate" data-testid={`job-label-${job.id}`}>
                                    {label || '(unnamed)'}
                                  </div>
                                  {isTA && (
                                    <div
                                      className="text-[10px] font-mono text-blue-700 dark:text-blue-300 truncate"
                                      title={prod ? `prod_job_id: ${prod}` : 'No prod_job_id stamped on this job'}
                                      data-testid={`job-prod-${job.id}`}
                                    >
                                      prod: {prod || '—'}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {(() => {
                                const an = getJobAgentName(job);
                                const mn = getJobModelName(job);
                                return (
                                  <>
                                    {an && (
                                      <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" data-testid={`agent-badge-${job.id}`}>
                                        {an}
                                      </Badge>
                                    )}
                                    {mn && (
                                      <Badge variant="outline" className="text-[9px] font-mono px-1 py-0" data-testid={`model-badge-${job.id}`}>
                                        {mn}
                                      </Badge>
                                    )}
                                  </>
                                );
                              })()}
                              <span className="text-[9px] text-muted-foreground/50 font-mono">{job.id.substring(0, 8)}</span>
                            </div>
                          </div>

                          {/* Status */}
                          <StatusBadge status={job.status} />

                          {/* Cancel (only for active jobs) */}
                          <CancelJobButton
                            jobId={job.id}
                            status={job.status}
                            onCancelled={fetchJobs}
                          />

                          {/* Score */}
                          <ScoreBadges job={job} />

                          {/* Time */}
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 w-24 text-right">
                            {formatDateTime(job.created_at)}
                          </span>

                          <a
                            href={`/evals/${job.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
                            data-testid={`open-job-newtab-${job.id}`}
                            title="Open job in new tab"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ))}
                      </div>
                    </>)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* Pagination — hidden while filters are active (we fetch-all then). */}
      {!loading && !hasActiveFilter && jobs.length >= pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page + 1}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="h-7 text-xs">Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={jobs.length < pageSize} className="h-7 text-xs">Next</Button>
          </div>
        </div>
      )}

      <RunEvalModal
        open={evalModalOpen}
        onClose={() => {
          setEvalModalOpen(false);
          // Drop the deep-link seed so the next manual open starts clean.
          setDeepLinkInitial({ eph: '', agent: '', viewId: '' });
          fetchJobs();
          fetchStats();
          fetchGroupsMeta();
        }}
        initialEph={deepLinkInitial.eph}
        initialAgentName={deepLinkInitial.agent}
        initialViewId={deepLinkInitial.viewId}
      />

      {/* Edit Group modal — rename + comment, optimistic PATCH */}
      <Dialog
        open={editModal.open}
        onOpenChange={(open) => { if (!open && !editModal.saving) closeEditGroupModal(); }}
      >
        <DialogContent className="sm:max-w-md" data-testid="edit-group-dialog">
          <DialogHeader>
            <DialogTitle>Edit eval run group</DialogTitle>
            <DialogDescription>
              Update the display name and comment. The underlying{' '}
              <code className="font-mono text-[11px]">group_run_id</code> never changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-group-name" className="text-xs">Group name</Label>
              <Input
                id="edit-group-name"
                value={editModal.name}
                onChange={(e) => setEditModal(s => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Smoke test — sonnet-4-5"
                disabled={editModal.saving}
                className="mt-1.5"
                data-testid="edit-group-name-input"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="edit-group-comment" className="text-xs">Comment (optional)</Label>
              <Textarea
                id="edit-group-comment"
                value={editModal.comment}
                onChange={(e) => setEditModal(s => ({ ...s, comment: e.target.value }))}
                placeholder="Anything you want to remember about this run…"
                disabled={editModal.saving}
                rows={3}
                className="mt-1.5 text-sm"
                data-testid="edit-group-comment-input"
              />
            </div>
            <div className="text-[10px] text-muted-foreground font-mono break-all" data-testid="edit-group-id-readonly">
              group_run_id: {editModal.groupRunId}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeEditGroupModal}
              disabled={editModal.saving}
              data-testid="edit-group-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitEditGroup}
              disabled={editModal.saving || !(editModal.name || '').trim()}
              data-testid="edit-group-save-btn"
            >
              {editModal.saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
