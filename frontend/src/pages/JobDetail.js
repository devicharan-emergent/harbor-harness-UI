import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEvalJob, cancelEvalJob, getDatasetForProblem, updateBreakpoint } from '@/services/evalApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { ArrowLeft, Copy, XCircle, Loader2, CheckCircle, Clock, AlertTriangle, Cpu, ActivitySquare, Ban, FileText, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns';

const STATUS_ICONS = {
  queued: Clock,
  generating: Cpu,
  running: ActivitySquare,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: Ban,
};

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [nextPollIn, setNextPollIn] = useState(10);
  const [dataset, setDataset] = useState(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [showFullPS, setShowFullPS] = useState(false);
  const [showTests, setShowTests] = useState(false);

  const isActive = job && ['queued', 'generating', 'running'].includes(job.status);

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

    const pollInterval = setInterval(() => {
      fetchJob();
      setNextPollIn(10);
    }, 10000);

    const countdownInterval = setInterval(() => {
      setNextPollIn(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
    };
  }, [isActive, id]);

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
  const phaseResults = job.phase_results || [];

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
            <Badge variant="outline" className="font-mono text-xs">
              <StatusIcon className="w-3 h-3 mr-1" />
              {job.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground ml-[52px]">
            Problem: <span className="font-mono">{job.problem}</span>
          </p>
          {job.config?.experiments?.agent_name && (
            <div className="flex items-center gap-1.5 ml-[52px] mt-1">
              <Badge variant="outline" className="text-[10px] font-mono bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" data-testid="job-agent-badge">
                {job.config.experiments.agent_name}
              </Badge>
              {job.config?.experiments?.model_name && (
                <Badge variant="outline" className="text-[10px] font-mono" data-testid="job-model-badge">
                  {job.config.experiments.model_name}
                </Badge>
              )}
            </div>
          )}
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
          <Button variant="outline" size="sm" onClick={handleCopyId} className="h-8">
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy ID
          </Button>
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
                    const items = [];
                    job.progress.history.forEach((step, idx) => {
                      // Insert phase divider before every harbor_running
                      if (step.phase === 'harbor_running') {
                        phaseNum++;
                        items.push(
                          <div key={`phase-${phaseNum}`} className="flex items-center gap-2 py-1.5">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">Phase {phaseNum}</span>
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
                            {(idx < job.progress.history.length - 1 || (isActive && job.progress.phase)) && (
                              <div className="w-px h-8 bg-border mt-1" />
                            )}
                          </div>
                          <div className="flex-1 pb-3">
                            <p className="text-sm font-medium">{step.phase}</p>
                            {step.duration_seconds !== undefined && (
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {step.duration_seconds < 60
                                  ? `${step.duration_seconds.toFixed(1)}s`
                                  : `${Math.floor(step.duration_seconds / 60)}m ${Math.round(step.duration_seconds % 60)}s`
                                }
                              </p>
                            )}
                            {step.duration && !step.duration_seconds && (
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
                        <p className="text-sm font-medium">{job.progress.phase === 'phase_breakpoint' ? 'Breakpoint — Paused for manual testing' : job.progress.phase}</p>
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
                                {test.kernel_session_id && (
                                  <a
                                    href={`https://dashboard.onkernel.com/browsers/${test.kernel_session_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400 font-mono underline"
                                  >
                                    Watch Replay
                                  </a>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}

                      {phaseIdx < phaseResults.length - 1 && <Separator />}
                    </div>
                  );
                })}
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
            if (!previewUrl && !temporalUrl && !cortexJobId) return null;
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
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Cortex:</span>
                      <span className="font-mono text-[10px]">{cortexJobId}</span>
                    </div>
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
                <div>
                  <dt className="text-muted-foreground">Job ID</dt>
                  <dd className="font-mono mt-0.5 text-[10px] break-all">{job.id}</dd>
                </div>
                <Separator />
                <div>
                  <dt className="text-muted-foreground">Problem</dt>
                  <dd className="font-mono mt-0.5">{job.problem}</dd>
                </div>
                <Separator />
                {job.config?.experiments?.agent_name && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Agent</dt>
                      <dd className="font-mono mt-0.5">{job.config.experiments.agent_name}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.config?.experiments?.model_name && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="font-mono mt-0.5">{job.config.experiments.model_name}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.user_id && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">User ID</dt>
                      <dd className="font-mono mt-0.5">{job.user_id}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.group_id && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Group ID</dt>
                      <dd className="font-mono mt-0.5 text-[10px] break-all">{job.group_id}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.k8s_job_name && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">K8s Job</dt>
                      <dd className="font-mono mt-0.5 text-[10px]">{job.k8s_job_name}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.cortex_job_id && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Cortex Job ID</dt>
                      <dd className="font-mono mt-0.5 text-[10px]">{job.cortex_job_id}</dd>
                    </div>
                    <Separator />
                  </>
                )}
                {job.eval_metrics?.kernel_session_id && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Session</dt>
                      <dd className="font-mono mt-0.5 text-[10px]">{job.eval_metrics.kernel_session_id}</dd>
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
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="mt-0.5">{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</dd>
                </div>
                {job.started_at && (
                  <>
                    <Separator />
                    <div>
                      <dt className="text-muted-foreground">Started</dt>
                      <dd className="mt-0.5">{formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}</dd>
                    </div>
                  </>
                )}
                {job.updated_at && (
                  <>
                    <Separator />
                    <div>
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd className="mt-0.5">{formatDistanceToNow(new Date(job.updated_at), { addSuffix: true })}</dd>
                    </div>
                  </>
                )}
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
              </dl>
            </CardContent>
          </Card>

          {/* Config Info */}
          {job.config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Config</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-[10px] font-mono bg-muted/50 p-3 rounded-lg overflow-auto max-h-[200px]">
                  {JSON.stringify(job.config, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Submission Config */}
          {job.config && (
            <Card data-testid="submission-config-card">
              <CardHeader>
                <CardTitle className="text-sm">Submission Config</CardTitle>
              </CardHeader>
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
            </Card>
          )}

          {/* Phase Results */}
          {job.phase_results && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Phase Results</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-[10px] font-mono bg-muted/50 p-3 rounded-lg overflow-auto max-h-[200px]">
                  {JSON.stringify(job.phase_results, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
