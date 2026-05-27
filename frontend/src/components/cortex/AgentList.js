import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, RefreshCw, Copy, FileCode, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { listAgents, parseCortexError } from '@/services/cortexApi';

// Left pane: list of agent_id rows for the connected eph. Empty list is the
// happy "fresh eph" state, not an error.
//
// Props:
//   selectedAgentId, onSelect, onNew, onDuplicate — interaction callbacks
//   refreshKey: bump to force a refetch
//   optimisticHidden: array of agent_ids that the parent has optimistically
//     deleted; we filter them from the rendered list until the next refetch
//     (or until they're cleared by parent on Undo)
export function AgentList({
  ephName,
  selectedAgentId,
  onSelect,
  onNew,
  onDuplicate,
  refreshKey,
  optimisticHidden = [],
}) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('updated_desc'); // updated_desc | updated_asc | name_asc | name_desc

  const fetchAgents = useCallback(async () => {
    if (!ephName) { setAgents([]); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await listAgents(ephName);
      setAgents(data?.agents || []);
    } catch (err) {
      setError(parseCortexError(err));
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [ephName]);

  useEffect(() => { fetchAgents(); }, [fetchAgents, refreshKey]);

  // Filtered + sorted view.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = agents.filter((a) => !optimisticHidden.includes(a.agent_id));
    if (q) arr = arr.filter((a) => a.agent_id.toLowerCase().includes(q));
    const cmp = {
      updated_desc: (a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''),
      updated_asc:  (a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''),
      name_asc:     (a, b) => a.agent_id.localeCompare(b.agent_id),
      name_desc:    (a, b) => b.agent_id.localeCompare(a.agent_id),
    }[sortKey];
    return [...arr].sort(cmp);
  }, [agents, query, sortKey, optimisticHidden]);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="cortex-agent-list">
      {/* Header */}
      <div className="border-b">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="text-xs font-semibold">
            Agents{visible.length !== agents.length ? ` (${visible.length} / ${agents.length})` : (agents.length > 0 ? ` (${agents.length})` : '')}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={fetchAgents}
              disabled={loading || !ephName}
              data-testid="cortex-agent-list-refresh"
              title="Refresh"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onNew}
              disabled={!ephName}
              data-testid="cortex-agent-new-btn"
            >
              <Plus className="w-3 h-3" />
              New
            </Button>
          </div>
        </div>
        {agents.length > 0 && (
          <div className="flex items-center gap-2 px-3 pb-2">
            <div className="relative flex-1">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search id…"
                className="h-7 pl-7 text-xs font-mono"
                data-testid="cortex-agent-list-search"
              />
            </div>
            <Select value={sortKey} onValueChange={setSortKey}>
              <SelectTrigger className="h-7 w-[110px] text-[10px]" data-testid="cortex-agent-list-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc" className="text-xs">Updated ↓</SelectItem>
                <SelectItem value="updated_asc"  className="text-xs">Updated ↑</SelectItem>
                <SelectItem value="name_asc"     className="text-xs">Name A→Z</SelectItem>
                <SelectItem value="name_desc"    className="text-xs">Name Z→A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400" data-testid="cortex-agent-list-error">
            <p className="font-medium">Failed to load agents</p>
            <p className="font-mono mt-1 break-words">{error.message}</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            <FileCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No agents yet</p>
            <p className="mt-1 text-[10px]">Click "New" to create one from a starter template.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4 h-7 text-xs gap-1.5"
              onClick={onNew}
              data-testid="cortex-agent-list-empty-cta"
            >
              <Plus className="w-3 h-3" />
              Create your first agent
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <p>No agents match <span className="font-mono">"{query}"</span></p>
          </div>
        ) : (
          <ul className="divide-y" data-testid="cortex-agent-list-items">
            {visible.map((a) => {
              const isSel = a.agent_id === selectedAgentId;
              return (
                <li
                  key={a.agent_id}
                  className={`group px-3 py-2 cursor-pointer transition-colors ${
                    isSel ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                  onClick={() => onSelect(a.agent_id)}
                  data-testid={`cortex-agent-row-${a.agent_id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono font-medium truncate">{a.agent_id}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Updated {a.updated_at ? formatDistanceToNow(new Date(a.updated_at), { addSuffix: true }) : '—'}
                      </div>
                    </div>
                    {isSel && (
                      <Badge variant="secondary" className="text-[9px] flex-shrink-0">Open</Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); onDuplicate?.(a.agent_id); }}
                      title="Duplicate"
                      data-testid={`cortex-agent-duplicate-${a.agent_id}`}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

export default AgentList;
