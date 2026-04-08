import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SliderWithNumber } from '@/components/agents/SliderWithNumber';
import { SQUASHING_STRATEGIES } from '@/lib/constants';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export default function RuntimeTab({ config, updateConfig }) {
  const runtime = config.runtime || {};
  const ctx = runtime.context_management || {};
  const autoCompact = runtime.auto_compact || {};
  const [compactOpen, setCompactOpen] = useState(autoCompact.enabled || false);

  return (
    <div className="space-y-6">
      {/* Main runtime */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Execution Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Max Iterations</Label>
              <Input
                type="number"
                value={runtime.max_iterations ?? 10000}
                onChange={e => updateConfig('runtime.max_iterations', parseInt(e.target.value) || 10000)}
                className="font-mono text-sm"
                data-testid="runtime-iterations-input"
              />
              <p className="text-xs text-muted-foreground">Default: 10,000</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Timeout</Label>
              <Input
                value={runtime.timeout || '50m'}
                onChange={e => updateConfig('runtime.timeout', e.target.value)}
                placeholder="e.g. 50m"
                className="font-mono text-sm"
                data-testid="runtime-timeout-input"
              />
              <p className="text-xs text-muted-foreground">Default: 50m</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Context management */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold">Context Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Squashing Strategy</Label>
            <Select
              value={ctx.squashing_strategy || 'bulk_checkpoint'}
              onValueChange={v => updateConfig('runtime.context_management.squashing_strategy', v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SQUASHING_STRATEGIES.map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SliderWithNumber
            label="Threshold"
            value={ctx.threshold ?? 0.7}
            onChange={v => updateConfig('runtime.context_management.threshold', Math.round(v * 100) / 100)}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.7}
            testId="runtime-threshold"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Preserve Last N</Label>
              <Input
                type="number"
                value={ctx.preserve_last_n ?? 5}
                onChange={e => updateConfig('runtime.context_management.preserve_last_n', parseInt(e.target.value) || 5)}
                className="font-mono text-sm"
                min={0}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Truncation Length</Label>
              <Input
                type="number"
                value={ctx.truncation_length ?? 8000}
                onChange={e => updateConfig('runtime.context_management.truncation_length', parseInt(e.target.value) || 8000)}
                className="font-mono text-sm"
                min={0}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-compact */}
      <Card>
        <Collapsible open={compactOpen} onOpenChange={setCompactOpen} data-testid="runtime-auto-compact-collapsible">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Auto-Compact</CardTitle>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={autoCompact.enabled || false}
                    onCheckedChange={v => {
                      updateConfig('runtime.auto_compact.enabled', v);
                      if (v) setCompactOpen(true);
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${compactOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Strategy</Label>
                  <Select
                    value={autoCompact.strategy || 'summarize'}
                    onValueChange={v => updateConfig('runtime.auto_compact.strategy', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="summarize">Summarize</SelectItem>
                      <SelectItem value="truncate">Truncate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Last N</Label>
                  <Input
                    type="number"
                    value={autoCompact.last_n ?? 3}
                    onChange={e => updateConfig('runtime.auto_compact.last_n', parseInt(e.target.value) || 3)}
                    className="font-mono text-sm"
                    min={0}
                  />
                </div>
              </div>

              <SliderWithNumber
                label="Threshold"
                value={autoCompact.threshold ?? 0.9}
                onChange={v => updateConfig('runtime.auto_compact.threshold', Math.round(v * 100) / 100)}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.9}
                testId="runtime-compact-threshold"
              />

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Summary Prompt Name</Label>
                <Input
                  value={autoCompact.summary_prompt_name || ''}
                  onChange={e => updateConfig('runtime.auto_compact.summary_prompt_name', e.target.value)}
                  placeholder="e.g. compact_summary_v1"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Target Agent ID (optional)</Label>
                <Input
                  value={autoCompact.target_agent_id || ''}
                  onChange={e => updateConfig('runtime.auto_compact.target_agent_id', e.target.value)}
                  placeholder="Agent ID for compact target"
                  className="font-mono text-sm"
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
