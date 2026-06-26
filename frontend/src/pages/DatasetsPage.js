import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listDatasets,
  listDatasetsByType,
  deleteDataset,
  getDatasetInstance,
  exportDatasetsCSV,
  getDatasetView,
  updateDatasetView,
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
import { Loader2, Search, Plus, Pencil, Trash2, RefreshCw, Database, X, ChevronLeft, ChevronRight, Upload, Download, BookMarked, Save } from 'lucide-react';
import { toast } from 'sonner';
import { DatasetEditorModal } from '@/components/evals/DatasetEditorModal';
import { DatasetPreviewModal } from '@/components/evals/DatasetPreviewModal';
import { ImportDatasetsModal } from '@/components/evals/ImportDatasetsModal';
import { SaveDatasetViewDialog } from '@/components/datasets/SaveDatasetViewDialog';
import { DatasetViewsDropdown } from '@/components/datasets/DatasetViewsDropdown';
import { AddItemsToViewModal } from '@/components/datasets/AddItemsToViewModal';
import { parseApiError } from '@/lib/errorUtils';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
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
  // Bulk delete state — driven by `selectedRows`. `bulkDeleteOpen` opens
  // a confirmation AlertDialog; deletion fires deleteDataset in parallel
  // for every selected row and surfaces a single summary toast.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // Dataset views (saved selections). When `activeView` is set:
  //  • the table is narrowed to ONLY items in the view (client-side filter)
  //  • the view's items are pre-selected so multi-row actions still work
  //  • per-row "Remove from view" + a toolbar "Add items" button manage
  //    membership; no edit-mode toggle, no bulk re-selection flow.
  const [activeView, setActiveView] = useState(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [addItemsOpen, setAddItemsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      // When narrowing to a loaded view's items, widen the fetch window
      // so every item in the view actually shows up (the harness caps
      // limit=200). Otherwise use normal pagination.
      const narrowToView = !!activeView;
      const limit = narrowToView ? 200 : pageSize;
      const offset = narrowToView ? 0 : page * pageSize;
      if (narrowToView || typeFilter === 'all') {
        data = await listDatasets({ limit, offset });
      } else {
        data = await listDatasetsByType(typeFilter, { limit, offset });
      }
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error('Failed to fetch datasets:', error);
      toast.error('Failed to load datasets');
      setDatasets([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page, activeView]);

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

  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) return;
    setBulkDeleting(true);
    // Fire deletes in parallel. We collect successes/failures so the
    // user gets a single accurate toast even if a subset 404s (e.g. a
    // row that was already removed by someone else).
    const results = await Promise.allSettled(
      selectedRows.map((ds) => deleteDataset(ds.id)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    const succeeded = results.length - failed.length;
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (failed.length === 0) {
      toast.success(`Deleted ${succeeded} dataset${succeeded === 1 ? '' : 's'}`);
    } else if (succeeded === 0) {
      toast.error(`Failed to delete any of the ${failed.length} selected rows`);
    } else {
      toast.warning(`Deleted ${succeeded}, failed ${failed.length}`);
    }
    // Clear selection + refresh table either way.
    setSelectedKeys(new Set());
    fetchDatasets();
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
  const keyOf = (ds) => `${ds.dataset_type}/${ds.instance_id || ds.id}`;

  // Active-view key set for fast lookup. `null` when no view is loaded.
  // When a view IS loaded we narrow the table to ONLY those items — the
  // page becomes the canonical "view editor" UI. Add/remove is per-row +
  // a toolbar "Add items" modal that searches the full dataset catalog.
  const activeViewKeys = useMemo(() => {
    if (!activeView?.items) return null;
    return new Set(activeView.items.map(it => `${it.dataset_type}/${it.instance_id}`));
  }, [activeView]);

  const filteredDatasets = datasets.filter(ds => {
    // Narrow to view items first — drops everything not in the view.
    if (activeViewKeys && !activeViewKeys.has(keyOf(ds))) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ds.name || '').toLowerCase().includes(q) ||
      (ds.instance_id || '').toLowerCase().includes(q) ||
      (ds.description || '').toLowerCase().includes(q) ||
      (ds.problem_statement || '').toLowerCase().includes(q)
    );
  });

  // Reset selection whenever the underlying dataset list changes (page/type
  // switch); keeping stale ids would let the user "Export Selected" rows
  // they can't see anymore.
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [typeFilter, page]);

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

  // Selected rows visible on the current page, grouped by type. The
  // export endpoint is per-type and CSV columns differ per type, so the
  // FE forces selection to a single type before allowing Export Selected.
  const selectedRows = useMemo(
    () => filteredDatasets.filter(d => selectedKeys.has(keyOf(d))),
    [filteredDatasets, selectedKeys],
  );

  const selectedType = useMemo(() => {
    if (selectedRows.length === 0) return null;
    const types = new Set(selectedRows.map(r => r.dataset_type));
    return types.size === 1 ? selectedRows[0].dataset_type : 'mixed';
  }, [selectedRows]);

  const selectedCount = selectedRows.length;

  // ─── Dataset Views: deep-link, load, save, clear ─────────────────────
  // Deep link entry: /datasets?view=<id> loads the view on mount and
  // strips the param (replace) so refresh stays clean.
  useEffect(() => {
    const viewId = searchParams.get('view');
    if (viewId && (!activeView || activeView.view_id !== viewId)) {
      (async () => {
        try {
          const v = await getDatasetView(viewId);
          setActiveView(v);
          setTypeFilter('all');
          setPage(0);
          toast.success(`Loaded view "${v.name}" — ${v.items.length} items`);
        } catch (err) {
          toast.error(parseApiError(err, `Could not load view ${viewId}`));
          const next = new URLSearchParams(searchParams);
          next.delete('view');
          setSearchParams(next, { replace: true });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickView = (view) => {
    setActiveView(view);
    setTypeFilter('all');
    setPage(0);
    // Pre-select every item in the view so cross-page selection persists
    // and "Update view" can save modifications (add/remove items).
    const nextKeys = new Set();
    for (const it of view.items || []) {
      if (it.dataset_type && it.instance_id) {
        nextKeys.add(`${it.dataset_type}/${it.instance_id}`);
      }
    }
    setSelectedKeys(nextKeys);
    toast.success(`Loaded view "${view.name}" — ${view.items.length} items selected`);
    const next = new URLSearchParams(searchParams);
    next.set('view', view.view_id);
    setSearchParams(next, { replace: true });
  };

  const clearActiveView = () => {
    setActiveView(null);
    clearSelection();
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next, { replace: true });
  };

  // Remove a single dataset from the active view. Commits immediately via
  // updateDatasetView so the user gets one-click membership control without
  // a separate "save" step. The view chip + table update via setActiveView.
  const handleRemoveFromView = async (ds) => {
    if (!activeView) return;
    const k = keyOf(ds);
    const nextItems = (activeView.items || []).filter(
      it => `${it.dataset_type}/${it.instance_id}` !== k,
    );
    if (nextItems.length === activeView.items.length) return;
    if (nextItems.length === 0) {
      toast.error('A view must have at least one item — delete the view from the Views page instead');
      return;
    }
    try {
      const updated = await updateDatasetView(activeView.view_id, { items: nextItems });
      setActiveView(updated);
      // Drop the removed key from selection too so badges stay in sync.
      setSelectedKeys(prev => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      toast.success(`Removed from "${updated.name}"`);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to remove from view'));
    }
  };

  // Merge in newly-picked items from the AddItemsToViewModal. The modal
  // returns the FULL chosen set (existing-plus-new) so we can just push it.
  const handleItemsAddedToView = (updated) => {
    setActiveView(updated);
    // Sync selection with the new membership so multi-row actions still work.
    const nextKeys = new Set();
    for (const it of updated.items || []) {
      nextKeys.add(`${it.dataset_type}/${it.instance_id}`);
    }
    setSelectedKeys(nextKeys);
  };

  // Build the items payload from the FULL selection set so that selections
  // spanning multiple pages are saved correctly. We parse the composite
  // `dataset_type/instance_id` keys directly instead of reading from the
  // current-page-only `selectedRows`.
  const selectionItemsForView = useMemo(
    () => Array.from(selectedKeys)
      .map(k => {
        const idx = k.indexOf('/');
        if (idx <= 0) return null;
        const dataset_type = k.substring(0, idx);
        const instance_id = k.substring(idx + 1);
        if (!dataset_type || !instance_id) return null;
        return { dataset_type, instance_id };
      })
      .filter(Boolean),
    [selectedKeys],
  );

  const runExport = async (datasetType, instanceIds, label) => {
    setExporting(true);
    try {
      const { filename } = await exportDatasetsCSV(datasetType, instanceIds);
      toast.success(`Downloaded ${filename}`, { description: label });
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to export datasets'));
    } finally {
      setExporting(false);
    }
  };

  const handleExportSelected = () => {
    if (selectedRows.length === 0 || selectedType === 'mixed') return;
    const iids = selectedRows.map(r => r.instance_id).filter(Boolean);
    runExport(selectedType, iids, `${iids.length} selected`);
  };

  // `handleExportAll` was retired alongside the Download All toolbar
  // button. Bulk-export is now driven exclusively via tick-then-Export.

  const handleExportRow = (ds) => {
    if (!ds.instance_id) {
      toast.error('Row has no instance_id — cannot export');
      return;
    }
    runExport(ds.dataset_type, [ds.instance_id], ds.name || ds.instance_id);
  };

  const handleImported = () => {
    // Refresh the table in place so newly-created rows show up. Don't
    // auto-switch type filter — the user picked the type in the dialog
    // already; switching the page filter on top would just be noisy if
    // they were browsing "All Types" and importing into a specific one.
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
        <div className="flex items-center gap-1.5">
          <DatasetViewsDropdown
            label="Views"
            testId="datasets-views-dropdown"
            onPick={pickView}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setSaveViewOpen(true)}
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 relative"
                  disabled={selectionItemsForView.length === 0}
                  data-testid="datasets-save-view-btn"
                >
                  <Save className="w-4 h-4" />
                  {selectionItemsForView.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-mono rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                      {selectionItemsForView.length}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {selectionItemsForView.length === 0
                  ? 'Select rows to save as a new view'
                  : `Save ${selectionItemsForView.length} selected row${selectionItemsForView.length === 1 ? '' : 's'} as a new view`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {activeView && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setAddItemsOpen(true)}
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    data-testid="datasets-add-to-view-btn"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add items to &ldquo;{activeView.name}&rdquo;</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Export Selected moved into the per-table secondary toolbar
              (only shows when rows are ticked). Header now focuses on
              "create / save / upload" actions to reduce visual noise. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setImportOpen(true)}
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  data-testid="import-datasets-btn"
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload CSV</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            onClick={() => { setEditingDataset(null); setEditorOpen(true); }}
            size="sm"
            className="h-9 ml-1"
            data-testid="new-dataset-btn"
          >
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
        {activeView && (
          <div
            className="flex items-center gap-2 text-xs border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-md px-2.5 py-1.5"
            data-testid="active-view-chip"
          >
            <BookMarked className="w-3 h-3" />
            <span>Viewing:</span>
            <span className="font-semibold" data-testid="active-view-name">{activeView.name}</span>
            <span className="font-mono text-[10px] opacity-80">· {activeView.items?.length || 0} items</span>
            <button
              onClick={clearActiveView}
              className="text-[10px] underline underline-offset-2 hover:text-foreground ml-1"
              data-testid="active-view-clear-btn"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {/* Content: Table */}
      <Card>
        <CardContent className="pt-4">
          {/* Small toolbar above the table — row count + selection-aware
              bulk actions (Export Selected + Delete Selected, both enabled
              once one or more rows are ticked) + Refresh. The standalone
              Export All button was retired per UX request — users can
              still grab everything by ticking "select all" then Export. */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              {loading ? 'Loading…' : `${filteredDatasets.length} dataset${filteredDatasets.length !== 1 ? 's' : ''}`}
            </p>
            <div className="flex items-center gap-1">
              {selectedRows.length > 0 && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={(selectedType === 'mixed' || exporting) ? undefined : handleExportSelected}
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 relative ${
                            (selectedType === 'mixed' || exporting) ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          aria-disabled={selectedType === 'mixed' || exporting}
                          data-testid="export-selected-btn-toolbar"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-mono rounded-full h-3.5 min-w-[14px] px-1 flex items-center justify-center">
                            {selectedRows.length}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {selectedType === 'mixed'
                          ? 'Selection spans multiple types — pick a single type to export'
                          : `Export ${selectedRows.length} selected ${selectedType} row(s) as CSV`}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => setBulkDeleteOpen(true)}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 relative text-destructive hover:text-destructive"
                          disabled={bulkDeleting}
                          data-testid="bulk-delete-btn"
                        >
                          {bulkDeleting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[9px] font-mono rounded-full h-3.5 min-w-[14px] px-1 flex items-center justify-center">
                            {selectedRows.length}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete {selectedRows.length} selected row(s)</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={fetchDatasets}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={loading}
                      data-testid="datasets-refresh-btn"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
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
                        aria-label="Select all on this page"
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-xs">Name / Instance</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Version</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs w-[130px]">Actions</TableHead>
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
                          aria-label={`Select ${ds.name || ds.instance_id}`}
                          data-testid={`select-row-${ds.instance_id || ds.id}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        {(() => {
                          // Always render `<dataset_type>/<name>` and force
                          // whitespace in the name → `_` so rows entered with
                          // free-form names (e.g. "Travel Concierge Bench")
                          // line up visually with auto-named rows like
                          // "scratch_bench_phased/a1_travel_concierge". Strip
                          // any leading "<type>/" the backend already prepended
                          // so we don't double up.
                          const rawName = ds.name || ds.instance_id || '';
                          const stripped = ds.dataset_type && rawName.startsWith(`${ds.dataset_type}/`)
                            ? rawName.slice(ds.dataset_type.length + 1)
                            : rawName;
                          const slug = stripped.trim().replace(/\s+/g, '_');
                          const label = ds.dataset_type
                            ? `${ds.dataset_type}/${slug || ds.instance_id || ''}`
                            : (slug || ds.instance_id || '—');
                          return (
                            <>
                              <div className="font-mono text-xs font-medium truncate" title={label}>{label}</div>
                              {/* testing_agent_bench: surface the prod_job_id
                                  inline so users can read it without opening
                                  the preview. Legacy rows fall back to
                                  instance_id (which used to double as the
                                  prod job id pre-split). */}
                              {ds.dataset_type === 'testing_agent_bench' && (
                                <div
                                  className="text-[10px] font-mono mt-0.5 truncate text-blue-700 dark:text-blue-300"
                                  title={`prod_job_id: ${ds.attributes?.prod_job_id || ds.instance_id || '—'}`}
                                  data-testid={`row-prod-job-id-${ds.instance_id || ds.id}`}
                                >
                                  prod: {ds.attributes?.prod_job_id || ds.instance_id || '—'}
                                </div>
                              )}
                              <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 truncate" title={ds.id}>{ds.id}</div>
                            </>
                          );
                        })()}
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
                          {activeView && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                                    onClick={() => handleRemoveFromView(ds)}
                                    data-testid={`remove-from-view-${ds.instance_id || ds.id}`}
                                  >
                                    <BookMarked className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Remove from view</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleExportRow(ds)}
                                  disabled={exporting || !ds.instance_id}
                                  data-testid={`download-dataset-${ds.instance_id || ds.id}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Download as CSV</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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

      {/* CSV Bulk Import Modal */}
      <ImportDatasetsModal
        open={importOpen}
        defaultType={typeFilter !== 'all' ? typeFilter : 'bug_bench'}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />

      {/* Save-as-view modal */}
      <SaveDatasetViewDialog
        open={saveViewOpen}
        items={selectionItemsForView}
        onClose={() => setSaveViewOpen(false)}
        onSaved={(view) => {
          // After saving, mark it as the active view so the user sees the
          // round-trip immediately.
          setActiveView(view);
        }}
      />

      {/* Add-items-to-view modal */}
      <AddItemsToViewModal
        open={addItemsOpen}
        view={activeView}
        onClose={() => setAddItemsOpen(false)}
        onAdded={handleItemsAddedToView}
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
      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent data-testid="bulk-delete-dataset-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedRows.length} dataset{selectedRows.length === 1 ? '' : 's'}</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete every ticked row and mark them as inactive. Forks already saved
              into views or evals are unaffected; only the dataset rows themselves are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting} data-testid="cancel-bulk-delete-btn">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-bulk-delete-btn"
            >
              {bulkDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete {selectedRows.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
