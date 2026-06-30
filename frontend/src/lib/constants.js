export const PROVIDERS = ['anthropic', 'openai', 'gemini'];

export const AGENT_TYPES = ['EmergentAssistant', 'SkilledAssistant', 'None'];

export const THINKING_TYPES = ['enabled', 'adaptive', 'disabled'];

export const THINKING_EFFORTS = ['low', 'medium', 'high'];

// Single source of truth mirroring the backend gating: does this model honor a
// reasoning-effort param? Gemini 3 (thinking_level) + OpenAI gpt-5*/o-series
// (reasoning_effort) do; gemini-flash-latest / gemini-2.5* etc. do not (the
// harness drops effort there). UX-only gate — the harness safely ignores it.
export const modelSupportsEffort = (model = '') => {
  const m = (model || '').toLowerCase();
  if (m.includes('gemini-3-flash') || m.includes('gemini-3.1-flash') || m.includes('gemini-3-pro')) return true;
  if (m.startsWith('gpt-5') || /^o[1-9]/.test(m)) return true;
  return false;
};

export const TRANSPORT_TYPES = ['http', 'stdio'];

export const SQUASHING_STRATEGIES = ['bulk_checkpoint', 'rolling', 'none'];

export const MODEL_OPTIONS = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5 (Nov 2025)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (May 2025)' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  openai: [
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ],
  gemini: [
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { id: 'supernova', label: 'Supernova' },
  ],
};

export const MODEL_LIMITS = {
  'claude-opus-4-6': 128000,
  'claude-opus-4-5-20251101': 128000,
  'claude-sonnet-4-6': 128000,
  'claude-sonnet-4-5': 128000,
  'claude-sonnet-4': 128000,
  'claude-sonnet-4-20250514': 128000,
  'claude-3-5-haiku-20241022': 128000,
  'gpt-5.3-codex': 128000,
  'gpt-5.2-codex': 128000,
  'gpt-5.2': 128000,
  'gpt-4.1-mini': 128000,
  'gemini-3-pro-preview': 128000,
  'supernova': 128000,
};

export const ENVCORE_TOOLS = [
  'mcp_execute_bash',
  'mcp_create_file',
  'mcp_view_file',
  'mcp_view_bulk',
  'mcp_search_replace',
  'mcp_glob_files',
  'mcp_insert_text',
  'mcp_lint_javascript',
  'mcp_lint_python',
  'mcp_screenshot_tool',
  'mcp_bulk_file_writer',
  'web_search_tool_v2',
  'crawl_tool',
  'analyze_file_tool',
  'extract_file_tool',
  'image_selector_tool',
  'get_assets_tool',
  'plan',
];

export const SERVER_TOOLS = [
  'testing_agent_v3',
  'integration_playbook_expert_v2',
  'design_agent',
  'deployment_agent',
  'troubleshoot_agent',
  'support_agent',
  'emergent_integrations_manager',
  'todo_write',
  'finish',
];

export const BUILTIN_TOOLS = [
  'ask_human',
  'finish',
  'emergent_integrations_manager',
  'think',
];

export const DEFAULT_RUNTIME = {
  max_iterations: 10000,
  timeout: '50m',
  context_management: {
    squashing_strategy: 'bulk_checkpoint',
    threshold: 0.7,
    preserve_last_n: 5,
    truncation_length: 8000,
  },
  auto_compact: {
    enabled: false,
    strategy: 'summarize',
    threshold: 0.9,
    last_n: 3,
    summary_prompt_name: '',
    target_agent_id: '',
  },
};

export const DEFAULT_AGENT = {
  name: '',
  description: '',
  agent_type: 'None',
  tags: [],
  model: {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-5',
    max_tokens: 8192,
    temperature: 0.7,
    context_window: 200000,
    thinking: { type: 'disabled' },
    clear_thinking: { keep_all: true },
  },
  prompt: { prompt_id: '' },
  toolsets: [],
  overrides: [],
  runtime: { ...DEFAULT_RUNTIME },
  hooks: {},
};
