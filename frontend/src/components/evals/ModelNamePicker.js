import { Combobox } from '@/components/ui/combobox';

// Curated presets per the harness team. Free-text Custom is also supported
// via the Combobox's inline "Use ‘…’" affordance — no second Input needed.
export const MODEL_NAME_PRESETS = [
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-fable-5',
];

/**
 * Dropdown picker for model_name. Searchable across MODEL_NAME_PRESETS,
 * with a "Use ‘…’" row that commits any free-text value the user types.
 *
 * Public API (unchanged for callers):
 *   @param value        current model_name string ('' = default)
 *   @param onChange     (next: string) => void
 *   @param testId       data-testid base for the underlying Combobox trigger
 *   @param placeholder  trigger label when value is empty
 */
export function ModelNamePicker({ value, onChange, testId, placeholder = '(default — agent\'s default model)' }) {
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={MODEL_NAME_PRESETS}
      placeholder={placeholder}
      searchPlaceholder="Search models or type a custom alias…"
      emptyText="No preset matches — type to add a custom model alias"
      allowCustom
      testId={testId}
    />
  );
}
