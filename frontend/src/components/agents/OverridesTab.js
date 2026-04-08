import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/agents/EmptyState';
import { Wrench, Settings2, Bot } from 'lucide-react';

// Convert object format {name: {display_name, ...}} to array [{name, display_name, ...}]
function overridesToArray(overrides) {
  if (!overrides) return [];
  if (Array.isArray(overrides)) return overrides; // legacy
  return Object.entries(overrides).map(([name, val]) => ({ name, ...(val || {}) }));
}

// Convert array [{name, display_name, ...}] back to object format
function arrayToOverrides(arr) {
  const obj = {};
  for (const item of arr) {
    const { name, ...rest } = item;
    if (name) obj[name] = rest;
  }
  return obj;
}

export default function OverridesTab({ config, updateConfig }) {
  const toolsetNames = useMemo(() => {
    const names = [];
    (config.toolsets || []).forEach(ts => {
      if (ts.type === 'mcp') {
        (ts.whitelisted_tool_names || []).forEach(name => {
          if (!names.includes(name)) names.push(name);
        });
      } else if (ts.type === 'builtin') {
        (ts.tools || []).forEach(name => {
          if (!names.includes(name)) names.push(name);
        });
      } else if (ts.type === 'subagent') {
        if (ts.name && !names.includes(ts.name)) names.push(ts.name);
      }
    });
    return names;
  }, [config.toolsets]);

  const overridesList = useMemo(() => overridesToArray(config.overrides), [config.overrides]);

  const handleUpdateOverride = (index, field, value) => {
    const next = [...overridesList];
    next[index] = { ...next[index], [field]: value };
    updateConfig('overrides', arrayToOverrides(next));
  };

  const handleAutoPopulate = () => {
    const newOverrides = toolsetNames.map(name => {
      const existing = overridesList.find(o => o.name === name);
      return existing || { name, display_name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), tool_description: '' };
    });
    updateConfig('overrides', arrayToOverrides(newOverrides));
  };

  const getTypeIcon = (name) => {
    for (const ts of (config.toolsets || [])) {
      if (ts.type === 'mcp' && (ts.whitelisted_tool_names || []).includes(name)) return Wrench;
      if (ts.type === 'builtin' && (ts.tools || []).includes(name)) return Settings2;
      if (ts.type === 'subagent' && ts.name === name) return Bot;
    }
    return Wrench;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tool Overrides</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize display names and descriptions for tools from your toolsets.
          </p>
        </div>
        <button
          onClick={handleAutoPopulate}
          className="text-sm text-slate-900 hover:underline font-medium"
        >
          Sync from Toolsets ({toolsetNames.length})
        </button>
      </div>

      {overridesList.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title="No overrides configured"
          body='Click "Sync from Toolsets" to auto-populate overrides from your configured toolsets.'
          primaryAction={{ label: 'Sync from Toolsets', onClick: handleAutoPopulate, testId: 'empty-sync-overrides' }}
        />
      ) : (
        <div className="space-y-3">
          {overridesList.map((override, index) => {
            const TypeIcon = getTypeIcon(override.name);
            const isValid = toolsetNames.includes(override.name);
            return (
              <Card
                key={`${override.name}-${index}`}
                className={`${!isValid ? 'border-red-300' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <TypeIcon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {override.name}
                        </Badge>
                        {!isValid && (
                          <Badge variant="destructive" className="text-xs">
                            Not in toolsets
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Display Name</Label>
                          <Input
                            value={override.display_name || ''}
                            onChange={e => handleUpdateOverride(index, 'display_name', e.target.value)}
                            className="text-sm h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Description</Label>
                          <Textarea
                            value={override.tool_description || ''}
                            onChange={e => handleUpdateOverride(index, 'tool_description', e.target.value)}
                            rows={1}
                            className="text-sm min-h-[32px] resize-y"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
