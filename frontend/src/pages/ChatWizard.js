import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import yaml from 'js-yaml';
import agentApi from '@/lib/api';
import {
  PROVIDERS, MODEL_OPTIONS, MODEL_LIMITS, AGENT_TYPES,
  THINKING_TYPES, THINKING_EFFORTS, TRANSPORT_TYPES,
  BUILTIN_TOOLS, ENVCORE_TOOLS, SERVER_TOOLS,
  SQUASHING_STRATEGIES, DEFAULT_RUNTIME, DEFAULT_AGENT,
} from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Send, Copy, Download, Save, RotateCcw,
  Bot, User, Check, Loader2,
} from 'lucide-react';

// ── All whitelisted tool options ────────────────────────────────────────
const ALL_MCP_TOOLS = [...ENVCORE_TOOLS, ...SERVER_TOOLS];

// ── Step definitions ────────────────────────────────────────────────────
const STEPS = [
  {
    id: 'name',
    field: 'name',
    question: "What should this agent be called?",
    explanation: "The **name** is a human-readable label — e.g. `E2 Coding Assistant` or `Research Analyst`. It's used in the UI and to auto-generate the agent ID.",
    inputType: 'text',
    placeholder: 'e.g. E2 Coding Assistant',
    required: true,
  },
  {
    id: 'description',
    field: 'description',
    question: "Describe what this agent does.",
    explanation: "A short **description** of the agent's purpose. This shows in the agent list and helps other developers understand the agent at a glance.",
    inputType: 'textarea',
    placeholder: 'e.g. Elite full-stack developer agent for rapid application development.',
  },
  {
    id: 'agent_type',
    field: 'agent_type',
    question: "What type of agent is this?",
    explanation: "**Agent type** determines the execution model:\n\n- **EmergentAssistant** — A top-level orchestrator that manages its own workflow and can delegate to subagents.\n- **SkilledAssistant** — A specialized agent that's typically invoked as a subagent by an orchestrator.\n- **None** — A standalone agent with no special execution model.",
    inputType: 'choice',
    choices: AGENT_TYPES.map(t => ({ value: t, label: t === 'None' ? 'None (standalone)' : t })),
  },
  {
    id: 'tags',
    field: 'tags',
    question: "Add some tags to categorize this agent.",
    explanation: "**Tags** are used for filtering and grouping in the agent list. Enter comma-separated values like `coding, full-stack, production`.",
    inputType: 'text',
    placeholder: 'e.g. coding, full-stack, production',
    transform: (v) => v.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
  },
  {
    id: 'provider',
    field: 'model.provider',
    question: "Which model provider should this agent use?",
    explanation: "The **provider** determines which LLM API to call:\n\n- **Anthropic** — Claude models (Opus, Sonnet, Haiku). Strong reasoning and instruction-following.\n- **OpenAI** — GPT/Codex models. Good at code generation and broad tasks.\n- **Gemini** — Google's models. Multi-modal capabilities.",
    inputType: 'choice',
    choices: PROVIDERS.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })),
  },
  {
    id: 'model_id',
    field: 'model.model_id',
    question: "Which specific model?",
    explanation: "Pick a model from the provider's lineup. Each has different strengths — larger models (Opus, Codex) are more capable but slower and costlier. Smaller models (Haiku, Mini) are faster and cheaper.",
    inputType: 'dynamic_choice',
    getChoices: (config) => {
      const provider = config.model?.provider || 'anthropic';
      const models = MODEL_OPTIONS[provider] || [];
      return [
        ...models.map(m => ({ value: m.id, label: `${m.id} — ${m.label}` })),
        { value: '__custom__', label: 'Custom model ID...' },
      ];
    },
  },
  {
    id: 'max_tokens',
    field: 'model.max_tokens',
    question: "What's the max output token limit?",
    explanation: "**Max tokens** caps how long the model's response can be. Range: 1,000 to 128,000.\n\n- `4096` — Short responses, fast.\n- `8192` — Default, balanced.\n- `16384+` — Long-form output (code generation, analysis).",
    inputType: 'number',
    placeholder: '8192',
    min: 1000,
    max: 128000,
    transform: (v) => parseInt(v) || 8192,
  },
  {
    id: 'temperature',
    field: 'model.temperature',
    question: "What temperature? (0 = deterministic, 2 = creative)",
    explanation: "**Temperature** controls randomness:\n\n- `0 – 0.3` — Factual, repeatable, best for code.\n- `0.5 – 0.8` — Balanced creativity.\n- `1.0 – 2.0` — Highly creative, less predictable.",
    inputType: 'number',
    placeholder: '0.7',
    min: 0,
    max: 2,
    step: 0.1,
    transform: (v) => Math.round(parseFloat(v) * 100) / 100 || 0.7,
  },
  {
    id: 'thinking_type',
    field: 'model.thinking.type',
    question: "Should this agent use extended thinking?",
    explanation: "**Thinking** lets the model reason step-by-step before responding:\n\n- **Enabled** — Always think. You set a token budget for the thinking phase.\n- **Adaptive** — Model decides when to think based on task complexity. You pick an effort level.\n- **Disabled** — No thinking, fastest response.",
    inputType: 'choice',
    choices: THINKING_TYPES.map(t => ({
      value: t,
      label: t === 'enabled' ? 'Enabled (always think)' : t === 'adaptive' ? 'Adaptive (model decides)' : 'Disabled (no thinking)',
    })),
  },
  {
    id: 'thinking_budget',
    field: 'model.thinking.budget_tokens',
    question: "How many tokens for the thinking budget?",
    explanation: "**Budget tokens** limits how long the model can \"think\" before starting its visible response. Higher = deeper reasoning, but slower and costlier. Typical: `5000–25000`.",
    inputType: 'number',
    placeholder: '10000',
    min: 1000,
    max: 100000,
    transform: (v) => parseInt(v) || 10000,
    condition: (config) => config.model?.thinking?.type === 'enabled',
  },
  {
    id: 'thinking_effort',
    field: 'model.thinking.effort',
    question: "What effort level for adaptive thinking?",
    explanation: "**Effort** tells the model how hard to think:\n\n- **Low** — Quick, shallow reasoning. Good for simple tasks.\n- **Medium** — Balanced. Default choice.\n- **High** — Deep reasoning. Best for complex problems.",
    inputType: 'choice',
    choices: THINKING_EFFORTS.map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })),
    condition: (config) => config.model?.thinking?.type === 'adaptive',
  },
  {
    id: 'prompt_id',
    field: 'prompt.prompt_id',
    question: "What's the system prompt ID?",
    explanation: "The **prompt ID** references a stored system prompt that defines the agent's behavior, personality, and instructions. Leave blank if none.",
    inputType: 'text',
    placeholder: 'e.g. e2_system_prompt_v3',
  },
  // ── Toolsets: Built-in ────────────────────────────────────────────────
  {
    id: 'builtin_tools',
    field: '_builtin_tools',
    question: "Which built-in tools should this agent have?",
    explanation: "**Built-in tools** are system-level capabilities:\n\n- `ask_human` — Pause and ask the user a question.\n- `finish` — Signal that the task is complete.\n- `think` — Internal reasoning scratchpad.\n- `emergent_integrations_manager` — Access LLM API keys.\n\nSelect the ones this agent needs.",
    inputType: 'multi_choice',
    choices: BUILTIN_TOOLS.map(t => ({ value: t, label: t })),
  },
  // ── Toolsets: MCP ─────────────────────────────────────────────────────
  {
    id: 'add_mcp',
    field: '_add_mcp',
    question: "Do you want to add an MCP toolset?",
    explanation: "**MCP (Model Context Protocol)** toolsets connect the agent to external tool servers — file operations, web search, code execution, image analysis, etc. Most agents need at least the `envcore` toolset for basic capabilities.",
    inputType: 'choice',
    choices: [
      { value: 'yes', label: 'Yes, add MCP tools' },
      { value: 'no', label: 'No, skip MCP tools' },
    ],
  },
  {
    id: 'mcp_name',
    field: '_mcp_name',
    question: "What's the name of this MCP toolset?",
    explanation: "Give this toolset a name — typically matches the server it connects to. Common names: `envcore` (file/bash tools), `web_search` (search tools), `vision_tools` (image analysis).",
    inputType: 'text',
    placeholder: 'e.g. envcore',
    condition: (config) => config._addMcp === true,
  },
  {
    id: 'mcp_url',
    field: '_mcp_url',
    question: "What's the MCP server URL?",
    explanation: "The **URL** where the MCP tool server is running. Usually a local HTTP endpoint like `http://localhost:8080`.",
    inputType: 'text',
    placeholder: 'http://localhost:8080',
    condition: (config) => config._addMcp === true,
  },
  {
    id: 'mcp_transport',
    field: '_mcp_transport',
    question: "Which transport protocol?",
    explanation: "**Transport** determines how the agent communicates with the MCP server:\n\n- **http** — Standard HTTP requests. Most common, works over network.\n- **stdio** — Standard input/output streams. Used for local subprocesses.",
    inputType: 'choice',
    choices: TRANSPORT_TYPES.map(t => ({ value: t, label: t })),
    condition: (config) => config._addMcp === true,
  },
  {
    id: 'mcp_tools',
    field: '_mcp_tools',
    question: "Which tools should be whitelisted for this MCP toolset?",
    explanation: "Select the specific tools this agent can use from the MCP server. The list includes:\n\n**Core tools** — `mcp_execute_bash`, `mcp_create_file`, `mcp_view_file`, `mcp_search_replace`, `mcp_glob_files`, etc.\n**Search** — `web_search_tool_v2`, `crawl_tool`\n**Analysis** — `analyze_file_tool`, `extract_file_tool`\n**Agents** — `testing_agent_v3`, `design_agent`, `deployment_agent`, etc.",
    inputType: 'multi_choice',
    choices: ALL_MCP_TOOLS.map(t => ({ value: t, label: t })),
    condition: (config) => config._addMcp === true,
  },
  // ── Toolsets: Subagent ────────────────────────────────────────────────
  {
    id: 'add_subagent',
    field: '_add_subagent',
    question: "Do you want to add a subagent?",
    explanation: "**Subagents** let this agent delegate tasks to other agents. For example, a coding agent might delegate testing to a dedicated testing agent. The subagent must be an existing agent in the system.",
    inputType: 'choice',
    choices: [
      { value: 'yes', label: 'Yes, add a subagent' },
      { value: 'no', label: 'No, skip subagents' },
    ],
  },
  {
    id: 'subagent_id',
    field: '_subagent_id',
    question: "What's the subagent's ID?",
    explanation: "Enter the **agent ID** of the subagent to delegate to. This must match an existing agent in the system. You can find agent IDs on the agent list page.",
    inputType: 'text',
    placeholder: 'e.g. testing-agent-v3-gpt-5-2-codex',
    condition: (config) => config._addSubagent === true,
  },
  {
    id: 'subagent_timeout',
    field: '_subagent_timeout',
    question: "Subagent timeout in seconds? (default: 300)",
    explanation: "**Timeout** is how long to wait for the subagent to complete before giving up. In seconds.\n\n- `120` — Quick tasks.\n- `300` (5 min) — Default, most subagent calls.\n- `600+` — Long-running subagents.",
    inputType: 'number',
    placeholder: '300',
    min: 10,
    max: 3600,
    transform: (v) => parseInt(v) || 300,
    condition: (config) => config._addSubagent === true,
  },
  // ── Runtime ───────────────────────────────────────────────────────────
  {
    id: 'max_iterations',
    field: 'runtime.max_iterations',
    question: "Max iterations? (default: 10,000)",
    explanation: "**Max iterations** is the hard limit on how many tool-call cycles the agent can perform. Prevents runaway agents.\n\n- `500` — Simple conversational agents.\n- `5000–10000` — Standard coding/analysis agents.\n- `10000+` — Complex, long-running workflows.",
    inputType: 'number',
    placeholder: '10000',
    min: 1,
    max: 100000,
    transform: (v) => parseInt(v) || 10000,
  },
  {
    id: 'timeout',
    field: 'runtime.timeout',
    question: "Execution timeout? (default: 50m)",
    explanation: "**Timeout** is the maximum wall-clock time the agent can run. Use a duration string like `10m`, `30m`, `1h`. Default is `50m`.",
    inputType: 'text',
    placeholder: '50m',
  },
  {
    id: 'review',
    field: '_review',
    question: "Here's your agent configuration. Ready to save?",
    explanation: "Review the generated YAML below. You can **save** it as a new agent, **copy** the YAML, or **download** it as a `.yaml` file.",
    inputType: 'review',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────
function deepSet(obj, path, value) {
  const next = JSON.parse(JSON.stringify(obj));
  const keys = path.split('.');
  let cursor = next;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] === undefined) cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="font-mono text-xs bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded border border-[hsl(var(--border))]">$1</code>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n- /g, '<br/>\u2022 ');
}

