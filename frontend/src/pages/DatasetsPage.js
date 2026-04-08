import { useEffect, useState, useCallback } from 'react';
import { listDatasets, listDatasetsByType, deleteDataset, getDatasetInstance } from '@/services/evalApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Plus, Pencil, Trash2, FileText, RefreshCw, Database, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { DatasetEditorModal } from '@/components/evals/DatasetEditorModal';
import { parseApiError } from '@/lib/errorUtils';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
];

const TYPE_BADGE_COLORS = {
  scratch_bench_phased: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  bug_bench: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  test_report_bench: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
};

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Detail preview
  const [previewDataset, setPreviewDataset] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      if (typeFilter === 'all') {
        data = await listDatasets({ limit: pageSize, offset: page * pageSize });
      } else {
        data = await listDatasetsByType(typeFilter, { limit: pageSize, offset: page * pageSize });
      }
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error('Failed to fetch datasets:', error);
      toast.error('Failed to load datasets');
      setDatasets([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const filteredDatasets = datasets.filter(ds => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ds.name || '').toLowerCase().includes(q) ||
      (ds.instance_id || '').toLowerCase().includes(q) ||
      (ds.description || '').toLowerCase().includes(q) ||
      (ds.problem_statement || '').toLowerCase().includes(q)
    );
  });

  const handleEdit = async (ds) => {
    // Fetch full dataset details if needed
    if (!ds.problem_statement && ds.dataset_type && ds.instance_id) {
      setLoadingPreview(true);
      try {
        const full = await getDatasetInstance(ds.dataset_type, ds.instance_id);
        setEditingDataset(full || ds);
      } catch {
        setEditingDataset(ds);
      } finally {
        setLoadingPreview(false);
      }
    } else {
      setEditingDataset(ds);
    }
    setEditorOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDataset(deleteTarget.id);
      toast.success(`Deleted dataset: ${deleteTarget.name || deleteTarget.instance_id}`);
      setDeleteTarget(null);
      fetchDatasets();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to delete dataset'));
    } finally {
      setDeleting(false);
    }
  };

  const handlePreview = async (ds) => {
    if (previewDataset?.id === ds.id) {
      setPreviewDataset(null);
      return;
    }
    if (ds.problem_statement) {
      setPreviewDataset(ds);
      return;
    }
    setLoadingPreview(true);
    try {
      const full = await getDatasetInstance(ds.dataset_type, ds.instance_id);
      setPreviewDataset(full || ds);
    } catch {
      setPreviewDataset(ds);
    } finally {
      setLoadingPreview(false);
    }
  };

  const truncateText = (text, maxLen = 120) => {
    if (!text) return '';
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen) + '...';
  };

  return (
    <div className="space-y-6" data-testid="datasets-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Datasets</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage evaluation problem statements and datasets</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchDatasets} variant="outline" size="sm" data-testid="datasets-refresh-btn">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => { setEditingDataset(null); setEditorOpen(true); }} size="sm" data-testid="new-dataset-btn">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Dataset
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[220px]" data-testid="datasets-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATASET_TYPES.map(dt => (
              <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search datasets..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 font-mono text-sm"
            data-testid="datasets-search-input"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content: Table + Optional Preview */}
      <div className={`grid gap-4 ${previewDataset ? 'grid-cols-1 lg:grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>
        {/* Table */}
        <Card>
          <CardContent className="pt-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredDatasets.length === 0 ? (
              <div className="text-center py-16">
                <Database className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No datasets found</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => { setEditingDataset(null); setEditorOpen(true); }}
                  data-testid="empty-new-dataset-btn"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Create your first dataset
                </Button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name / Instance</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Version</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDatasets.map(ds => (
                      <TableRow
                        key={ds.id || ds.name}
                        className={`cursor-pointer hover:bg-accent/50 transition-colors ${previewDataset?.id === ds.id ? 'bg-accent/30' : ''}`}
                        onClick={() => handlePreview(ds)}
                        data-testid={`dataset-row-${ds.instance_id || ds.id}`}
                      >
                        <TableCell className="max-w-[300px]">
                          <div className="font-mono text-xs font-medium truncate">{ds.name || `${ds.dataset_type}/${ds.instance_id}`}</div>
                          <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{ds.id}</div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-mono ${TYPE_BADGE_COLORS[ds.dataset_type] || ''}`}
                          >
                            {ds.dataset_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono">v{ds.version ?? '—'}</span>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <span className="text-xs text-muted-foreground truncate block">
                            {truncateText(ds.description, 80) || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => handleEdit(ds)}
                                    data-testid={`edit-dataset-${ds.instance_id || ds.id}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteTarget(ds)}
                                    data-testid={`delete-dataset-${ds.instance_id || ds.id}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredDatasets.length} dataset{filteredDatasets.length !== 1 ? 's' : ''} (Page {page + 1})
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="h-7 text-xs"
                      data-testid="datasets-prev-page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={datasets.length < pageSize}
                      className="h-7 text-xs"
                      data-testid="datasets-next-page"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Preview Panel */}
        {previewDataset && (
          <Card className="h-fit lg:sticky lg:top-6">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Preview
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setPreviewDataset(null)}
                  data-testid="close-preview-btn"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-3 pr-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Name</p>
                    <p className="font-mono text-xs font-medium mt-0.5">{previewDataset.name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Type</p>
                    <Badge variant="outline" className={`text-[10px] font-mono mt-0.5 ${TYPE_BADGE_COLORS[previewDataset.dataset_type] || ''}`}>
                      {previewDataset.dataset_type}
                    </Badge>
                  </div>
                  {previewDataset.description && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Description</p>
                      <p className="text-xs mt-0.5">{previewDataset.description}</p>
                    </div>
                  )}
                  <Separator />
                  {previewDataset.problem_statement ? (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Problem Statement</p>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed mt-1 max-h-[200px] overflow-y-auto" data-testid="preview-problem-statement">
                        {previewDataset.problem_statement}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No problem statement</p>
                  )}
                  {previewDataset.natural_language_tests && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Test Cases</p>
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/60 leading-relaxed mt-1 max-h-[150px] overflow-y-auto">
                          {previewDataset.natural_language_tests}
                        </pre>
                      </div>
                    </>
                  )}
                  {previewDataset.tags?.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Tags</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {previewDataset.tags.map(tag => (
                            <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Editor Modal */}
      <DatasetEditorModal
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingDataset(null); }}
        onSaved={() => { setEditorOpen(false); setEditingDataset(null); fetchDatasets(); }}
        dataset={editingDataset}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="delete-dataset-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-mono font-medium">{deleteTarget?.name || deleteTarget?.instance_id}</span>? This will soft-delete the dataset and mark it as inactive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="cancel-delete-btn">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-btn"
            >
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
