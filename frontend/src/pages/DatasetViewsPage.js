import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2, RefreshCw, BookMarked, Pencil, Trash2, Play, Database, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { listDatasetViews, updateDatasetView, deleteDatasetView } from '@/services/evalApi';
import { useAuth } from '@/contexts/AuthContext';
import { parseApiError } from '@/lib/errorUtils';

// Type-breakdown badges — match DatasetsPage colour map.
const TYPE_BADGE_COLORS = {
  scratch_bench_phased: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  bug_bench: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  test_report_bench: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  testing_agent_bench: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  wingman_bench: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
};

function TypeBreakdown({ items }) {
  if (!items || items.length === 0) return null;
  const counts = items.reduce((acc, it) => {
    acc[it.dataset_type] = (acc[it.dataset_type] || 0) + 1;
    return acc;
  }, {});
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {Object.entries(counts).map(([type, count]) => (
        <Badge
          key={type}
          variant="outline"
          className={`text-[9px] font-mono px-1.5 py-0 ${TYPE_BADGE_COLORS[type] || ''}`}
        >
          {type} · {count}
        </Badge>
      ))}
    </div>
  );
}

export default function DatasetViewsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentEmail = user?.email || null;

  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchViews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDatasetViews({ limit: 200 });
      setViews(data?.views || []);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to load views'));
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchViews(); }, [fetchViews]);

  const openEdit = (view) => {
    setEditTarget(view);
    setEditName(view.name);
    setEditDescription(view.description || '');
  };

  const closeEdit = () => {
    if (saving) return;
    setEditTarget(null);
    setEditName('');
    setEditDescription('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDatasetView(editTarget.view_id, {
        name: trimmed,
        description: editDescription.trim(),
      });
      setViews(prev => prev.map(v => v.view_id === updated.view_id ? updated : v));
      toast.success('View updated');
      closeEdit();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to update view'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDatasetView(deleteTarget.view_id);
      setViews(prev => prev.filter(v => v.view_id !== deleteTarget.view_id));
      toast.success(`Deleted view "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to delete view'));
    } finally {
      setDeleting(false);
    }
  };

  const isAuthor = (view) => view.created_by_email && view.created_by_email === currentEmail;

  return (
    <div className="space-y-6" data-testid="dataset-views-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dataset Views</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saved hand-picked dataset selections. Shared — anyone can load; only the author can edit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchViews} variant="outline" size="sm" data-testid="views-refresh-btn">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : views.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookMarked className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No saved views yet</p>
            <p className="text-xs text-muted-foreground mt-2">
              Go to{' '}
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => navigate('/datasets')}
              >
                Datasets
              </button>
              {' '}— select rows and click "Save as view".
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {views.map(view => (
            <Card
              key={view.view_id}
              className="hover:bg-accent/30 transition-colors"
              data-testid={`view-row-${view.view_id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <BookMarked className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold" data-testid={`view-name-${view.view_id}`}>
                        {view.name}
                      </span>
                      <Badge variant="secondary" className="text-[9px] font-mono">
                        {view.items?.length || 0} item{view.items?.length === 1 ? '' : 's'}
                      </Badge>
                      <TypeBreakdown items={view.items} />
                    </div>
                    {view.description && (
                      <p className="text-xs text-muted-foreground mt-1">{view.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/80 font-mono">
                      <span>by {view.created_by_email || 'unknown'}</span>
                      <span>·</span>
                      <span>
                        {view.updated_at
                          ? `updated ${formatDistanceToNow(new Date(view.updated_at), { addSuffix: true })}`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => navigate(`/datasets?view=${view.view_id}`)}
                      title="Open in Datasets"
                      data-testid={`view-open-datasets-${view.view_id}`}
                    >
                      <Database className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-emerald-600"
                      onClick={() => navigate(`/evals?run=1&view=${view.view_id}`)}
                      title="Run in Eval"
                      data-testid={`view-run-eval-${view.view_id}`}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                    {isAuthor(view) && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(view)}
                          title="Edit name / description"
                          data-testid={`view-edit-${view.view_id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setDeleteTarget(view)}
                          title="Delete view"
                          data-testid={`view-delete-${view.view_id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) closeEdit(); }}>
        <DialogContent className="sm:max-w-md" data-testid="view-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit view</DialogTitle>
            <DialogDescription>
              Rename or update the description. To edit the item list, go to the
              Datasets page, load this view, change your selection, and save as a new view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-view-name" className="text-xs">Name</Label>
              <Input
                id="edit-view-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={saving}
                className="mt-1.5"
                data-testid="view-edit-name-input"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="edit-view-description" className="text-xs">Description</Label>
              <Textarea
                id="edit-view-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                disabled={saving}
                rows={3}
                className="mt-1.5 text-sm"
                data-testid="view-edit-description-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeEdit} disabled={saving} data-testid="view-edit-cancel-btn">
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editName.trim()} data-testid="view-edit-save-btn">
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="view-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete view?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the view "{deleteTarget?.name}" for everyone.
              The datasets themselves are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="view-delete-confirm-btn"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
