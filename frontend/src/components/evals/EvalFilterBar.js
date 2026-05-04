import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Search, Filter as FilterIcon, X, Calendar } from 'lucide-react';

// Shape of the `value` prop:
//   { batch: string, agent: string, prompt: string,
//     dateFrom: string (YYYY-MM-DD), dateTo: string (YYYY-MM-DD),
//     mode: 'and' | 'or' }
//
// Returns: `onChange(next)` called with the whole next object — callers can
// keep a single useState for the filter bag.

export const EMPTY_FILTERS = {
  batch: '', agent: '', prompt: '', dateFrom: '', dateTo: '', mode: 'and',
};

// Build the predicate function used to filter eval jobs. Exported so EvalRuns
// can apply the same predicate to both the flat job list and the per-group
// detail jobs fetched on expand.
export function buildJobFilter(filters) {
  const batch = (filters.batch || '').trim().toLowerCase();
  const agent = (filters.agent || '').trim().toLowerCase();
  const prompt = (filters.prompt || '').trim().toLowerCase();
  const from = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00').getTime() : null;
  const to = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59').getTime() : null;
  const mode = filters.mode === 'or' ? 'or' : 'and';

  return (job) => {
    const checks = [];
    if (batch) {
      const gid = (
        job.group_run_id || job.group_id ||
        job.config?.group_run_id || job.config?.group_id || ''
      ).toLowerCase();
      checks.push(gid.includes(batch));
    }
    if (agent) {
      const name = (job.config?.experiments?.agent_name || '').toLowerCase();
      checks.push(name.includes(agent));
    }
    if (prompt) {
      const p = (job.problem || '').toLowerCase();
      checks.push(p.includes(prompt));
    }
    if (from != null || to != null) {
      const t = job.created_at ? new Date(job.created_at).getTime() : NaN;
      const afterFrom = from == null || t >= from;
      const beforeTo = to == null || t <= to;
      checks.push(afterFrom && beforeTo);
    }
    if (checks.length === 0) return true;
    return mode === 'or' ? checks.some(Boolean) : checks.every(Boolean);
  };
}

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

export function EvalFilterBar({ value, onChange }) {
  const update = (patch) => onChange({ ...value, ...patch });
  const reset = () => onChange(EMPTY_FILTERS);

  const activeCount = useMemo(() => {
    let n = 0;
    if (value.batch?.trim()) n += 1;
    if (value.agent?.trim()) n += 1;
    if (value.prompt?.trim()) n += 1;
    if (value.dateFrom || value.dateTo) n += 1;
    return n;
  }, [value]);

  return (
    <div className="space-y-2" data-testid="eval-filter-bar">
      {/* Row 1: batch search + AND/OR + reset */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={value.batch}
            onChange={(e) => update({ batch: e.target.value })}
            placeholder="Search batch name…"
            className="h-8 pl-8 text-xs"
            data-testid="filter-batch-input"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FilterIcon className="w-3 h-3" />
          <span>Combine</span>
          <ToggleGroup
            type="single"
            size="sm"
            value={value.mode}
            onValueChange={(v) => { if (v) update({ mode: v }); }}
            className="h-7"
            data-testid="filter-mode-toggle"
          >
            <ToggleGroupItem value="and" className="h-7 px-2.5 text-[11px]" data-testid="filter-mode-and">AND</ToggleGroupItem>
            <ToggleGroupItem value="or" className="h-7 px-2.5 text-[11px]" data-testid="filter-mode-or">OR</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {activeCount > 0 && (
          <>
            <Badge variant="outline" className="text-[10px] font-mono" data-testid="filter-active-count">
              {activeCount} active
            </Badge>
            <Button
              onClick={reset}
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              data-testid="filter-reset-btn"
            >
              Clear all
            </Button>
          </>
        )}
      </div>

      {/* Row 2: agent / prompt / date range */}
      <div className="flex items-center gap-2 flex-wrap">
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
          placeholder="Prompt / problem name"
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

      {/* Row 3: active filter chips */}
      {activeCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5" data-testid="filter-active-chips">
          {value.batch?.trim() && (
            <Chip label="Batch" value={value.batch} onClear={() => update({ batch: '' })} testid="chip-batch" />
          )}
          {value.agent?.trim() && (
            <Chip label="Agent" value={value.agent} onClear={() => update({ agent: '' })} testid="chip-agent" />
          )}
          {value.prompt?.trim() && (
            <Chip label="Prompt" value={value.prompt} onClear={() => update({ prompt: '' })} testid="chip-prompt" />
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
