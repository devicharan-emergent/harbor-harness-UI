import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AGENT_TYPES } from '@/lib/constants';
import { useState } from 'react';
import { X } from 'lucide-react';

export default function GeneralTab({ config, updateConfig, autoGenerateId }) {
  const [tagInput, setTagInput] = useState('');

  const addTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().toLowerCase();
      if (!(config.tags || []).includes(newTag)) {
        updateConfig('tags', [...(config.tags || []), newTag]);
      }
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    updateConfig('tags', (config.tags || []).filter(t => t !== tag));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main form */}
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold">Agent Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Name *</Label>
              <Input
                value={config.name || ''}
                onChange={e => updateConfig('name', e.target.value)}
                placeholder="e.g. E2 Coding Assistant"
                data-testid="general-name-input"
              />
              {!config.name && (
                <p className="text-xs text-destructive">Agent name is required</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">ID</Label>
              <Input
                value={config.id || autoGenerateId()}
                onChange={e => updateConfig('id', e.target.value)}
                placeholder="Auto-generated from name + model"
                className="font-mono text-sm"
                data-testid="general-id-input"
              />
              <p className="text-xs text-muted-foreground">
                Auto-generated: {autoGenerateId()}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Description</Label>
              <Textarea
                value={config.description || ''}
                onChange={e => updateConfig('description', e.target.value)}
                placeholder="Describe what this agent does..."
                rows={3}
                data-testid="general-description-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Agent Type</Label>
              <Select
                value={config.agent_type || 'None'}
                onValueChange={v => updateConfig('agent_type', v)}
              >
                <SelectTrigger data-testid="general-agent-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold">Tags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={addTag}
              placeholder="Type a tag and press Enter"
              className="text-sm"
              data-testid="general-tags-input"
            />
            <div className="flex flex-wrap gap-1.5">
              {(config.tags || []).map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs pl-2 pr-1 py-0.5 gap-1">
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {(config.tags || []).length === 0 && (
                <p className="text-xs text-muted-foreground">No tags added</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold">Prompt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Prompt ID</Label>
              <Input
                value={config.prompt?.prompt_id || ''}
                onChange={e => updateConfig('prompt.prompt_id', e.target.value)}
                placeholder="e.g. e2_system_prompt_v3"
                className="font-mono text-sm"
                data-testid="general-prompt-id-input"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
