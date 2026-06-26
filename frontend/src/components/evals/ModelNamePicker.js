import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

// Curated presets per the harness team. Free-text Custom is also supported.
export const MODEL_NAME_PRESETS = [
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-fable-5',
];

const DEFAULT_SENTINEL = '__default__';
const CUSTOM_SENTINEL = '__custom__';

/**
 * Dropdown picker for testing_agent_bench model_name.
 * - Blank value → "(default)" — payload omits model_name (agent's default).
 * - Preset value → selects matching preset in the dropdown.
 * - Free-text value → "Custom…" with an inline text input.
 *
 * @param value     current model_name string ('' = default)
 * @param onChange  (next: string) => void
 * @param testId    base data-testid; "-select" + "-custom" suffixes added
 * @param placeholder for the custom Input
 */
export function ModelNamePicker({ value, onChange, testId, placeholder = 'e.g. claude-sonnet-4-5' }) {
  // `forceCustom` lets the user pick "Custom…" even when the current value
  // happens to match a preset (so they can edit it as free text).
  const [forceCustom, setForceCustom] = useState(false);

  const isPreset = value && MODEL_NAME_PRESETS.includes(value);
  const showCustomInput = forceCustom || (!!value && !isPreset);

  let selectValue;
  if (!value) selectValue = DEFAULT_SENTINEL;
  else if (forceCustom || !isPreset) selectValue = CUSTOM_SENTINEL;
  else selectValue = value;

  const handleSelect = (next) => {
    if (next === DEFAULT_SENTINEL) {
      setForceCustom(false);
      onChange('');
    } else if (next === CUSTOM_SENTINEL) {
      setForceCustom(true);
      // Leave the current free-text value as-is so the user can edit it.
    } else {
      setForceCustom(false);
      onChange(next);
    }
  };

  return (
    <div className="space-y-1.5">
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger className="text-sm font-mono" data-testid={`${testId}-select`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_SENTINEL} className="text-muted-foreground">
            (default — agent&apos;s default model)
          </SelectItem>
          {MODEL_NAME_PRESETS.map((m) => (
            <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
          ))}
          <SelectItem value={CUSTOM_SENTINEL}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {showCustomInput && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm"
          data-testid={`${testId}-custom`}
        />
      )}
    </div>
  );
}
