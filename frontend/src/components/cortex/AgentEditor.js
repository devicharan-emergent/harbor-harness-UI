import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Loader2, Save, Trash2, AlertCircle, CheckCircle2, ChevronDown, Info, FileCode, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAgent, createAgent, updateAgent, deleteAgent, parseCortexError,
} from '@/services/cortexApi';
import { validateAgentEnvelope, blankAgentYaml } from '@/lib/agentYaml';
import { AgentQuickFields } from '@/components/cortex/AgentQuickFields';
import { DiffConfirmModal } from '@/components/cortex/DiffConfirmModal';
import { ensureAgentMonacoSchema, AGENT_MODEL_URI, bootstrapMonacoLoader } from '@/lib/agentMonaco';
import { locateServerError } from '@/lib/locateServerError';

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
  // Called whenever the editor loads an agent's yaml from the server (used by
  // the parent to power the Undo-delete restore flow).
  onLoaded,
}) {
  const navigate = useNavigate();
  const isEdit = mode === 'edit';
  const [agentId, setAgentId] = useState(initialAgentId);
  const [yamlText, setYamlText] = useState(initialYaml);
  const [loadingFetch, setLoadingFetch] = useState(false);
  // Gate the Monaco editor render until @monaco-editor/react's loader is
  // wired to the locally-bundled monaco-editor. Prevents the editor from
  // fetching monaco from the public CDN (the opaque "Script error." source).
  const [monacoReady, setMonacoReady] = useState(false);
  const [monacoErr, setMonacoErr] = useState(null);
  useEffect(() => {
    let alive = true;
    bootstrapMonacoLoader()
      .then(() => { if (alive) setMonacoReady(true); })
      .catch((err) => { if (alive) setMonacoErr(err); });
    return () => { alive = false; };
  }, []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [lastResponse, setLastResponse] = useState(null); // { status, payload }
  // Tracks dirty-ness vs. last-saved content for the Save button.
  const lastSavedRef = useRef(initialYaml);
  // Diff-before-save confirm.
  const [diffOpen, setDiffOpen] = useState(false);
  // Refs to the Monaco editor + monaco namespace so we can install markers
  // pointing at a 400's offending line.
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    try {
      // Fire-and-forget; failures are logged inside.
      ensureAgentMonacoSchema(monaco);
    } catch (e) {
      // Belt-and-suspenders: never let schema setup crash the editor.
      console.warn('[AgentEditor] ensureAgentMonacoSchema threw', e);
    }
    try {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        window.dispatchEvent(new CustomEvent('cortex-agent-save-shortcut'));
      });
      editor.addCommand(monaco.KeyCode.Escape, () => {
        window.dispatchEvent(new CustomEvent('cortex-agent-esc-shortcut'));
      });
    } catch (e) {
      // Shortcuts are best-effort; Save button still works without them.
      console.warn('[AgentEditor] keybinding setup failed', e);
    }
  }, []);

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
        onLoaded?.({ agent_id: initialAgentId, yaml_content: data?.yaml_content || '' });
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

  // Map the most recent server error to a quick-field path so the matching
  // row can be tinted. Cleared on dirty edits.
  const serverErrorFieldPath = useMemo(() => {
    if (!serverError) return null;
    return locateServerError(serverError.message, yamlText).fieldPath;
  }, [serverError, yamlText]);

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
      // Clear any stale Monaco markers from a previous failed save.
      if (monacoRef.current && editorRef.current?.getModel) {
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'cortex-server', []);
      }
      toast.success(isEdit ? 'Agent updated' : 'Agent created');
      setDiffOpen(false);
      onSaved?.({ agent_id: agentId, yaml_content: yamlText, ...data });
    } catch (err) {
      const e = parseCortexError(err);
      setServerError(e);
      setLastResponse({ status: e.status, payload: e.raw });
      // Located validation — install a Monaco marker on the offending line
      // whenever we can pin one from the backend's message.
      const monaco = monacoRef.current;
      const model = editorRef.current?.getModel?.();
      if (monaco && model) {
        const loc = locateServerError(e.message, yamlText);
        if (loc.line) {
          monaco.editor.setModelMarkers(model, 'cortex-server', [{
            severity: monaco.MarkerSeverity.Error,
            startLineNumber: loc.line,
            startColumn: loc.column || 1,
            endLineNumber: loc.line,
            endColumn: (model.getLineContent(loc.line) || '').length + 1 || 1,
            message: e.message,
            source: 'cortex',
          }]);
          // Reveal the offending line so the squiggle is visible.
          editorRef.current.revealLineInCenter(loc.line);
        } else {
          monaco.editor.setModelMarkers(model, 'cortex-server', []);
        }
      }
    } finally {
      setSaving(false);
    }
  }, [ephName, agentId, yamlText, isEdit, onSaved]);

  // Open the diff confirm rather than POSTing immediately — never write to a
  // live config blind.
  const requestSave = useCallback(() => {
    if (!canSave) return;
    setDiffOpen(true);
  }, [canSave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global beforeunload guard when there are unsaved edits.
  useEffect(() => {
    const handler = (e) => {
      if (dirty || (!isEdit && yamlText.trim())) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, isEdit, yamlText]);

  // Keyboard shortcuts fired from inside Monaco.
  useEffect(() => {
    const onSaveShortcut = () => requestSave();
    const onEsc = () => {
      if (!isEdit) onCancelCreate?.();
    };
    window.addEventListener('cortex-agent-save-shortcut', onSaveShortcut);
    window.addEventListener('cortex-agent-esc-shortcut', onEsc);
    return () => {
      window.removeEventListener('cortex-agent-save-shortcut', onSaveShortcut);
      window.removeEventListener('cortex-agent-esc-shortcut', onEsc);
    };
  }, [requestSave, isEdit, onCancelCreate]);

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
              onClick={() => {
                // Warn if there are unsaved edits — leaving the page would
                // drop them silently. beforeunload doesn't catch React
                // Router navigates, so we confirm here.
                if (dirty && !window.confirm(
                  'You have unsaved YAML changes. Open in eval anyway? Your edits won\'t be sent to this run.',
                )) return;
                const qs = new URLSearchParams({
                  run: '1',
                  eph: ephName,
                  agent: agentId,
                }).toString();
                navigate(`/evals?${qs}`);
              }}
              disabled={saving || deleting || !ephName || !agentId}
              data-testid="cortex-agent-open-in-eval-btn"
              title="Open the Run Evaluation modal pre-filled with this agent + eph"
            >
              <Rocket className="w-3.5 h-3.5" />
              Open in eval
            </Button>
          )}
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
            className={`h-7 text-xs gap-1.5 ${isEdit && dirty ? 'ring-2 ring-amber-400/60 ring-offset-1 ring-offset-background' : ''}`}
            onClick={requestSave}
            disabled={!canSave}
            data-testid="cortex-agent-save-btn"
            title={isEdit ? (dirty ? 'Save changes (Cmd/Ctrl+S)' : 'No changes to save') : 'Create (Cmd/Ctrl+S)'}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isEdit ? (dirty ? 'Save changes' : 'Saved') : 'Create'}
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

      {/* Quick fields (comment-preserving form bindings over yamlText) */}
      {yamlText.trim().length > 0 && (
        <AgentQuickFields
          yamlText={yamlText}
          agentId={agentId}
          onChange={setYamlText}
          errorPath={serverErrorFieldPath}
        />
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {(!yamlText && !isEdit) ? (
          <div className="flex flex-col items-center justify-center h-full p-6 gap-3" data-testid="cortex-agent-empty-create">
            <p className="text-xs text-muted-foreground">Start from a template or paste your own YAML.</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setYamlText(blankAgentYaml(agentId || 'my_agent'))}
                data-testid="cortex-agent-seed-template-btn"
              >
                Minimal valid agent
              </Button>
            </div>
          </div>
        ) : !monacoReady ? (
          <div
            className="flex items-center justify-center h-full text-xs text-muted-foreground"
            data-testid="cortex-agent-editor-bootstrapping"
          >
            {monacoErr ? (
              <div className="flex flex-col items-center gap-2 text-center max-w-md px-6">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <p className="text-red-600 dark:text-red-400 font-medium">Editor failed to load</p>
                <p className="text-[11px] font-mono text-muted-foreground break-words">
                  {String(monacoErr?.message || monacoErr)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Reloading the page usually clears this.
                </p>
              </div>
            ) : (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading editor…
              </>
            )}
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="yaml"
            path={AGENT_MODEL_URI}
            value={yamlText}
            onChange={(v) => setYamlText(v ?? '')}
            onMount={handleEditorMount}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              tabSize: 2,
              automaticLayout: true,
              // Hover from the YAML LSP / schema descriptions.
              hover: { enabled: true },
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
            <AlertDialogTitle>Delete agent <span className="font-mono">{agentId}</span>?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This removes the DB override for <span className="font-mono">{agentId}</span> in
                <span className="font-mono"> cortex_{ephName}.agent_definitions</span>.
              </span>
              <span className="block">
                <strong>Consequence:</strong> Cortex falls back to the filesystem-bundled
                <span className="font-mono"> {agentId}</span> YAML on the next eval run. If no bundled
                agent ships under that id, future runs that reference it will fail.
              </span>
              <span className="block text-muted-foreground">
                Past eval jobs that already executed are unaffected.
              </span>
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
              Delete override
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diff-before-save confirm */}
      <DiffConfirmModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        oldYaml={lastSavedRef.current}
        newYaml={yamlText}
        agentId={agentId}
        isCreate={!isEdit}
        saving={saving}
        onConfirm={handleSave}
      />
    </div>
  );
}

export default AgentEditor;
