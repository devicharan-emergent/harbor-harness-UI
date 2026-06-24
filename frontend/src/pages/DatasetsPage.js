import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  listDatasets,
  listDatasetsByType,
  deleteDataset,
  getDatasetInstance,
  exportDatasetsCsv,
  triggerBlobDownload,
} from '@/services/evalApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Plus, Pencil, Trash2, RefreshCw, Database, X, ChevronLeft, ChevronRight, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { DatasetEditorModal } from '@/components/evals/DatasetEditorModal';
import { DatasetPreviewModal } from '@/components/evals/DatasetPreviewModal';
import { ImportCsvDialog, IMPORT_DATASET_TYPES } from '@/components/evals/ImportCsvDialog';
import { parseApiError } from '@/lib/errorUtils';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'wingman_bench', label: 'Wingman Bench' },
];

const TYPE_BADGE_COLORS = {
  scratch_bench_phased: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  bug_bench: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  test_report_bench: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  testing_agent_bench: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  wingman_bench: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
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

  // Detail preview (modal)
  const [previewDataset, setPreviewDataset] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // CSV import dialog
  const [importOpen, setImportOpen] = useState(false);

  // Row selection (keyed by `${dataset_type}/${instance_id}` to keep cross-type
  // selection unambiguous; export sends instance_ids per dataset_type).
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [exporting, setExporting] = useState(false);

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
    // Open modal immediately with whatever we have; fill in async details if missing.
    setPreviewOpen(true);
    if (ds.problem_statement) {
      setPreviewDataset(ds);
      return;
    }
    setPreviewDataset(null);
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

  const closePreview = () => {
    setPreviewOpen(false);
    // Clear after the dialog animates out so we don't flash a different dataset.
    setTimeout(() => setPreviewDataset(null), 200);
  };

  const truncateText = (text, maxLen = 120) => {
    if (!text) return '';
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen) + '...';
  };

  // Selection helpers (keys = `${dataset_type}/${instance_id}`)
  const keyOf = (ds) => `${ds.dataset_type}/${ds.instance_id}`;

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

  const allVisibleSelected = filteredDatasets.length > 0 && filteredDatasets.every(ds => selectedKeys.has(keyOf(ds)));
  const someVisibleSelected = filteredDatasets.some(ds => selectedKeys.has(keyOf(ds))) && !allVisibleSelected;

  const toggleRow = (ds) => {
    const k = keyOf(ds);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredDatasets.forEach(ds => next.delete(keyOf(ds)));
      } else {
        filteredDatasets.forEach(ds => next.add(keyOf(ds)));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  // Selected rows grouped by dataset_type (export endpoint is per-type).
  const selectedByType = useMemo(() => {
    const byType = {};
    datasets.forEach(ds => {
      const k = keyOf(ds);
      if (selectedKeys.has(k)) {
        (byType[ds.dataset_type] = byType[ds.dataset_type] || []).push(ds.instance_id);
      }
    });
    return byType;
  }, [datasets, selectedKeys]);

  const selectedCount = selectedKeys.size;

  const handleExport = async () => {
    const types = Object.keys(selectedByType);
    if (types.length === 0) {
      toast.error('Select at least one row to export');
      return;
    }
    setExporting(true);
    try {
      // One CSV per dataset_type — keeps the per-type column shape clean.
      for (const t of types) {
        const { blob, filename } = await exportDatasetsCsv(t, selectedByType[t]);
        triggerBlobDownload(blob, filename);
      }
      const total = Object.values(selectedByType).reduce((s, arr) => s + arr.length, 0);
      toast.success(
        types.length === 1
          ? `Exported ${total} row(s) → ${types[0]}.csv`
          : `Exported ${total} row(s) across ${types.length} type(s)`,
      );
    } catch (err) {
      toast.error(parseApiError(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const handleImported = (importedType) => {
    // Auto-switch the type filter so the user immediately sees their new rows.
    setTypeFilter(importedType);
    setPage(0);
    clearSelection();
    fetchDatasets();
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
          <Button
            onClick={() => setImportOpen(true)}
            variant="outline"
            size="sm"
            data-testid="datasets-import-csv-btn"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Import CSV
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={selectedCount === 0 ? 0 : -1}>
                  <Button
                    onClick={handleExport}
                    variant="outline"
                    size="sm"
                    disabled={selectedCount === 0 || exporting}
                    data-testid="datasets-export-csv-btn"
                  >
                    {exporting ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Export {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {selectedCount === 0 ? 'Select one or more rows to export' : `Export ${selectedCount} selected row(s) as CSV`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button onClick={() => { setEditingDataset(null); setEditorOpen(true); }} size="sm" data-testid="new-dataset-btn">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Dataset
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
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
        {selectedCount > 0 && (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground border border-border/60 rounded-md px-2.5 py-1.5 bg-muted/30"
            data-testid="datasets-selection-summary"
          >
            <span className="font-mono">{selectedCount}</span> selected
            <button
              onClick={clearSelection}
              className="text-[10px] underline underline-offset-2 hover:text-foreground"
              data-testid="datasets-clear-selection-btn"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {/* Content: Table */}
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
                    <TableHead className="w-[36px]">
                      <Checkbox
                        checked={allVisibleSelected || (someVisibleSelected ? 'indeterminate' : false)}
                        onCheckedChange={toggleAllVisible}
                        aria-label="Select all visible datasets"
                        data-testid="datasets-select-all"
                      />
                    </TableHead>
                    <TableHead className="text-xs">Name / Instance</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Version</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDatasets.map(ds => {
                    const checked = selectedKeys.has(keyOf(ds));
                    return (
                    <TableRow
                      key={ds.id || ds.name}
                      className={`cursor-pointer hover:bg-accent/50 transition-colors ${checked ? 'bg-accent/30' : ''}`}
                      onClick={() => handlePreview(ds)}
                      data-testid={`dataset-row-${ds.instance_id || ds.id}`}
                    >
                      <TableCell className="w-[36px]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleRow(ds)}
                          aria-label={`Select ${ds.instance_id}`}
                          data-testid={`dataset-select-${ds.instance_id || ds.id}`}
                        />
                      </TableCell>
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
                    );
                  })}
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

      {/* Preview Modal */}
      <DatasetPreviewModal
        open={previewOpen}
        onClose={closePreview}
        dataset={previewDataset}
        loading={loadingPreview}
      />

      {/* Editor Modal */}
      <DatasetEditorModal
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingDataset(null); }}
        onSaved={() => { setEditorOpen(false); setEditingDataset(null); fetchDatasets(); }}
        dataset={editingDataset}
      />

      {/* CSV Import Dialog */}
      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        defaultType={typeFilter}
        onImported={handleImported}
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
