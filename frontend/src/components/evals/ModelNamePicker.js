import { Combobox } from '@/components/ui/combobox';

// Curated fallback presets per the harness team — used when no live
// model list is supplied via the `options` prop. The Combobox also
// commits free text via its "Use ‘…’" row so a custom alias works either
// way.
export const MODEL_NAME_PRESETS = [
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-fable-5',
];

/**
 * Dropdown picker for model_name. Searchable across the live agent
 * catalog when callers pass `options` (the canonical source — we derive
 * it from /api/agents in RunEvalModal so the dropdown stays in sync
 * with what's actually deployable). Falls back to MODEL_NAME_PRESETS
 * when `options` isn't provided.
 *
 * Public API:
 *   @param value        current model_name string ('' = default)
 *   @param onChange     (next: string) => void
 *   @param options      optional explicit list of model strings; if
 *                       unset or empty, MODEL_NAME_PRESETS is used.
 *   @param testId       data-testid base for the underlying Combobox
 *   @param placeholder  trigger label when value is empty
 */
export function ModelNamePicker({ value, onChange, options, testId, placeholder = '(default — agent\'s default model)' }) {
  const effective = (options && options.length > 0) ? options : MODEL_NAME_PRESETS;
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={effective}
      placeholder={placeholder}
      searchPlaceholder="Search models or type a custom alias…"
      emptyText="No match — type to commit a custom model alias"
      allowCustom
      testId={testId}
    />
  );
}
