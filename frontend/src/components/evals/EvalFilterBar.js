import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, SlidersHorizontal, X, Calendar } from 'lucide-react';

// Shape of the `value` prop:
//   { batch: string, agent: string, prompt: string,
//     createdBy: string,
//     dateFrom: string (YYYY-MM-DD), dateTo: string (YYYY-MM-DD) }
// All fields are sent to the BFF (GET /api/eval/jobs) as server-side query
// params — `batch`→`search`, `agent`→`agent_name`, `prompt`→`problem`,
// `createdBy`→`created_by`, dates→`date_from`/`date_to`.
// Filtering is AND-combined server-side (the harness has no OR mode yet).

export const EMPTY_FILTERS = {
  batch: '', agent: '', prompt: '',
  createdBy: '',
  dateFrom: '', dateTo: '',
};

function Chip({ label, value, onClear, testid }) {
  return (
    <Badge variant="secondary" className="gap-1.5 pr-1 font-normal" data-testid={testid}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-xs truncate max-w-[140px]">{value}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-sm hover:bg-background/60 p-0.5"
        aria-label={`Clear ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </Badge>
  );
}

export function EvalFilterBar({ value, onChange, currentUserEmail }) {
  const [expanded, setExpanded] = useState(false);
  const update = (patch) => onChange({ ...value, ...patch });
  const reset = () => onChange(EMPTY_FILTERS);

  const advancedCount = useMemo(() => {
    let n = 0;
    if (value.agent?.trim()) n += 1;
    if (value.prompt?.trim()) n += 1;
    if (value.dateFrom || value.dateTo) n += 1;
    return n;
  }, [value]);

  const activeCount = useMemo(
    () => advancedCount + (value.batch?.trim() ? 1 : 0) + (value.createdBy?.trim() ? 1 : 0),
    [advancedCount, value.batch, value.createdBy],
  );

  return (
    <div className="space-y-2" data-testid="eval-filter-bar">
      {/* Row 1: search bar + filter toggle button */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={value.batch}
            onChange={(e) => update({ batch: e.target.value })}
            placeholder="Search by group name, batch id, or job id…"
            className="h-8 pl-8 text-xs"
            data-testid="filter-batch-input"
          />
        </div>

        <div className="relative flex items-center min-w-[220px]">
          <Input
            value={value.createdBy}
            onChange={(e) => update({ createdBy: e.target.value })}
            placeholder="Created by (email)"
            className="h-8 text-xs w-[220px] pr-12"
            data-testid="filter-created-by-input"
          />
          {currentUserEmail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update({ createdBy: currentUserEmail })}
              className="absolute right-1 h-6 px-2 text-[11px] font-medium"
              title={`Fill my email (${currentUserEmail})`}
              data-testid="filter-created-by-me"
            >
              Me
            </Button>
          )}
        </div>

        <Button
          type="button"
          variant={expanded || advancedCount > 0 ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="h-8 gap-1.5"
          aria-expanded={expanded}
          aria-controls="eval-filter-advanced"
          data-testid="filter-toggle-btn"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="text-xs">Filters</span>
          {advancedCount > 0 && (
            <Badge
              variant="default"
              className="h-4 min-w-4 px-1 text-[10px] font-mono tabular-nums"
              data-testid="filter-toggle-count"
            >
              {advancedCount}
            </Badge>
          )}
        </Button>

        {activeCount > 0 && (
          <Button
            onClick={reset}
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            data-testid="filter-reset-btn"
          >
            Clear all
          </Button>
        )}
      </div>

      {/* Row 2 (collapsible): advanced filters */}
      {expanded && (
        <div
          id="eval-filter-advanced"
          className="flex items-center gap-2 flex-wrap rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
          data-testid="filter-advanced-panel"
        >
          <Input
            value={value.agent}
            onChange={(e) => update({ agent: e.target.value })}
            placeholder="Agent name (e.g. full_stack_…)"
            className="h-8 text-xs w-[220px]"
            data-testid="filter-agent-input"
          />
          <Input
            value={value.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="Problem name"
            className="h-8 text-xs w-[220px]"
            data-testid="filter-prompt-input"
          />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <Input
              type="date"
              value={value.dateFrom}
              onChange={(e) => update({ dateFrom: e.target.value })}
              className="h-8 text-xs w-[148px]"
              data-testid="filter-date-from"
            />
            <span className="text-[11px]">→</span>
            <Input
              type="date"
              value={value.dateTo}
              onChange={(e) => update({ dateTo: e.target.value })}
              className="h-8 text-xs w-[148px]"
              data-testid="filter-date-to"
            />
          </div>
        </div>
      )}

      {/* Active filter chips (always visible when any filter is set) */}
      {activeCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5" data-testid="filter-active-chips">
          {value.batch?.trim() && (
            <Chip label="Batch" value={value.batch} onClear={() => update({ batch: '' })} testid="chip-batch" />
          )}
          {value.createdBy?.trim() && (
            <Chip label="Created by" value={value.createdBy} onClear={() => update({ createdBy: '' })} testid="chip-created-by" />
          )}
          {value.agent?.trim() && (
            <Chip label="Agent" value={value.agent} onClear={() => update({ agent: '' })} testid="chip-agent" />
          )}
          {value.prompt?.trim() && (
            <Chip label="Problem" value={value.prompt} onClear={() => update({ prompt: '' })} testid="chip-prompt" />
          )}
          {(value.dateFrom || value.dateTo) && (
            <Chip
              label="Date"
              value={`${value.dateFrom || '…'} → ${value.dateTo || '…'}`}
              onClear={() => update({ dateFrom: '', dateTo: '' })}
              testid="chip-date"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default EvalFilterBar;
