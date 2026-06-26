import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Loader2, Bookmark, RefreshCw, Check } from 'lucide-react';
import { listDatasetViews } from '@/services/evalApi';

/**
 * Reusable "Load from view" dropdown. Self-fetches the list when opened
 * and on mount. `onPick(view)` fires when the user clicks an item.
 *
 * Props:
 *   - label: button text (default "Views")
 *   - emptyHint: text shown when list is empty
 *   - testId: data-testid for the trigger button
 *   - onPick: (view) => void  — fired for any click (toggle handled by caller)
 *   - closeOnSelect: close the menu after a pick (default true). Pass `false`
 *     for a multi-select host so the user can tick several views in a row
 *     without re-opening.
 *   - pickedIds: array of view_ids currently loaded by the host. Items in this
 *     list render a checkmark and clicking them invokes `onUnpick` instead
 *     of `onPick` so the dropdown doubles as the deselect affordance.
 *   - onUnpick: (view) => void  — called when an already-picked view is clicked.
 */
export function DatasetViewsDropdown({
  label = 'Views',
  emptyHint = 'No saved views yet — select rows + "Save as view" to create one.',
  testId = 'datasets-views-dropdown',
  onPick,
  onUnpick,
  pickedIds,
  closeOnSelect = true,
  disabled = false,
  size = 'sm',
  trigger,
}) {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchViews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDatasetViews({ limit: 200 });
      setViews(data?.views || []);
    } catch (err) {
      console.error('Failed to load dataset views:', err);
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchViews();
  }, [fetchViews]);

  const pickedSet = new Set(pickedIds || []);

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) fetchViews(); }}>
      <DropdownMenuTrigger asChild>
        {trigger ? trigger : (
          <Button
            variant="outline"
            size={size}
            disabled={disabled}
            data-testid={testId}
          >
            <Bookmark className="w-3.5 h-3.5 mr-1.5" />
            {label}{views.length > 0 ? ` (${views.length})` : ''}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[60vh] overflow-y-auto"
        data-testid="datasets-views-menu"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Saved views</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); fetchViews(); }}
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            data-testid="datasets-views-refresh"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : views.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-muted-foreground" data-testid="datasets-views-empty">
            {emptyHint}
          </div>
        ) : (
          views.map(v => {
            const isPicked = pickedSet.has(v.view_id);
            return (
              <DropdownMenuItem
                key={v.view_id}
                // onSelect's `e.preventDefault()` is the Radix-blessed way to
                // keep the menu open after a click; we use it whenever the
                // host wants multi-select behavior.
                onSelect={(e) => {
                  if (!closeOnSelect) e.preventDefault();
                  if (isPicked) onUnpick?.(v); else onPick?.(v);
                }}
                className="flex flex-col items-start gap-0.5 cursor-pointer"
                data-testid={`view-pick-${v.view_id}`}
              >
                <div className="flex items-center gap-2 w-full">
                  <Check className={`w-3.5 h-3.5 flex-shrink-0 ${isPicked ? 'text-emerald-500' : 'opacity-0'}`} />
                  <span className="font-medium text-xs truncate flex-1">{v.name}</span>
                  <Badge variant="secondary" className="text-[9px] font-mono">
                    {v.items?.length || 0}
                  </Badge>
                </div>
                {v.description && (
                  <span className="text-[10px] text-muted-foreground truncate w-full pl-5">
                    {v.description}
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground/70 font-mono truncate w-full pl-5">
                  by {v.created_by_email || 'unknown'}
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
