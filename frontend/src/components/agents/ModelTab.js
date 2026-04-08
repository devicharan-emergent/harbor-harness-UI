import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SliderWithNumber } from '@/components/agents/SliderWithNumber';
import { PROVIDERS, MODEL_OPTIONS, MODEL_LIMITS, THINKING_TYPES, THINKING_EFFORTS } from '@/lib/constants';
import { useState } from 'react';

export default function ModelTab({ config, updateConfig }) {
  const model = config.model || {};
  const provider = model.provider || 'anthropic';
  const modelOptions = MODEL_OPTIONS[provider] || [];
  const [useCustomModel, setUseCustomModel] = useState(
    model.model_id && !modelOptions.find(m => m.id === model.model_id)
  );

  const thinkingType = model.thinking?.type || 'disabled';
  const clearThinking = model.clear_thinking || {};
  // If keep_turns exists, the toggle should be off (showing "Keep N Turns")
  // If keep_all exists and is true, toggle is on
  // Default to keep_all: true only when neither field is present
  const hasKeepAll = clearThinking.keep_turns !== undefined ? false : (clearThinking.keep_all !== undefined ? clearThinking.keep_all : true);

  const modelLimit = MODEL_LIMITS[model.model_id] || 128000;

  return (
    <div className="space-y-6">
      {/* Provider & Model */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Provider & Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
              <Select
                value={provider}
                onValueChange={v => {
                  updateConfig('model.provider', v);
                  const firstModel = MODEL_OPTIONS[v]?.[0];
                  if (firstModel) {
                    updateConfig('model.model_id', firstModel.id);
                    setUseCustomModel(false);
                  }
                }}
              >
                <SelectTrigger data-testid="model-provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map(p => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Model</Label>
              {useCustomModel ? (
                <div className="space-y-1.5">
                  <Input
                    value={model.model_id || ''}
                    onChange={e => updateConfig('model.model_id', e.target.value)}
                    placeholder="Enter custom model ID"
                    className="font-mono text-sm"
                    data-testid="model-custom-model-input"
                  />
                  <button
                    className="text-xs text-slate-900 hover:underline"
                    onClick={() => setUseCustomModel(false)}
                  >
                    Use preset model
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Select
                    value={model.model_id || ''}
                    onValueChange={v => {
                      if (v === '__custom__') {
                        setUseCustomModel(true);
                        updateConfig('model.model_id', '');
                      } else {
                        updateConfig('model.model_id', v);
                      }
                    }}
                  >
                    <SelectTrigger data-testid="model-model-select">
                      <SelectValue placeholder="Select model..." />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="font-mono text-xs">{m.id}</span>
                          <span className="text-muted-foreground ml-1">— {m.label}</span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__">
                        <span className="text-muted-foreground">Custom model ID...</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Context Window</Label>
            <Input
              type="number"
              value={model.context_window || 200000}
              onChange={e => updateConfig('model.context_window', parseInt(e.target.value) || 0)}
              className="font-mono text-sm w-48"
              data-testid="model-context-window-input"
            />
          </div>
        </CardContent>
      </Card>

      {/* Sampling */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Sampling Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SliderWithNumber
            label="Max Tokens"
            value={model.max_tokens || 8192}
            onChange={v => updateConfig('model.max_tokens', v)}
            min={1000}
            max={Math.min(modelLimit, 128000)}
            step={1000}
            defaultValue={8192}
            description={`Model limit: ${modelLimit.toLocaleString()}`}
            testId="model-max-tokens"
          />
          <SliderWithNumber
            label="Temperature"
            value={model.temperature ?? 0.7}
            onChange={v => updateConfig('model.temperature', Math.round(v * 100) / 100)}
            min={0}
            max={2}
            step={0.01}
            defaultValue={0.7}
            description="Lower = more deterministic, higher = more creative"
            testId="model-temperature"
          />
        </CardContent>
      </Card>

      {/* Thinking */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Thinking Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Thinking Type</Label>
            <Select
              value={thinkingType}
              onValueChange={v => updateConfig('model.thinking.type', v)}
            >
              <SelectTrigger data-testid="model-thinking-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THINKING_TYPES.map(t => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {thinkingType === 'enabled' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Budget Tokens *</Label>
              <Input
                type="number"
                value={model.thinking?.budget_tokens || ''}
                onChange={e => updateConfig('model.thinking.budget_tokens', parseInt(e.target.value) || 0)}
                placeholder="e.g. 10000"
                className="font-mono text-sm w-48"
                data-testid="model-budget-tokens-input"
              />
              {!model.thinking?.budget_tokens && (
                <p className="text-xs text-destructive">Budget tokens required when thinking is enabled</p>
              )}
            </div>
          )}

          {thinkingType === 'adaptive' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Effort Level *</Label>
              <Select
                value={model.thinking?.effort || ''}
                onValueChange={v => updateConfig('model.thinking.effort', v)}
              >
                <SelectTrigger data-testid="model-thinking-effort-select">
                  <SelectValue placeholder="Select effort..." />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_EFFORTS.map(e => (
                    <SelectItem key={e} value={e}>
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!model.thinking?.effort && (
                <p className="text-xs text-destructive">Effort level required when thinking is adaptive</p>
              )}
            </div>
          )}

          {/* Clear thinking */}
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-xs font-medium text-muted-foreground">Clear Thinking</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={hasKeepAll}
                onCheckedChange={checked => {
                  if (checked) {
                    updateConfig('model.clear_thinking', { keep_all: true });
                  } else {
                    updateConfig('model.clear_thinking', { keep_turns: 3 });
                  }
                }}
                data-testid="model-clear-thinking-toggle"
              />
              <Label className="text-sm">{hasKeepAll ? 'Keep All' : 'Keep N Turns'}</Label>
            </div>
            {!hasKeepAll && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Keep Turns</Label>
                <Input
                  type="number"
                  value={clearThinking.keep_turns ?? 3}
                  onChange={e => updateConfig('model.clear_thinking.keep_turns', parseInt(e.target.value) || 1)}
                  min={1}
                  max={100}
                  className="font-mono text-sm w-32"
                  data-testid="model-keep-turns-input"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
