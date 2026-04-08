import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PROVIDERS, BUILTIN_TOOLS } from '@/lib/constants';
import { Info } from 'lucide-react';

export default function HooksTab({ config, updateConfig }) {
  const hooks = config.hooks || {};
  const commLayer = hooks.communication_layer_override || {};
  const hasCommLayer = Object.keys(commLayer).length > 0;

  const handleToggleCommLayer = (enabled) => {
    if (enabled) {
      updateConfig('hooks.communication_layer_override', {
        prompt_name: '',
        model_name: '',
        provider: 'anthropic',
        end_turn_enabled: true,
        builtin_tools: [],
      });
    } else {
      updateConfig('hooks', {});
    }
  };

  return (
    <div className="space-y-6">
      <Alert className="border-blue-200 bg-blue-50">
        <Info className="w-4 h-4 text-blue-700" />
        <AlertDescription className="text-sm text-blue-700">
          Communication layer overrides change how this agent communicates. Use with care — incorrect settings may break agent interactions.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Communication Layer Override</CardTitle>
            <Switch
              checked={hasCommLayer}
              onCheckedChange={handleToggleCommLayer}
            />
          </div>
        </CardHeader>
        {hasCommLayer && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Prompt Name</Label>
                <Input
                  value={commLayer.prompt_name || ''}
                  onChange={e => updateConfig('hooks.communication_layer_override.prompt_name', e.target.value)}
                  placeholder="e.g. comm_layer_v2"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Model Name</Label>
                <Input
                  value={commLayer.model_name || ''}
                  onChange={e => updateConfig('hooks.communication_layer_override.model_name', e.target.value)}
                  placeholder="e.g. claude-sonnet-4-5"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
                <Select
                  value={commLayer.provider || 'anthropic'}
                  onValueChange={v => updateConfig('hooks.communication_layer_override.provider', v)}
                >
                  <SelectTrigger>
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
                <Label className="text-xs font-medium text-muted-foreground">End Turn Enabled</Label>
                <div className="pt-1">
                  <Switch
                    checked={commLayer.end_turn_enabled ?? true}
                    onCheckedChange={v => updateConfig('hooks.communication_layer_override.end_turn_enabled', v)}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Built-in Tools</Label>
              <div className="flex flex-wrap gap-3">
                {BUILTIN_TOOLS.map(tool => (
                  <label key={tool} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={(commLayer.builtin_tools || []).includes(tool)}
                      onCheckedChange={checked => {
                        const current = commLayer.builtin_tools || [];
                        const next = checked ? [...current, tool] : current.filter(t => t !== tool);
                        updateConfig('hooks.communication_layer_override.builtin_tools', next);
                      }}
                    />
                    <span className="text-sm font-mono">{tool}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
