import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
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
  Rocket,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  getScheduledBatch,
  updateScheduledBatch,
  deleteScheduledBatch,
  triggerScheduledBatch,
} from '@/services/schedulesApi';
import { parseApiError } from '@/lib/errorUtils';
import { humanizeCron } from './SchedulesList';

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

export default function ScheduleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  // Poll every 30 seconds for new fired jobs
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBatch({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchBatch]);

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
      toast.success(`Deleted schedule: ${batch.name}`);
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

  const jobIdsReversed = [...(batch.eval_job_ids || [])].reverse();

  return (
    <div className="space-y-6" data-testid="schedule-detail-page">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/schedules')} data-testid="detail-back-btn">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold font-mono" data-testid="detail-name">
              {batch.name}
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
          <div className="flex items-center gap-2 mt-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="detail-schedule">
              {humanizeCron(batch.cron_expression)}
            </p>
            <Badge variant="outline" className="font-mono text-[10px]">
              {batch.cron_expression}
            </Badge>
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
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

          {/* Fired Jobs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Rocket className="w-4 h-4" />
                Fired Jobs
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {jobIdsReversed.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {jobIdsReversed.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-4 text-center">
                  This batch hasn't fired yet.
                </p>
              ) : (
                <div className="space-y-1.5" data-testid="detail-fired-jobs-list">
                  {jobIdsReversed.map((jid, idx) => (
                    <div
                      key={jid}
                      onClick={() => navigate(`/evals/${jid}`)}
                      className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent cursor-pointer transition-colors border"
                      data-testid={`fired-job-${jid}`}
                    >
                      <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground w-8 text-center">
                        #{jobIdsReversed.length - idx}
                      </span>
                      <span className="font-mono text-xs flex-1 truncate">
                        {jid.substring(0, 8)}
                        <span className="text-muted-foreground">...{jid.substring(Math.max(8, jid.length - 4))}</span>
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    </div>
                  ))}
                </div>
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
                  Last Run
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
                  Next Run
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

          {/* Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total jobs fired</span>
                <span className="text-sm font-mono font-semibold" data-testid="stats-jobs-fired">
                  {(batch.eval_job_ids || []).length}
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
              <span className="font-mono font-medium">{batch.name}</span>? This will permanently remove
              the schedule. Previously fired eval jobs remain unchanged.
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
