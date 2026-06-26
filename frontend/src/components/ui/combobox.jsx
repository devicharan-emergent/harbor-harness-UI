import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
 * Searchable single-select combobox built on Popover + cmdk Command.
 * Falls back to a free-text item ("Use ‘…’") when `allowCustom` is set and
 * the typed query doesn't match an existing option — that's how the user
 * commits a custom value the host knows nothing about (e.g. an agent_id
 * that hasn't been registered yet, or a model alias we haven't curated).
 *
 * Props:
 *   - value         current selected string (or '' for none)
 *   - onChange      (next: string) => void
 *   - options       string[] of selectable values
 *   - placeholder   trigger label when value is empty
 *   - searchPlaceholder cmdk input placeholder (defaults to "Search…")
 *   - emptyText     copy shown when no options match (and !allowCustom)
 *   - allowCustom   when true, typing an unmatched value adds a "Use ‘x’" row
 *   - testId        data-testid for the trigger (suffixes "-trigger" / "-input")
 *   - disabled
 *   - className     extra classes on the trigger button
 */
export function Combobox({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  allowCustom = true,
  testId,
  disabled = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const trimmed = query.trim();
  // Show the "Use ‘<typed>’" row when custom is allowed, the user typed
  // something, and that exact string isn't already in the option list.
  const showCustomRow =
    allowCustom &&
    trimmed.length > 0 &&
    !options.some((o) => o.toLowerCase() === trimmed.toLowerCase());

  const commit = (next) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-mono text-sm font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
          data-testid={testId ? `${testId}-trigger` : undefined}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
        align="start"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.length > 0 && (
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => commit(opt)}
                    className="font-mono text-xs"
                    data-testid={testId ? `${testId}-opt-${opt}` : undefined}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-3.5 w-3.5',
                        value === opt ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCustomRow && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`__custom__${trimmed}`}
                  onSelect={() => commit(trimmed)}
                  className="font-mono text-xs"
                  data-testid={testId ? `${testId}-custom-commit` : undefined}
                >
                  <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                  Use &lsquo;<span className="font-semibold">{trimmed}</span>&rsquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
