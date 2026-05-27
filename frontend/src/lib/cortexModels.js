// Known model IDs per provider for the quick-fields combobox.
// Free-text fallback is always supported — these are just autocomplete hints.

export const MODELS_BY_PROVIDER = {
  anthropic: [
    'claude-opus-4-7',
    'claude-opus-4-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
  ],
  openai: [
    'gpt-5-2',
    'gpt-5-1',
    'gpt-5',
    'gpt-4o',
    'gpt-4o-mini',
  ],
  vertex_ai: [
    'claude-opus-4-7@anthropic',
    'gemini-3-pro@google',
  ],
  gemini: [
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-pro',
  ],
};
