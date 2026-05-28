import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { EphGate } from '@/components/cortex/EphGate';
import { AgentList } from '@/components/cortex/AgentList';
import { AgentEditor } from '@/components/cortex/AgentEditor';
import { CortexEditorErrorBoundary } from '@/components/cortex/CortexEditorErrorBoundary';
import { Boxes } from 'lucide-react';
import { getAgent, parseCortexError } from '@/services/cortexApi';
import { rewriteMetadataId, blankAgentYaml } from '@/lib/agentYaml';
import { toast } from 'sonner';
import { createAgent as cortexCreateAgent } from '@/services/cortexApi';

const LS_KEY = 'acm_cortex_eph';

// Resolve the active eph from URL > localStorage (URL wins so shared links
// like /cortex/agents?eph=foo override stale local state).
function readPersistedEph(searchParams) {
  const fromUrl = (searchParams.get('eph') || '').trim();
  if (fromUrl) return fromUrl;
  try { return (window.localStorage.getItem(LS_KEY) || '').trim(); } catch { return ''; }
}

export default function CortexAgents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialEph = useMemo(() => readPersistedEph(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The connected eph (validated via /ephs/exists). Empty string = not connected.
  const [eph, setEph] = useState(''); // updated only after a successful connect
  // Mirror the persisted value into the gate's input on first render.
  const [gateDefault] = useState(initialEph);

  // Editor mode + selection.
  // mode: 'idle' | 'create' | 'edit' | 'duplicate'
  const [mode, setMode] = useState('idle');
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [editorAgentId, setEditorAgentId] = useState('');
  const [editorYaml, setEditorYaml] = useState('');
  const [listRefreshKey, setListRefreshKey] = useState(0);
  // Agents the user has just deleted — kept in a hidden set so the list
  // updates immediately. Cleared on next refetch or on Undo (which re-POSTs
  // the agent back from the in-memory yaml_content we saved before delete).
  const [optimisticHidden, setOptimisticHidden] = useState([]);
  // Last-loaded yaml of the selected agent — used both for the diff and as
  // the source for an Undo-delete restore.
  const [lastLoadedYaml, setLastLoadedYaml] = useState('');

  // Persist eph + sync URL whenever it changes (URL is shareable).
  useEffect(() => {
    try {
      if (eph) window.localStorage.setItem(LS_KEY, eph);
      else window.localStorage.removeItem(LS_KEY);
    } catch { /* ignore quota / privacy errors */ }
    const next = new URLSearchParams(searchParams);
    if (eph) next.set('eph', eph); else next.delete('eph');
    setSearchParams(next, { replace: true });
  }, [eph]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback((name) => {
    setEph(name);
    setMode('idle');
    setSelectedAgentId(null);
    setEditorAgentId('');
    setEditorYaml('');
  }, []);

  const handleDisconnect = useCallback(() => {
    setEph('');
    setMode('idle');
    setSelectedAgentId(null);
    setEditorAgentId('');
    setEditorYaml('');
  }, []);

  const handleNew = useCallback(() => {
    setMode('create');
    setSelectedAgentId(null);
    setEditorAgentId('');
    setEditorYaml('');
  }, []);

  const handleSelect = useCallback((agentId) => {
    setMode('edit');
    setSelectedAgentId(agentId);
    setEditorAgentId(agentId);
    setEditorYaml(''); // editor will fetch by id
  }, []);

  // Duplicate-from-existing: fetch the source yaml, prompt for a new id,
  // rewrite metadata.id in the copy so it round-trips the envelope check.
  const handleDuplicate = useCallback(async (sourceId) => {
    if (!eph) return;
    const newId = window.prompt(`New agent_id (copying ${sourceId}):`);
    const trimmed = (newId || '').trim();
    if (!trimmed) return;
    if (trimmed === sourceId) {
      toast.error('New id must differ from source id');
      return;
    }
    try {
      const data = await getAgent(eph, sourceId);
      const rewritten = rewriteMetadataId(data?.yaml_content || blankAgentYaml(trimmed), trimmed);
      setMode('duplicate');
      setSelectedAgentId(null);
      setEditorAgentId(trimmed);
      setEditorYaml(rewritten);
    } catch (err) {
      const e = parseCortexError(err);
      toast.error(`Couldn’t copy: ${e.message}`);
    }
  }, [eph]);

  const handleSaved = useCallback((saved) => {
    setListRefreshKey((k) => k + 1);
    setMode('edit');
    setSelectedAgentId(saved.agent_id);
    setEditorAgentId(saved.agent_id);
  }, []);

  const handleDeleted = useCallback((deletedId) => {
    // Optimistic hide + Undo toast that re-POSTs the agent we just deleted.
    setOptimisticHidden((prev) => [...prev, deletedId]);
    setMode('idle');
    setSelectedAgentId(null);
    setEditorAgentId('');
    setEditorYaml('');
    const restoreYaml = lastLoadedYaml || blankAgentYaml(deletedId);
    toast.success(`Deleted ${deletedId}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            await cortexCreateAgent(eph, deletedId, restoreYaml);
            toast.success(`Restored ${deletedId}`);
          } catch (err) {
            toast.error(`Could not restore ${deletedId}`);
          } finally {
            setOptimisticHidden((prev) => prev.filter((x) => x !== deletedId));
            setListRefreshKey((k) => k + 1);
          }
        },
      },
      onAutoClose: () => {
        // Drop from hidden set after the toast goes — list refetch will
        // confirm the deletion server-side.
        setOptimisticHidden((prev) => prev.filter((x) => x !== deletedId));
        setListRefreshKey((k) => k + 1);
      },
    });
  }, [eph, lastLoadedYaml]);

  const handleCancelCreate = useCallback(() => {
    setMode('idle');
    setEditorAgentId('');
    setEditorYaml('');
  }, []);

  // -------------------------------------------------------------------

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-7rem)] min-h-[600px]">
      {/* Title + gate */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Boxes className="w-5 h-5" />
            Cortex Agents
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live YAML CRUD for agents stored in
            <span className="font-mono"> cortex_&lt;eph&gt;.agent_definitions</span>. Connect to an
            eph to begin.
          </p>
        </div>
        <div className="flex-1 min-w-[320px]">
          <EphGate
            value={eph}
            defaultInput={gateDefault}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        </div>
      </div>

      {/* Two-pane content */}
      {!eph ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center text-xs text-muted-foreground py-10">
            <Boxes className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Connect to an eph above to list and edit agents.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex-1 min-h-0 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] h-full min-h-0">
            <div className="border-r min-h-0">
              <AgentList
                ephName={eph}
                selectedAgentId={selectedAgentId}
                onSelect={handleSelect}
                onNew={handleNew}
                onDuplicate={handleDuplicate}
                refreshKey={listRefreshKey}
                optimisticHidden={optimisticHidden}
              />
            </div>
            <div className="min-h-0">
              {mode === 'idle' ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Select an agent or click "New" to begin.
                </div>
              ) : (
                <CortexEditorErrorBoundary>
                  <AgentEditor
                    key={`${mode}-${editorAgentId}`}
                    ephName={eph}
                    mode={mode}
                    initialAgentId={editorAgentId}
                    initialYaml={editorYaml}
                    onSaved={handleSaved}
                    onDeleted={handleDeleted}
                    onCancelCreate={handleCancelCreate}
                    onLoaded={({ yaml_content }) => setLastLoadedYaml(yaml_content)}
                  />
                </CortexEditorErrorBoundary>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
