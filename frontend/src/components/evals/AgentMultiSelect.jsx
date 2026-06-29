import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Loader2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Searchable multi-select for the harness agent catalog (~400 entries).
 * The cmdk Command handles typeahead filtering so we never render all 400
 * raw rows in the trigger. Value/onChange operate on agent ids (string[]).
 */
export function AgentMultiSelect({
  agents = [],
  value = [],
  onChange,
  loading = false,
  error = null,
  onRetry,
  testId = 'agent-multi-select',
}) {
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => {
    const m = new Map();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const toggle = (id) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange(Array.from(set));
  };

  const remove = (id) => onChange(value.filter((v) => v !== id));
  const clearAll = () => onChange([]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-3 py-2"
        data-testid={`${testId}-loading`}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading agents…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-between gap-2 text-xs text-rose-600 dark:text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-md px-3 py-2"
        data-testid={`${testId}-error`}
      >
        <span className="flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed to load agents
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[11px]"
          onClick={onRetry}
          data-testid={`${testId}-retry`}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            data-testid={`${testId}-trigger`}
          >
            <span className="truncate text-xs">
              {value.length === 0
                ? 'Select agents…'
                : `${value.length} agent${value.length === 1 ? '' : 's'} selected`}
            </span>
            <ChevronsUpDown className="w-4 h-4 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput
              placeholder="Search agents…"
              className="text-xs"
              data-testid={`${testId}-input`}
            />
            <CommandList>
              <CommandEmpty>No agents match.</CommandEmpty>
              <CommandGroup>
                {agents.map((a) => {
                  const selected = value.includes(a.id);
                  // searchable string: id + name + tags
                  const searchVal = `${a.id} ${a.name || ''} ${(a.tags || []).join(' ')}`;
                  return (
                    <CommandItem
                      key={a.id}
                      value={searchVal}
                      onSelect={() => toggle(a.id)}
                      className="text-xs"
                      data-testid={`${testId}-option-${a.id}`}
                    >
                      <Check className={cn('mr-2 h-3.5 w-3.5', selected ? 'opacity-100' : 'opacity-0')} />
                      <div className="min-w-0">
                        <div className="font-mono truncate">{a.name || a.id}</div>
                        {a.description && (
                          <div className="text-[10px] text-muted-foreground truncate">{a.description}</div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testId}-chips`}>
          {value.map((id) => {
            const a = byId.get(id);
            return (
              <Badge
                key={id}
                variant="outline"
                className="text-[10px] font-mono bg-violet-500/10 text-violet-600 border-violet-500/20 gap-1 pr-1"
                data-testid={`${testId}-chip-${id}`}
              >
                <span className="truncate max-w-[200px]">{a?.name || id}</span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="hover:text-foreground"
                  aria-label={`Remove ${a?.name || id}`}
                  data-testid={`${testId}-chip-remove-${id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] underline underline-offset-2 text-muted-foreground hover:text-foreground ml-1"
            data-testid={`${testId}-clear`}
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