// ── Chat Wizard Page ─────────────────────────────────────────────────────
export default function ChatWizard() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [config, setConfig] = useState(JSON.parse(JSON.stringify(DEFAULT_AGENT)));
  const [userInput, setUserInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Internal wizard state for conditional branching
  const [wizardState, setWizardState] = useState({
    addMcp: false,
    mcpName: '',
    mcpUrl: '',
    mcpTransport: 'http',
    mcpTools: [],
    addSubagent: false,
    subagentId: '',
    subagentTimeout: 300,
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, finished]);

  // Focus input
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [currentStep]);

  // Start conversation
  useEffect(() => {
    if (messages.length === 0) {
      const step = STEPS[0];
      setMessages([{
        role: 'assistant',
        content: step.question,
        explanation: step.explanation,
        step: step.id,
        inputType: step.inputType,
        choices: step.choices,
      }]);
    }
  }, [messages.length]);

  // Compute visible steps based on current config + wizard state
  const getVisibleSteps = useCallback(() => {
    const merged = { ...config, _addMcp: wizardState.addMcp, _addSubagent: wizardState.addSubagent };
    return STEPS.filter(s => !s.condition || s.condition(merged));
  }, [config, wizardState]);

  const advanceToNextStep = useCallback((updatedConfig, updatedWizardState) => {
    const ws = updatedWizardState || wizardState;
    const merged = { ...updatedConfig, _addMcp: ws.addMcp, _addSubagent: ws.addSubagent };
    const visible = STEPS.filter(s => !s.condition || s.condition(merged));
    const currentId = STEPS[currentStep]?.id;
    const currentIdx = visible.findIndex(s => s.id === currentId);
    const nextVisibleStep = visible[currentIdx + 1];

    if (!nextVisibleStep) {
      setFinished(true);
      return;
    }

    const nextGlobalIdx = STEPS.findIndex(s => s.id === nextVisibleStep.id);
    setCurrentStep(nextGlobalIdx);

    const step = nextVisibleStep;
    const msg = {
      role: 'assistant',
      content: step.question,
      explanation: step.explanation,
      step: step.id,
      inputType: step.inputType,
      choices: step.getChoices ? step.getChoices(updatedConfig) : step.choices,
    };

    setMessages(prev => [...prev, msg]);
  }, [currentStep, wizardState]);

  const handleSubmit = useCallback((value) => {
    if (finished) return;
    const step = STEPS[currentStep];
    if (!step) return;

    if (step.required && (!value || (typeof value === 'string' && !value.trim()))) {
      toast.error(`This field is required`);
      return;
    }

    // Add user message
    const displayValue = step.inputType === 'multi_choice'
      ? (Array.isArray(value) ? value.join(', ') : value)
      : (typeof value === 'string' ? value : JSON.stringify(value));

    setMessages(prev => [...prev, { role: 'user', content: displayValue || '(skipped)' }]);

    let updatedConfig = config;
    let updatedWizard = wizardState;

    // Handle special wizard state fields
    if (step.id === 'add_mcp') {
      const doAdd = value === 'yes';
      updatedWizard = { ...wizardState, addMcp: doAdd };
      setWizardState(updatedWizard);
    } else if (step.id === 'mcp_name') {
      updatedWizard = { ...wizardState, mcpName: value || 'envcore' };
      setWizardState(updatedWizard);
    } else if (step.id === 'mcp_url') {
      updatedWizard = { ...wizardState, mcpUrl: value || 'http://localhost:8080' };
      setWizardState(updatedWizard);
    } else if (step.id === 'mcp_transport') {
      updatedWizard = { ...wizardState, mcpTransport: value || 'http' };
      setWizardState(updatedWizard);
    } else if (step.id === 'mcp_tools') {
      const tools = Array.isArray(value) ? value : [];
      updatedWizard = { ...wizardState, mcpTools: tools };
      setWizardState(updatedWizard);
      // Actually add the MCP toolset to config
      const toolsets = [...(updatedConfig.toolsets || [])];
      toolsets.push({
        type: 'mcp',
        name: wizardState.mcpName || 'envcore',
        url: wizardState.mcpUrl || 'http://localhost:8080',
        timeout: 30,
        transport: wizardState.mcpTransport || 'http',
        required: true,
        whitelisted_tool_names: tools,
      });
      updatedConfig = { ...updatedConfig, toolsets };
      setConfig(updatedConfig);
    } else if (step.id === 'add_subagent') {
      const doAdd = value === 'yes';
      updatedWizard = { ...wizardState, addSubagent: doAdd };
      setWizardState(updatedWizard);
    } else if (step.id === 'subagent_id') {
      updatedWizard = { ...wizardState, subagentId: value || '' };
      setWizardState(updatedWizard);
    } else if (step.id === 'subagent_timeout') {
      const timeout = parseInt(value) || 300;
      updatedWizard = { ...wizardState, subagentTimeout: timeout };
      setWizardState(updatedWizard);
      // Add subagent toolset
      const toolsets = [...(updatedConfig.toolsets || [])];
      toolsets.push({
        type: 'subagent',
        name: wizardState.subagentId || '',
        timeout: timeout,
        max_iterations: 50,
      });
      updatedConfig = { ...updatedConfig, toolsets };
      setConfig(updatedConfig);
    } else if (step.field === '_builtin_tools') {
      const tools = Array.isArray(value) ? value : [];
      if (tools.length > 0) {
        const toolsets = [...(updatedConfig.toolsets || [])];
        toolsets.push({ type: 'builtin', tools });
        updatedConfig = { ...updatedConfig, toolsets };
        setConfig(updatedConfig);
      }
    } else if (step.field && !step.field.startsWith('_')) {
      const transformed = step.transform ? step.transform(value) : value;
      updatedConfig = deepSet(config, step.field, transformed || '');
      setConfig(updatedConfig);
    }

    setUserInput('');
    advanceToNextStep(updatedConfig, updatedWizard);
  }, [currentStep, config, finished, advanceToNextStep, wizardState]);

  const handleChoiceClick = useCallback((value) => {
    handleSubmit(value);
  }, [handleSubmit]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(userInput);
    }
  };

  // Build final YAML
  const finalConfig = {
    id: `${slugify(config.name || 'agent')}-${slugify(config.model?.model_id || 'default')}`,
    ...config,
  };
  // Remove internal state fields
  const { last_modified, created_at, _addMcp, _addSubagent, ...exportConfig } = finalConfig;
  const yamlStr = yaml.dump(exportConfig, { lineWidth: 120, noRefs: true, sortKeys: false });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yamlStr);
    toast.success('YAML copied to clipboard');
  };

  const handleDownload = () => {
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalConfig.id}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  };

  const handleSaveAsAgent = async () => {
    setSaving(true);
    try {
      const saveData = { ...exportConfig };
      const result = await agentApi.create(saveData);
      toast.success(`Agent "${result.name}" created`);
      navigate(`/agents/${encodeURIComponent(result.id)}/edit`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setCurrentStep(0);
    setConfig(JSON.parse(JSON.stringify(DEFAULT_AGENT)));
    setUserInput('');
    setFinished(false);
    setWizardState({
      addMcp: false, mcpName: '', mcpUrl: '', mcpTransport: 'http',
      mcpTools: [], addSubagent: false, subagentId: '', subagentTimeout: 300,
    });
  };

  const currentStepDef = STEPS[currentStep];
  const isReview = currentStepDef?.inputType === 'review';
  const isChoice = currentStepDef?.inputType === 'choice' || currentStepDef?.inputType === 'dynamic_choice';
  const isMultiChoice = currentStepDef?.inputType === 'multi_choice';

  // Multi-select state
  const [multiSelected, setMultiSelected] = useState([]);
  useEffect(() => {
    if (isMultiChoice) setMultiSelected([]);
  }, [currentStep, isMultiChoice]);

  const toggleMulti = (val) => {
    setMultiSelected(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  const visibleStepCount = getVisibleSteps().length;
  const currentVisibleIdx = getVisibleSteps().findIndex(s => s.id === STEPS[currentStep]?.id);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] max-h-[calc(100vh-48px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-3 border-b bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Agent Wizard</h1>
            <p className="text-xs text-muted-foreground">Guided agent creation — step by step</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {Math.min(currentVisibleIdx + 1, visibleStepCount)}/{visibleStepCount}
          </span>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Start Over
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-[hsl(var(--primary-foreground))]" />
              </div>
            )}
            <div className={`max-w-[600px] ${
              msg.role === 'user'
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-2xl rounded-br-md px-4 py-2.5'
                : 'space-y-2'
            }`}>
              {msg.role === 'assistant' ? (
                <>
                  <p className="text-sm font-medium text-foreground">{msg.content}</p>
                  {msg.explanation && (
                    <div
                      className="text-xs text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.explanation) }}
                    />
                  )}
                  {/* Inline choices (only on the LAST assistant message) */}
                  {i === messages.length - 1 && !finished && msg.inputType !== 'multi_choice' && msg.choices && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {msg.choices.map(c => (
                        <button
                          key={c.value}
                          onClick={() => handleChoiceClick(c.value)}
                          className="text-xs font-mono px-3 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent)/0.5)] text-foreground transition-colors"
                          data-testid={`wizard-choice-${c.value}`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Multi-select */}
                  {i === messages.length - 1 && !finished && msg.inputType === 'multi_choice' && msg.choices && (
                    <div className="space-y-2 pt-2">
                      <div className="flex flex-wrap gap-1.5 max-h-[240px] overflow-y-auto pr-1">
                        {msg.choices.map(c => (
                          <button
                            key={c.value}
                            onClick={() => toggleMulti(c.value)}
                            className={`text-xs font-mono px-3 py-1.5 rounded-md border transition-colors ${
                              multiSelected.includes(c.value)
                                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]'
                                : 'bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent)/0.5)] text-foreground border-[hsl(var(--border))]'
                            }`}
                          >
                            {multiSelected.includes(c.value) && <Check className="w-3 h-3 inline mr-1" />}
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => handleSubmit(multiSelected)} className="h-7 text-xs">
                          Continue with {multiSelected.length} selected
                        </Button>
                        {multiSelected.length === 0 && (
                          <span className="text-xs text-muted-foreground">or skip this step</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-[hsl(var(--secondary))] flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-[hsl(var(--secondary-foreground))]" />
              </div>
            )}
          </div>
        ))}

        {/* Review / YAML output */}
        {(isReview || finished) && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-[hsl(var(--primary-foreground))]" />
            </div>
            <div className="flex-1 max-w-[640px] space-y-3">
              <p className="text-sm font-medium text-foreground">
                {finished ? "Your agent is ready. Here's the YAML:" : "Here's your agent configuration:"}
              </p>
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] rounded-t-lg">
                    <span className="text-xs font-mono text-muted-foreground">{finalConfig.id}.yaml</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleCopy}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleDownload}>
                        <Download className="w-3 h-3 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-auto max-h-[400px] border-t border-[hsl(var(--border))]">
                    <pre className="yaml-preview p-4 text-xs leading-6">{yamlStr}</pre>
                  </div>
                </CardContent>
              </Card>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={handleSaveAsAgent} disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                  Save as Agent
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/agents/new`)}>
                  Open in Editor
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Start Over
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area — only show for text/number/textarea inputs */}
      {!finished && !isReview && !isChoice && !isMultiChoice && (
        <div className="border-t bg-card px-4 py-3 flex-shrink-0">
          <div className="flex gap-2 max-w-[640px] mx-auto">
            {currentStepDef?.inputType === 'textarea' ? (
              <Textarea
                ref={inputRef}
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentStepDef?.placeholder || 'Type your answer...'}
                className="text-sm min-h-[40px] max-h-[120px] font-mono resize-none"
                rows={2}
                data-testid="wizard-text-input"
              />
            ) : (
              <Input
                ref={inputRef}
                type={currentStepDef?.inputType === 'number' ? 'number' : 'text'}
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentStepDef?.placeholder || 'Type your answer...'}
                min={currentStepDef?.min}
                max={currentStepDef?.max}
                step={currentStepDef?.step}
                className="text-sm font-mono"
                data-testid="wizard-text-input"
              />
            )}
            <Button
              size="icon"
              onClick={() => handleSubmit(userInput)}
              className="h-9 w-9 flex-shrink-0"
              data-testid="wizard-send-button"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          {!currentStepDef?.required && (
            <p className="text-xs text-muted-foreground text-center mt-1.5">
              Press Enter to submit, or leave empty to skip
            </p>
          )}
        </div>
      )}
    </div>
  );
}
