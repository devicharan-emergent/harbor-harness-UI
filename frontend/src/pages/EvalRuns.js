import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEvalStats, listEvalJobs, listGroupJobs, getEvalAggregate } from '@/services/evalApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Clock, Cpu, CheckCircle, XCircle, Ban, ActivitySquare, RefreshCw, Plus, ChevronDown, ChevronRight, Layers, ExternalLink, Timer } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import { RunEvalModal } from '@/components/evals/RunEvalModal';
import { EvalFilterBar, EMPTY_FILTERS, buildJobFilter } from '@/components/evals/EvalFilterBar';

const STATUS_CONFIG = {
  queued: { color: 'bg-amber-500', icon: Clock, label: 'Queued' },
  generating: { color: 'bg-violet-500', icon: Cpu, label: 'Generating' },
  running: { color: 'bg-blue-500', icon: ActivitySquare, label: 'Running' },
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
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const [evalModalOpen, setEvalModalOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Expanded group detail jobs (from group API)
  const [groupDetailJobs, setGroupDetailJobs] = useState({});
  const [loadingGroup, setLoadingGroup] = useState({});
  const [groupAggregates, setGroupAggregates] = useState({});

  const fetchStats = useCallback(async () => {
    try {
      const data = await getEvalStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: pageSize, offset: page * pageSize };
      if (selectedStatus !== 'all') params.status = selectedStatus;
      const data = await listEvalJobs(params);
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, page]);

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Group jobs by group_run_id (falling back to legacy group_id for compatibility)
  // Filter first — groups with zero matching jobs disappear entirely.
  const filterPredicate = useMemo(() => buildJobFilter(filters), [filters]);

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

  // Unique agents in a group
  const getGroupAgents = (jobsList) => {
    const agents = new Set();
    for (const j of jobsList) {
      const name = j.config?.experiments?.agent_name;
      if (name) agents.add(name);
    }
    return [...agents];
  };

  return (
    <div className="space-y-6" data-testid="eval-runs-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Eval Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">Evaluation jobs grouped by batch ID</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { fetchJobs(); fetchStats(); }} variant="outline" size="sm" data-testid="refresh-evals-btn">
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
        {Object.keys(STATUS_CONFIG).map(status => (
          <Button
            key={status}
            variant={selectedStatus === status ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setSelectedStatus(status); setPage(0); }}
            className="h-7 text-xs capitalize"
          >
            {status}
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

                        {/* Group ID */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="font-mono text-sm font-semibold truncate" data-testid={`group-id-${group.groupId}`}>
                              {isUngrouped ? 'Ungrouped Jobs' : group.groupId}
                            </span>
                            <Badge variant="secondary" className="text-[9px] font-mono">{group.jobs.length} job{group.jobs.length !== 1 ? 's' : ''}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
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

                        {/* Created time */}
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(group.latestCreated), { addSuffix: true })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="ml-6 mt-1 space-y-1 pb-2">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (<>
                      <GroupAggregateSummary aggregate={groupAggregates[group.groupId]} />
                      {groupJobs.map(job => (
                        <div
                          key={job.id}
                          onClick={() => navigate(`/evals/${job.id}`)}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-accent/40 cursor-pointer transition-colors text-xs"
                          data-testid={`eval-job-row-${job.id}`}
                        >
                          {/* Problem */}
                          <div className="flex-1 min-w-0">
                            <div className="font-mono font-medium truncate">{job.problem}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {job.config?.experiments?.agent_name && (
                                <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" data-testid={`agent-badge-${job.id}`}>
                                  {job.config.experiments.agent_name}
                                </Badge>
                              )}
                              {job.config?.experiments?.model_name && (
                                <Badge variant="outline" className="text-[9px] font-mono px-1 py-0" data-testid={`model-badge-${job.id}`}>
                                  {job.config.experiments.model_name}
                                </Badge>
                              )}
                              <span className="text-[9px] text-muted-foreground/50 font-mono">{job.id.substring(0, 8)}</span>
                            </div>
                          </div>

                          {/* Status */}
                          <StatusBadge status={job.status} />

                          {/* Score */}
                          <ScoreBadges job={job} />

                          {/* Time */}
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 w-24 text-right">
                            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                          </span>

                          <ExternalLink className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                        </div>
                      ))}
                    </>)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && jobs.length >= pageSize && (
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
        onClose={() => { setEvalModalOpen(false); fetchJobs(); fetchStats(); }}
      />
    </div>
  );
}
