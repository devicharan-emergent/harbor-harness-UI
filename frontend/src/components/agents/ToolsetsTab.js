import { useState, useCallback } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/agents/EmptyState';
import { ENVCORE_TOOLS, SERVER_TOOLS, BUILTIN_TOOLS, TRANSPORT_TYPES } from '@/lib/constants';
import { GripVertical, Plus, Trash2, Wrench, Settings2, Bot, X } from 'lucide-react';

const ALL_WHITELISTED_TOOLS = [...ENVCORE_TOOLS, ...SERVER_TOOLS];

function SortableToolsetCard({ toolset, index, onUpdate, onRemove, allAgentIds }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: toolset._sortId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  const typeIcons = { mcp: Wrench, builtin: Settings2, subagent: Bot };
  const TypeIcon = typeIcons[toolset.type] || Wrench;

  return (
    <div ref={setNodeRef} style={style} data-testid="toolsets-card">
      <Card className={`${isDragging ? 'ring-1 ring-slate-400' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
              data-testid="toolsets-drag-handle"
            >
              <GripVertical className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    <TypeIcon className="w-3 h-3 mr-1" />
                    {toolset.type}
                  </Badge>
                  <span className="font-medium text-sm">
                    {toolset.type === 'builtin' ? 'Built-in Tools' : toolset.name || 'Unnamed'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(index)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* MCP fields */}
              {toolset.type === 'mcp' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        value={toolset.name || ''}
                        onChange={e => onUpdate(index, { ...toolset, name: e.target.value })}
                        placeholder="Tool name"
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <Input
                        value={toolset.url || ''}
                        onChange={e => onUpdate(index, { ...toolset, url: e.target.value })}
                        placeholder="http://localhost:8080"
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Timeout</Label>
                      <Input
                        type="number"
                        value={toolset.timeout || 30}
                        onChange={e => onUpdate(index, { ...toolset, timeout: parseInt(e.target.value) || 30 })}
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Transport</Label>
                      <Select
                        value={toolset.transport || 'http'}
                        onValueChange={v => onUpdate(index, { ...toolset, transport: v })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Required</Label>
                      <div className="pt-1">
                        <Switch
                          checked={toolset.required || false}
                          onCheckedChange={v => onUpdate(index, { ...toolset, required: v })}
                        />
                      </div>
                    </div>
                  </div>
                  {/* Whitelisted tools */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Whitelisted Tools</Label>
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-md border bg-secondary/50 max-h-32 overflow-y-auto">
                      {ALL_WHITELISTED_TOOLS.map(tool => (
                        <label key={tool} className="flex items-center gap-1 cursor-pointer">
                          <Checkbox
                            checked={(toolset.whitelisted_tool_names || []).includes(tool)}
                            onCheckedChange={checked => {
                              const current = toolset.whitelisted_tool_names || [];
                              const next = checked ? [...current, tool] : current.filter(t => t !== tool);
                              onUpdate(index, { ...toolset, whitelisted_tool_names: next });
                            }}
                            className="h-3.5 w-3.5"
                          />
                          <span className="text-xs font-mono">{tool}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(toolset.whitelisted_tool_names || []).length} tools selected
                    </p>
                  </div>
                </div>
              )}

              {/* Builtin fields */}
              {toolset.type === 'builtin' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Enabled Tools</Label>
                  <div className="flex flex-wrap gap-2">
                    {BUILTIN_TOOLS.map(tool => (
                      <label key={tool} className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={(toolset.tools || []).includes(tool)}
                          onCheckedChange={checked => {
                            const current = toolset.tools || [];
                            const next = checked ? [...current, tool] : current.filter(t => t !== tool);
                            onUpdate(index, { ...toolset, tools: next });
                          }}
                        />
                        <span className="text-sm font-mono">{tool}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Subagent fields */}
              {toolset.type === 'subagent' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Agent ID</Label>
                    <Input
                      value={toolset.name || ''}
                      onChange={e => onUpdate(index, { ...toolset, name: e.target.value })}
                      placeholder="Enter agent ID"
                      className="text-sm h-8 font-mono"
                      list="agent-ids"
                    />
                    {toolset.name && !allAgentIds.includes(toolset.name) && (
                      <p className="text-xs text-amber-700">
                        Warning: Agent ID "{toolset.name}" not found in existing agents
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Timeout (s)</Label>
                      <Input
                        type="number"
                        value={toolset.timeout || 300}
                        onChange={e => onUpdate(index, { ...toolset, timeout: parseInt(e.target.value) || 300 })}
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max Iterations</Label>
                      <Input
                        type="number"
                        value={toolset.max_iterations || 50}
                        onChange={e => onUpdate(index, { ...toolset, max_iterations: parseInt(e.target.value) || 50 })}
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ToolsetsTab({ config, updateConfig, allAgentIds }) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const toolsets = (config.toolsets || []).map((t, i) => ({ ...t, _sortId: `toolset-${i}` }));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = toolsets.findIndex(t => t._sortId === active.id);
      const newIndex = toolsets.findIndex(t => t._sortId === over.id);
      const reordered = arrayMove(config.toolsets || [], oldIndex, newIndex);
      updateConfig('toolsets', reordered);
    }
  }, [config.toolsets, toolsets, updateConfig]);

  const handleAdd = (type) => {
    const templates = {
      mcp: { type: 'mcp', name: '', url: '', timeout: 30, transport: 'http', required: false, whitelisted_tool_names: [] },
      builtin: { type: 'builtin', tools: [] },
      subagent: { type: 'subagent', name: '', timeout: 300, max_iterations: 50 },
    };
    updateConfig('toolsets', [...(config.toolsets || []), templates[type]]);
    setAddDialogOpen(false);
  };

  const handleUpdate = (index, updated) => {
    const next = [...(config.toolsets || [])];
    const { _sortId, ...clean } = updated;
    next[index] = clean;
    updateConfig('toolsets', next);
  };

  const handleRemove = (index) => {
    const next = (config.toolsets || []).filter((_, i) => i !== index);
    updateConfig('toolsets', next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Toolsets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {toolsets.length} toolset{toolsets.length !== 1 ? 's' : ''} configured. Drag to reorder.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddDialogOpen(true)} data-testid="toolsets-add-button">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Toolset
        </Button>
      </div>

      {toolsets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No toolsets configured"
          body="Add MCP tools, built-ins, or subagents. Toolsets determine available capabilities."
          primaryAction={{ label: 'Add Toolset', onClick: () => setAddDialogOpen(true), testId: 'empty-add-toolset' }}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={toolsets.map(t => t._sortId)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {toolsets.map((toolset, index) => (
                <SortableToolsetCard
                  key={toolset._sortId}
                  toolset={toolset}
                  index={index}
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  allAgentIds={allAgentIds}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add dialog for agent IDs */}
      <datalist id="agent-ids">
        {allAgentIds.map(id => <option key={id} value={id} />)}
      </datalist>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Toolset</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[
              { type: 'mcp', icon: Wrench, label: 'MCP Tool', desc: 'External tool via MCP protocol' },
              { type: 'builtin', icon: Settings2, label: 'Built-in', desc: 'System-provided tools (ask_human, finish, think)' },
              { type: 'subagent', icon: Bot, label: 'Subagent', desc: 'Delegate to another agent' },
            ].map(opt => (
              <button
                key={opt.type}
                onClick={() => handleAdd(opt.type)}
                className="w-full flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 text-left"
              >
                <opt.icon className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
