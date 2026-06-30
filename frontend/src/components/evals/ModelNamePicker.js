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
// Sentinel row letting the user explicitly pick "no model_name" (omit →
// the harness/agent default) even after a model has been pre-filled.
export const DEFAULT_MODEL_OPTION = '(default)';

export function ModelNamePicker({ value, onChange, options, testId, placeholder = '(default — agent\'s default model)' }) {
  const effective = (options && options.length > 0) ? options : MODEL_NAME_PRESETS;
  // Always expose a "(default)" option at the top so a pre-filled model can
  // be reset to omit. Selecting it maps back to an empty value.
  const withDefault = [DEFAULT_MODEL_OPTION, ...effective.filter((o) => o !== DEFAULT_MODEL_OPTION)];
  return (
    <Combobox
      value={value || DEFAULT_MODEL_OPTION}
      onChange={(next) => onChange(next === DEFAULT_MODEL_OPTION ? '' : next)}
      options={withDefault}
      placeholder={placeholder}
      searchPlaceholder="Search models or type a custom alias…"
      emptyText="No match — type to commit a custom model alias"
      allowCustom
      testId={testId}
    />
  );
}
