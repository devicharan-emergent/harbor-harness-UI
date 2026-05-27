import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Save, Trash2, AlertCircle, CheckCircle2, ChevronDown, Info, FileCode } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAgent, createAgent, updateAgent, deleteAgent, parseCortexError,
} from '@/services/cortexApi';
import { validateAgentEnvelope, blankAgentYaml } from '@/lib/agentYaml';

// Editor mode is derived from props:
//   - `mode === 'create'`: agentId is what the user types in the id input; metadata.id locked to it.
//   - `mode === 'edit'`:   agentId comes from selection; the id input is read-only.
//   - `mode === 'duplicate'`: like create, but seeded with another agent's YAML
//                             (yaml is pre-rewritten by the parent so metadata.id matches the new id).

export function AgentEditor({
  ephName,
  mode,                  // 'create' | 'edit' | 'duplicate'
  initialAgentId = '',
  initialYaml = '',
  // Called after a successful save/delete so the parent can refresh the list
  // and switch the selection.
  onSaved,
  onDeleted,
  onCancelCreate,
}) {
  const isEdit = mode === 'edit';
  const [agentId, setAgentId] = useState(initialAgentId);
  const [yamlText, setYamlText] = useState(initialYaml);
  const [loadingFetch, setLoadingFetch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [lastResponse, setLastResponse] = useState(null); // { status, payload }
  // Tracks dirty-ness vs. last-saved content for the Save button.
  const lastSavedRef = useRef(initialYaml);

  // Re-fetch the latest YAML when entering edit mode for a new agent.
  useEffect(() => {
    if (!isEdit || !ephName || !initialAgentId) return;
    let cancelled = false;
    (async () => {
      setLoadingFetch(true);
      setServerError(null);
      try {
        const data = await getAgent(ephName, initialAgentId);
        if (cancelled) return;
        setAgentId(initialAgentId);
        setYamlText(data?.yaml_content || '');
        lastSavedRef.current = data?.yaml_content || '';
        setLastResponse({ status: 200, payload: data });
      } catch (err) {
        if (cancelled) return;
        const e = parseCortexError(err);
        setServerError(e);
        setLastResponse({ status: e.status, payload: e.raw });
      } finally {
        if (!cancelled) setLoadingFetch(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, ephName, initialAgentId]);

  // Reset state when the parent swaps initial values (e.g. New / Duplicate clicked).
  useEffect(() => {
    if (isEdit) return;
    setAgentId(initialAgentId);
    setYamlText(initialYaml);
    lastSavedRef.current = initialYaml;
    setServerError(null);
    setLastResponse(null);
  }, [mode, initialAgentId, initialYaml, isEdit]);

  // Client-side envelope check (UX only; server is authoritative).
  const validation = useMemo(
    () => validateAgentEnvelope(yamlText, agentId || null),
    [yamlText, agentId],
  );
  const dirty = yamlText !== lastSavedRef.current;
  const canSave = !saving && !loadingFetch && validation.ok && Boolean(agentId.trim()) &&
    (isEdit ? dirty : true);

  const handleSave = useCallback(async () => {
    if (!ephName || !agentId.trim()) return;
    setSaving(true);
    setServerError(null);
    try {
      const data = isEdit
        ? await updateAgent(ephName, agentId, yamlText)
        : await createAgent(ephName, agentId, yamlText);
      lastSavedRef.current = yamlText;
      setLastResponse({ status: isEdit ? 200 : 201, payload: data });
      toast.success(isEdit ? 'Agent updated' : 'Agent created');
      onSaved?.({ agent_id: agentId, yaml_content: yamlText, ...data });
    } catch (err) {
      const e = parseCortexError(err);
      setServerError(e);
      setLastResponse({ status: e.status, payload: e.raw });
    } finally {
      setSaving(false);
    }
  }, [ephName, agentId, yamlText, isEdit, onSaved]);

  const handleDelete = useCallback(async () => {
    if (!ephName || !agentId) return;
    setDeleting(true);
    setServerError(null);
    try {
      const data = await deleteAgent(ephName, agentId);
      setLastResponse({ status: 200, payload: data });
      toast.success('Agent deleted');
      onDeleted?.(agentId);
    } catch (err) {
      const e = parseCortexError(err);
      setServerError(e);
      setLastResponse({ status: e.status, payload: e.raw });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [ephName, agentId, onDeleted]);

  // Render --------------------------------------------------------------

  if (loadingFetch) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading agent…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="cortex-agent-editor">
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Badge variant="outline" className="text-[10px] font-mono">
            {isEdit ? 'edit' : mode === 'duplicate' ? 'duplicate' : 'new'}
          </Badge>
          <Input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="agent_id"
            className="h-7 text-xs font-mono w-[260px]"
            readOnly={isEdit}
            data-testid="cortex-agent-id-input"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || saving}
              data-testid="cortex-agent-delete-btn"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          )}
          {!isEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onCancelCreate}
              disabled={saving}
              data-testid="cortex-agent-cancel-btn"
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="cortex-agent-save-btn"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </div>
      </div>

      {/* Inline client-side envelope hints */}
      {!validation.ok && yamlText.trim().length > 0 && (
        <div
          className="border-b border-amber-500/20 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2"
          data-testid="cortex-agent-envelope-hint"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div className="space-y-0.5">
            {validation.errors.map((e) => <div key={e} className="font-mono">• {e}</div>)}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {(!yamlText && !isEdit) ? (
          <div className="flex items-center justify-center h-full p-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setYamlText(blankAgentYaml(agentId || 'my_agent'))}
              data-testid="cortex-agent-seed-template-btn"
            >
              Insert starter template
            </Button>
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={yamlText}
            onChange={(v) => setYamlText(v ?? '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              tabSize: 2,
              automaticLayout: true,
            }}
          />
        )}
      </div>

      {/* Save expectation note + server error (always visible at the bottom) */}
      <div className="border-t bg-muted/30 px-3 py-2 space-y-2">
        <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">
            Saved YAML is structurally checked only. Full validation (model, toolsets, policy) happens when an eval runs.
          </span>
        </div>

        {serverError && (
          <div
            className="flex items-start gap-2 text-xs rounded-md border border-red-500/30 bg-red-50/40 dark:bg-red-950/20 px-2.5 py-1.5"
            data-testid="cortex-agent-server-error"
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-red-700 dark:text-red-300 font-medium">
                {serverError.code === 'conflict' ? "An agent with that id already exists — switch to Edit." :
                 serverError.code === 'not_found' ? 'Agent or eph not found' :
                 serverError.status >= 500 ? 'Harness error' :
                 serverError.code === 'invalid_request' ? 'Validation failed' :
                 'Request failed'}
              </p>
              <p className="text-foreground/70 break-words mt-0.5 font-mono text-[11px]">
                {serverError.message}
              </p>
            </div>
          </div>
        )}

        {validation.ok && !serverError && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            Envelope OK
          </div>
        )}

        {/* Raw-response debug expander */}
        {lastResponse && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground transition-colors py-0.5 [&[data-state=open]>svg]:rotate-180"
                data-testid="cortex-agent-raw-response-toggle"
              >
                <span>Last response · HTTP {lastResponse.status}</span>
                <ChevronDown className="w-3 h-3 transition-transform" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator className="my-1" />
              <pre
                className="text-[10px] font-mono whitespace-pre-wrap break-words max-h-[180px] overflow-y-auto bg-background/80 rounded p-2 border border-border/40"
                data-testid="cortex-agent-raw-response"
              >
                {JSON.stringify(lastResponse.payload, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-mono">{agentId}</span> from
              <span className="font-mono"> cortex_{ephName}.agent_definitions</span>.
              Past eval jobs that referenced it remain unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="cortex-agent-delete-confirm-btn"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AgentEditor;
