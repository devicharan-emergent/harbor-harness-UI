import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, RefreshCw, Copy, FileCode } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { listAgents, parseCortexError } from '@/services/cortexApi';

// Left pane: list of agent_id rows for the connected eph. Empty list is the
// happy "fresh eph" state, not an error.
export function AgentList({
  ephName,
  selectedAgentId,
  onSelect,
  onNew,
  onDuplicate,
  // Bumping `refreshKey` forces a re-fetch from the parent (e.g. after a save
  // or delete).
  refreshKey,
}) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="cortex-agent-list">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="text-xs font-semibold">Agents{agents.length > 0 && ` (${agents.length})`}</div>
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
            <p className="mt-1 text-[10px]">Click "New" to create one.</p>
          </div>
        ) : (
          <ul className="divide-y" data-testid="cortex-agent-list-items">
            {agents.map((a) => {
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
