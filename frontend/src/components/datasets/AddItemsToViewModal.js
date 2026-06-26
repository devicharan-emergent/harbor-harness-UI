import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { listDatasets, listDatasetsByType, updateDatasetView } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

// Modal for adding more datasets to an existing dataset view. Keeps the
// Datasets page narrowed to the view's items while still letting the user
// search the FULL catalog and tick new rows to merge in. On confirm we
// PATCH the view with the union of existing + newly-picked items.
const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'wingman_bench', label: 'Wingman Bench' },
];

const keyOf = (ds) => `${ds.dataset_type}/${ds.instance_id || ds.id}`;

export function AddItemsToViewModal({ open, view, onClose, onAdded }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Existing membership — these rows are shown disabled with an "in view"
  // hint instead of a checkbox so the user can't pick them again.
  const existingKeys = useMemo(() => {
    const s = new Set();
    for (const it of view?.items || []) s.add(`${it.dataset_type}/${it.instance_id}`);
    return s;
  }, [view]);

  // Reset transient state every time the modal re-opens.
  useEffect(() => {
    if (!open) {
      setPicked(new Set());
      setSearch('');
      setTypeFilter('all');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = typeFilter === 'all'
          ? await listDatasets({ limit: 200, offset: 0 })
          : await listDatasetsByType(typeFilter, { limit: 200, offset: 0 });
        if (!cancelled) setDatasets(data.datasets || []);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load datasets', err);
          toast.error('Failed to load datasets');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, typeFilter]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasets.filter(ds => {
      if (!q) return true;
      return (
        (ds.name || '').toLowerCase().includes(q) ||
        (ds.instance_id || '').toLowerCase().includes(q) ||
        (ds.description || '').toLowerCase().includes(q)
      );
    });
  }, [datasets, search]);

  const togglePick = (ds) => {
    if (existingKeys.has(keyOf(ds))) return;
    setPicked(prev => {
      const next = new Set(prev);
      const k = keyOf(ds);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // Pickable rows = filtered rows that are NOT already in the view. Drives
  // the "Select all (filtered)" header checkbox state + bulk toggle.
  const pickableRows = useMemo(
    () => filteredRows.filter(ds => !existingKeys.has(keyOf(ds))),
    [filteredRows, existingKeys],
  );
  const allPickableSelected =
    pickableRows.length > 0 && pickableRows.every(ds => picked.has(keyOf(ds)));
  const somePickableSelected =
    pickableRows.some(ds => picked.has(keyOf(ds))) && !allPickableSelected;

  const toggleSelectAll = () => {
    setPicked(prev => {
      const next = new Set(prev);
      if (allPickableSelected) {
        // Deselect everything currently visible+pickable.
        for (const ds of pickableRows) next.delete(keyOf(ds));
      } else {
        // Select everything currently visible+pickable. Selections of
        // pickable rows OUTSIDE the current search filter are preserved.
        for (const ds of pickableRows) next.add(keyOf(ds));
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!view) return;
    if (picked.size === 0) {
      toast.error('Pick at least one dataset to add');
      return;
    }
    setSaving(true);
    try {
      // Merge picked keys with existing items. Parsing the composite key
      // is safer than relying on the `datasets` cache, which may not
      // contain a row if the user typed-search filtered it out before
      // clicking confirm.
      const existing = view.items || [];
      const newItems = Array.from(picked).map(k => {
        const idx = k.indexOf('/');
        return {
          dataset_type: k.substring(0, idx),
          instance_id: k.substring(idx + 1),
        };
      });
      const merged = [...existing, ...newItems];
      const updated = await updateDatasetView(view.view_id, { items: merged });
      toast.success(`Added ${newItems.length} item${newItems.length === 1 ? '' : 's'} to "${updated.name}"`);
      onAdded?.(updated);
      onClose?.();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to update view'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-3xl" data-testid="add-items-to-view-modal">
        <DialogHeader>
          <DialogTitle>Add items to &ldquo;{view?.name}&rdquo;</DialogTitle>
          <DialogDescription>
            Search the dataset catalog and tick rows to add. Rows already in the view are shown muted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pt-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]" data-testid="add-items-type-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATASET_TYPES.map(dt => (
                <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search datasets..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 font-mono text-sm"
              data-testid="add-items-search"
            />
          </div>
        </div>

        <ScrollArea className="h-[400px] border rounded-md mt-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No datasets found
            </div>
          ) : (
            <>
              {/* Select-all header — toggles every pickable (non-already-in-view)
                  row currently visible in the filtered list. Indeterminate when
                  some-but-not-all are picked. */}
              <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/30 sticky top-0 z-10 backdrop-blur">
                <Checkbox
                  checked={allPickableSelected || (somePickableSelected ? 'indeterminate' : false)}
                  onCheckedChange={toggleSelectAll}
                  disabled={pickableRows.length === 0}
                  aria-label="Select all filtered rows"
                  data-testid="add-items-select-all"
                />
                <span className="text-xs font-medium">
                  Select all {pickableRows.length > 0 ? `(${pickableRows.length})` : ''}
                </span>
              </div>
              <ul className="divide-y">
              {filteredRows.map(ds => {
                const k = keyOf(ds);
                const inView = existingKeys.has(k);
                const isPicked = picked.has(k);
                return (
                  <li
                    key={ds.id || k}
                    className={`flex items-start gap-3 px-3 py-2 ${inView ? 'opacity-50' : 'hover:bg-accent/50 cursor-pointer'}`}
                    onClick={() => !inView && togglePick(ds)}
                    data-testid={`add-items-row-${ds.instance_id || ds.id}`}
                  >
                    <Checkbox
                      checked={inView || isPicked}
                      disabled={inView}
                      onCheckedChange={() => togglePick(ds)}
                      aria-label={`Pick ${ds.name || ds.instance_id}`}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs font-medium truncate" title={ds.name || ds.instance_id}>
                        {ds.dataset_type}/{(ds.name || ds.instance_id || '').replace(`${ds.dataset_type}/`, '').replace(/\s+/g, '_') || ds.instance_id}
                      </div>
                      {ds.description && (
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={ds.description}>
                          {ds.description}
                        </div>
                      )}
                    </div>
                    {inView && (
                      <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold flex-shrink-0">in view</span>
                    )}
                  </li>
                );
              })}
              </ul>
            </>
          )}
        </ScrollArea>

        <DialogFooter className="pt-2">
          <span className="text-xs text-muted-foreground mr-auto self-center">
            {picked.size} new · {existingKeys.size} already in view
          </span>
          <Button variant="outline" onClick={() => onClose?.()} disabled={saving} data-testid="add-items-cancel-btn">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={picked.size === 0 || saving}
            data-testid="add-items-confirm-btn"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add {picked.size > 0 ? `${picked.size} item${picked.size === 1 ? '' : 's'}` : 'items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
