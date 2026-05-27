import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronDown, Sliders, FileCode } from 'lucide-react';
import {
  parseAgentDoc, updateAgentYaml, batchUpdateAgentYaml, getAgentValue, getPromptSource,
} from '@/lib/agentYamlAdapter';
import { MODELS_BY_PROVIDER } from '@/lib/cortexModels';

const MODEL_PROVIDERS = ['anthropic', 'openai', 'vertex_ai', 'gemini'];
const SQUASH_STRATEGIES = ['none', 'simple', 'anthropic_window_based_strategy'];
const PROMPT_SOURCES = [
  { value: 'inline',    label: 'inline'    },
  { value: 'name',      label: 'name'      },
  { value: 'prompt_id', label: 'prompt_id' },
];

// Small helper renderers ------------------------------------------------

function TextField({ label, value, onChange, placeholder, readOnly, testid, mono, datalistId, datalistOptions, error }) {
  return (
    <div className="space-y-1">
      <Label className={`text-[10px] uppercase tracking-wider font-medium ${error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{label}</Label>
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        list={datalistId}
        className={`h-7 text-xs ${mono ? 'font-mono' : ''} ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
        data-testid={testid}
      />
      {datalistId && datalistOptions && (
        <datalist id={datalistId}>
          {datalistOptions.map((opt) => <option key={opt} value={opt} />)}
        </datalist>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange, step = 1, min, max, placeholder, testid, nullable }) {
  // Empty input → null (i.e. delete the key). Otherwise coerce to number.
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value === undefined || value === null ? '' : value}
        onChange={(e) => {
          const t = e.target.value;
          if (t === '') {
            onChange(nullable ? null : 0);
            return;
          }
          const n = Number(t);
          if (!Number.isNaN(n)) onChange(n);
        }}
        placeholder={placeholder}
        className="h-7 text-xs font-mono"
        data-testid={testid}
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange, placeholder, testid }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs" data-testid={testid}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt} className="text-xs font-mono">{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Main component --------------------------------------------------------

// Quick-fields strip. Two-way bound into `yamlText`:
//   - On mount / each YAML change we re-parse to repopulate form controls.
//   - Each form edit calls updateAgentYaml() with the surgical setIn — that
//     preserves comments, ordering, and indentation in the rest of the doc.
//
// Fields explicitly NOT form-ified (per spec, dynamic shapes):
//   model.params, spec.toolsets[].params, spec.overrides, context.auto_compact,
//   spec.hooks. We show a hint chip listing them so users know to edit raw.
// Props:
//   errorPath: optional dotted path (e.g. ['metadata','id']) — when set, the
//     matching quick-field row gets a red border so the user knows where the
//     server's 400 lives.
export function AgentQuickFields({
  yamlText,
  agentId,           // locks metadata.id in edit mode
  onChange,          // (newYamlText) => void
  defaultOpen = true,
  errorPath = null,
}) {
  const { parsed, errors } = useMemo(() => parseAgentDoc(yamlText), [yamlText]);
  // If parse is broken, render collapsed by default so the form doesn't blank.
  const [open, setOpen] = useState(defaultOpen && errors.length === 0);

  // Helpers --------------------------------------------------------------

  const set = (path, value) => onChange(updateAgentYaml(yamlText, path, value));

  const setPromptSource = (next) => {
    // Maintain the exactly-one-of rule by deleting the other two and
    // seeding the chosen one if it doesn't yet exist.
    const others = PROMPT_SOURCES.map((p) => p.value).filter((v) => v !== next);
    const ops = others.map((k) => ({ path: ['spec', 'prompt', k], value: null }));
    const existing = getAgentValue(parsed, ['spec', 'prompt', next]);
    if (existing === undefined) {
      ops.push({ path: ['spec', 'prompt', next], value: next === 'inline' ? '' : '' });
    }
    onChange(batchUpdateAgentYaml(yamlText, ops));
  };

  // Helper to compare a quick-field path against the server error path.
  const pathErr = (segs) => Array.isArray(errorPath) &&
    errorPath.length === segs.length &&
    errorPath.every((s, i) => s === segs[i]);

  // Reads ----------------------------------------------------------------

  const metaName = getAgentValue(parsed, ['metadata', 'name']);
  const metaVer  = getAgentValue(parsed, ['metadata', 'version']);
  const provider = getAgentValue(parsed, ['spec', 'model', 'provider']);
  const modelId  = getAgentValue(parsed, ['spec', 'model', 'id']);
  const maxTok   = getAgentValue(parsed, ['spec', 'model', 'max_tokens']);
  const temp     = getAgentValue(parsed, ['spec', 'model', 'temperature']);
  const polMaxIt = getAgentValue(parsed, ['spec', 'policy', 'max_iterations']);
  const polMaxB  = getAgentValue(parsed, ['spec', 'policy', 'max_budget_usd']);
  const ctxThr   = getAgentValue(parsed, ['spec', 'context', 'threshold']);
  const ctxSqsh  = getAgentValue(parsed, ['spec', 'context', 'squashing_strategy']);
  const promptSrc = getPromptSource(parsed);

  const broken = errors.length > 0;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b bg-muted/30"
      data-testid="cortex-agent-quick-fields"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/40 transition-colors [&[data-state=open]>svg.chev]:rotate-180"
          data-testid="cortex-agent-quick-fields-toggle"
        >
          <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold">Quick fields</span>
          {broken && (
            <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-500/40">
              YAML doesn't parse — edit raw to fix
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">comment-preserving edits</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform chev" />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {!broken && (
          <div className="px-3 pb-3 pt-1 space-y-3">
            {/* Metadata */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TextField
                label="metadata.id (locked)"
                value={agentId || getAgentValue(parsed, ['metadata', 'id'])}
                onChange={() => {}}
                readOnly
                mono
                testid="qf-metadata-id"
                error={pathErr(['metadata', 'id'])}
              />
              <TextField
                label="metadata.name"
                value={metaName}
                onChange={(v) => set(['metadata', 'name'], v)}
                testid="qf-metadata-name"
                error={pathErr(['metadata', 'name'])}
              />
              <NumberField
                label="metadata.version"
                value={metaVer}
                step={1}
                min={1}
                onChange={(v) => set(['metadata', 'version'], v)}
                testid="qf-metadata-version"
              />
            </div>

            {/* Model */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SelectField
                label="model.provider"
                value={provider}
                options={MODEL_PROVIDERS}
                onChange={(v) => set(['spec', 'model', 'provider'], v)}
                placeholder="select…"
                testid="qf-model-provider"
              />
              <TextField
                label="model.id"
                value={modelId}
                onChange={(v) => set(['spec', 'model', 'id'], v)}
                mono
                placeholder="e.g. claude-sonnet-4-5"
                testid="qf-model-id"
                datalistId="qf-model-id-options"
                datalistOptions={MODELS_BY_PROVIDER[provider] || []}
                error={pathErr(['spec', 'model', 'id'])}
              />
              <NumberField
                label="model.max_tokens"
                value={maxTok}
                step={1}
                min={1}
                onChange={(v) => set(['spec', 'model', 'max_tokens'], v)}
                nullable
                testid="qf-model-max-tokens"
              />
              <NumberField
                label="model.temperature (0–1)"
                value={temp}
                step={0.1}
                min={0}
                max={1}
                onChange={(v) => set(['spec', 'model', 'temperature'], v)}
                nullable
                placeholder="unset"
                testid="qf-model-temperature"
              />
            </div>

            {/* Policy + context */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberField
                label="policy.max_iterations"
                value={polMaxIt}
                step={1}
                min={1}
                onChange={(v) => set(['spec', 'policy', 'max_iterations'], v)}
                nullable
                testid="qf-policy-max-iterations"
              />
              <NumberField
                label="policy.max_budget_usd"
                value={polMaxB}
                step={0.5}
                min={0}
                onChange={(v) => set(['spec', 'policy', 'max_budget_usd'], v)}
                nullable
                testid="qf-policy-max-budget"
              />
              <NumberField
                label="context.threshold (0–1)"
                value={ctxThr}
                step={0.05}
                min={0}
                max={1}
                onChange={(v) => set(['spec', 'context', 'threshold'], v)}
                nullable
                testid="qf-context-threshold"
              />
              <SelectField
                label="context.squashing_strategy"
                value={ctxSqsh}
                options={SQUASH_STRATEGIES}
                onChange={(v) => set(['spec', 'context', 'squashing_strategy'], v)}
                placeholder="select…"
                testid="qf-context-squashing"
              />
            </div>

            {/* Prompt source radio */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">spec.prompt source</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PROMPT_SOURCES.map(({ value, label }) => {
                  const checked = promptSrc === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPromptSource(value)}
                      className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                        checked
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 hover:border-border'
                      }`}
                      data-testid={`qf-prompt-source-${value}`}
                    >
                      {label}
                    </button>
                  );
                })}
                <span className="text-[10px] text-muted-foreground ml-2">
                  body of the chosen source stays in raw YAML
                </span>
              </div>
            </div>

            {/* Raw-only hint */}
            <div className="flex items-start gap-2 text-[10px] text-muted-foreground pt-1 border-t">
              <FileCode className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="leading-relaxed">
                Dynamic shapes stay in raw YAML below:
                <span className="font-mono"> model.params · spec.toolsets · spec.overrides · context.auto_compact · spec.hooks</span>.
              </span>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default AgentQuickFields;
