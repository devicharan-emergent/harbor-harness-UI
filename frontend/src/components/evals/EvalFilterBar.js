import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Search, SlidersHorizontal, X, Calendar } from 'lucide-react';

// Shape of the `value` prop:
//   { batch: string, agent: string, prompt: string,
//     dateFrom: string (YYYY-MM-DD), dateTo: string (YYYY-MM-DD),
//     mode: 'and' | 'or',
//     mineOnly: boolean }
// `mineOnly` is also passed to the BFF jobs list as `created_by=<user_id>`
// so it works across pagination (server-side filter) AND is enforced
// client-side as a defence in depth on the predicate.

export const EMPTY_FILTERS = {
  batch: '', agent: '', prompt: '',
  dateFrom: '', dateTo: '', mode: 'and',
  mineOnly: false,
};

// Build the predicate function used to filter eval jobs. Exported so EvalRuns
// can apply the same predicate to both the flat job list and the per-group
// detail jobs fetched on expand.
// `currentUserCreatedBy` is the authenticated user's `created_by` identity
// (now the email — the harness migrated off the user_id UUID). When present
// AND filters.mineOnly is on, jobs whose `created_by` doesn't match are
// hidden. Server already filters, but stale cached lists or jobs from older
// flows that didn't stamp `created_by` would otherwise leak through.
// `groupNameByRunId` is an optional `{ [group_run_id]: group_name }` map so
// the "Search batch name" input matches against the friendly editable
// `group_name` in addition to the raw immutable `group_run_id`. We OR the
// two matches together — typing "smoke" matches a group named "Smoke test"
// even if its run id is opaque.
export function buildJobFilter(filters, currentUserCreatedBy = null, groupNameByRunId = null) {
  const batch = (filters.batch || '').trim().toLowerCase();
  const agent = (filters.agent || '').trim().toLowerCase();
  const prompt = (filters.prompt || '').trim().toLowerCase();
  const from = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00').getTime() : null;
  const to = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59').getTime() : null;
  const mode = filters.mode === 'or' ? 'or' : 'and';
  const mineOnly = Boolean(filters.mineOnly) && Boolean(currentUserCreatedBy);

  return (job) => {
    // Mine-only is a hard AND filter regardless of mode — it's an
    // identity scope, not a "match any" criterion.
    if (mineOnly) {
      const owner = job.created_by || job.config?.created_by || '';
      if (owner !== currentUserCreatedBy) return false;
    }
    const checks = [];
    if (batch) {
      const gid = (
        job.group_run_id || job.group_id ||
        job.config?.group_run_id || job.config?.group_id || ''
      );
      const gidLower = gid.toLowerCase();
      const gname = (groupNameByRunId && gid ? (groupNameByRunId[gid] || '') : '').toLowerCase();
      const jobIdLower = (job.id || '').toLowerCase();
      // OR — main search bar matches across friendly group name, raw
      // group_run_id, AND job id so users can paste any of the three.
      checks.push(
        gidLower.includes(batch) ||
        (gname ? gname.includes(batch) : false) ||
        jobIdLower.includes(batch)
      );
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
    () => advancedCount + (value.batch?.trim() ? 1 : 0) + (value.mineOnly ? 1 : 0),
    [advancedCount, value.batch, value.mineOnly],
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

        <Button
          type="button"
          variant={value.mineOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => update({ mineOnly: !value.mineOnly })}
          className="h-8 gap-1.5"
          aria-pressed={Boolean(value.mineOnly)}
          data-testid="filter-mine-only-toggle"
          title="Show only eval runs created by me"
        >
          <span className="text-xs">Mine only</span>
        </Button>

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

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
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
        </div>
      )}

      {/* Active filter chips (always visible when any filter is set) */}
      {activeCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5" data-testid="filter-active-chips">
          {value.batch?.trim() && (
            <Chip label="Batch" value={value.batch} onClear={() => update({ batch: '' })} testid="chip-batch" />
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
