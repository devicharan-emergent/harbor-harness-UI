import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
import { Label } from '@/components/ui/label';
import {
  Loader2,
  Plus,
  RefreshCw,
  MoreVertical,
  Pencil,
  Trash2,
  Play,
  CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  listScheduledBatches,
  updateScheduledBatch,
  deleteScheduledBatch,
  triggerScheduledBatch,
} from '@/services/schedulesApi';
import { parseApiError } from '@/lib/errorUtils';
import { EmptyState } from '@/components/agents/EmptyState';

// Human-readable cron
export function humanizeCron(expr) {
  if (!expr || typeof expr !== 'string') return expr || '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (expr.trim() === '0 * * * *') return 'Every hour';
  if (dom === '*' && mon === '*' && dow === '*' && !hour.includes('*') && !min.includes('*')) {
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} IST`;
  }
  if (dom === '*' && mon === '*' && /^[0-6]$/.test(dow) && !hour.includes('*') && !min.includes('*')) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[parseInt(dow, 10)]} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} IST`;
  }
  if (dom === '*' && mon === '*' && dow === '1-5' && !hour.includes('*') && !min.includes('*')) {
    return `Weekdays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} IST`;
  }
  return `cron: ${expr} IST`;
}

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

export default function SchedulesList() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [triggeringId, setTriggeringId] = useState(null);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listScheduledBatches(enabledOnly);
      setBatches(data.batches || []);
    } catch (error) {
      console.error('Failed to fetch scheduled batches:', error);
      toast.error(parseApiError(error, 'Failed to load scheduled batches'));
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [enabledOnly]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const handleToggleEnabled = async (batch, nextValue) => {
    setTogglingId(batch.id);
    // optimistic update
    setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, enabled: nextValue } : b)));
    try {
      await updateScheduledBatch(batch.id, { enabled: nextValue });
      toast.success(`Schedule ${nextValue ? 'enabled' : 'disabled'}`);
    } catch (error) {
      // revert on error
      setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, enabled: !nextValue } : b)));
      toast.error(parseApiError(error, 'Failed to update schedule'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleTrigger = async (batch) => {
    setTriggeringId(batch.id);
    try {
      const result = await triggerScheduledBatch(batch.id);
      const count = result?.eval_job_ids?.length || 0;
      toast.success(`Triggered: ${count} eval job${count === 1 ? '' : 's'} fired`);
      fetchBatches();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to trigger schedule'));
    } finally {
      setTriggeringId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteScheduledBatch(deleteTarget.id);
      toast.success(`Deleted schedule: ${deleteTarget.schedule_tag}`);
      setDeleteTarget(null);
      fetchBatches();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to delete schedule'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="schedules-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Problems that run automatically on a cron schedule
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchBatches} variant="outline" size="sm" data-testid="schedules-refresh-btn">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => navigate('/schedules/new')} size="sm" data-testid="new-schedule-btn">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Schedule
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="enabled-only"
            checked={enabledOnly}
            onCheckedChange={setEnabledOnly}
            data-testid="schedules-enabled-filter"
          />
          <Label htmlFor="enabled-only" className="text-xs cursor-pointer">
            Show enabled only
          </Label>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : batches.length === 0 ? (
            <div className="py-4">
              <EmptyState
                icon={CalendarClock}
                title="No scheduled batches yet"
                body="Scheduled batches run sets of problems automatically on a cron schedule. Click New Schedule to create one."
                primaryAction={{
                  label: 'New Schedule',
                  onClick: () => navigate('/schedules/new'),
                  testId: 'empty-new-schedule-btn',
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Tag</TableHead>
                  <TableHead className="text-xs">Cron</TableHead>
                  <TableHead className="text-xs">Problems</TableHead>
                  <TableHead className="text-xs">Next Run (IST)</TableHead>
                  <TableHead className="text-xs">Last Run (IST)</TableHead>
                  <TableHead className="text-xs">Enabled</TableHead>
                  <TableHead className="text-xs w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow
                    key={batch.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/schedules/${batch.id}`)}
                    data-testid={`schedule-row-${batch.id}`}
                  >
                    <TableCell className="max-w-[240px]">
                      <div className="font-mono text-xs font-medium truncate" data-testid={`schedule-tag-${batch.id}`}>
                        {batch.schedule_tag}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 truncate">
                        {batch.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs">{humanizeCron(batch.cron_expression)}</span>
                        <code className="text-[10px] text-muted-foreground/70 font-mono">
                          {batch.cron_expression}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {(batch.problem_ids || []).length} problem
                        {(batch.problem_ids || []).length === 1 ? '' : 's'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeOrDash(batch.next_run_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeOrDash(batch.last_run_at)}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={!!batch.enabled}
                        disabled={togglingId === batch.id}
                        onCheckedChange={(v) => handleToggleEnabled(batch, v)}
                        data-testid={`toggle-enabled-${batch.id}`}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            data-testid={`schedule-actions-${batch.id}`}
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => navigate(`/schedules/${batch.id}/edit`)}
                            data-testid={`edit-schedule-${batch.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleTrigger(batch)}
                            disabled={triggeringId === batch.id}
                            data-testid={`trigger-schedule-${batch.id}`}
                          >
                            {triggeringId === batch.id ? (
                              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5 mr-2" />
                            )}
                            Trigger Now
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(batch)}
                            className="text-destructive focus:text-destructive"
                            data-testid={`delete-schedule-${batch.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="delete-schedule-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-mono font-medium">{deleteTarget?.schedule_tag}</span>? This will permanently
              remove the schedule. Previously fired eval jobs remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="cancel-delete-schedule">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-schedule"
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
