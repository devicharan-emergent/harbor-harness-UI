import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Save } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  getVerifierConfig,
  updateVerifierConfig,
  resetVerifierConfig,
} from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';
import { THINKING_EFFORTS, modelSupportsEffort } from '@/lib/constants';

// Shared shortlist + free-text Custom for the model picker.
const MODEL_PRESETS = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gpt-5.5'];
const CUSTOM_SENTINEL = '__custom__';

// Per-bench labels, defaults, and required-token rules. The page passes
// `benchType` to the form; everything bench-specific is sourced from here.
export const BENCH_META = {
  testing_agent_bench: {
    label: 'Testing Agent Bench',
    promptLabel: 'Judge Prompt',
    modelLabel: 'Judge Model',
    requiredTokens: ['{golden}', '{candidate}'],
    helperHeading:
      "The model + prompt used to score every testing_agent_bench eval.",
    helperBody: (
      <>
        <code className="font-mono">{'{golden}'}</code> and{' '}
        <code className="font-mono">{'{candidate}'}</code> are required —
        the harness substitutes them with the dataset&apos;s golden output and
        the testing agent&apos;s reply before calling the model.
      </>
    ),
    footerHelper: (
      <>
        Other curly braces (e.g. JSON literals in the output spec) flow through
        untouched — only <code className="font-mono">{'{golden}'}</code> and{' '}
        <code className="font-mono">{'{candidate}'}</code> are substituted.
      </>
    ),
  },
  scratch_bench_phased: {
    label: 'Scratch Bench',
    promptLabel: 'Browser Prompt',
    modelLabel: 'Browser Model',
    requiredTokens: ['{preview_url}', '{test_case}'],
    helperHeading:
      "The model + prompt used to drive + score every scratch_bench_phased browser test.",
    helperBody: (
      <>
        <code className="font-mono">{'{preview_url}'}</code> and{' '}
        <code className="font-mono">{'{test_case}'}</code> are required —
        the harness substitutes them with the app&apos;s preview URL and each
        test case before running the browser agent.
      </>
    ),
    footerHelper: (
      <>
        The pass/fail <code className="font-mono">&lt;verdict&gt;</code> format
        is appended automatically by the harness — don&apos;t include it.
        Other curly braces flow through untouched.
      </>
    ),
  },
};

/**
 * Shared body — driven by `benchType`. Re-fetches the bench's config on
 * mount AND whenever `benchType` changes, so the page can swap benches
 * in place without unmounting.
 */
export function VerifierConfigForm({ benchType, onClose, onSaved, showSaveFooter = true }) {
  const meta = BENCH_META[benchType] || BENCH_META.testing_agent_bench;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(MODEL_PRESETS[0]);
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [modelForceCustom, setModelForceCustom] = useState(false);
  // Reasoning effort persisted alongside model/prompt. 'off' => not sent.
  const [effort, setEffort] = useState('off');

  // Effort only applies to effort-capable models; reset when the model can't use it.
  useEffect(() => {
    if (!modelSupportsEffort(model) && effort !== 'off') setEffort('off');
  }, [model, effort]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cfg = await getVerifierConfig(benchType);
        if (cancelled) return;
        setPrompt(cfg.prompt || '');
        setModel(cfg.model || MODEL_PRESETS[0]);
        setEffort(cfg.effort || 'off');
        setIsDefault(!!cfg.is_default);
        setUpdatedAt(cfg.updated_at || null);
        setModelForceCustom(false);
      } catch (err) {
        toast.error(parseApiError(err, 'Failed to load verifier config'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [benchType]);

  const tokenStatus = meta.requiredTokens.map((tok) => ({
    token: tok,
    present: prompt.includes(tok),
  }));
  const promptValid =
    !!prompt.trim() && tokenStatus.every((t) => t.present);

  const handleSave = async () => {
    if (!promptValid) {
      const missing = tokenStatus.find((t) => !t.present);
      if (!prompt.trim()) toast.error('prompt cannot be empty');
      else toast.error(`Prompt must contain the literal token ${missing.token}`);
      return;
    }
    setSaving(true);
    try {
      const cfg = await updateVerifierConfig(benchType, {
        prompt,
        model: model.trim() || MODEL_PRESETS[0],
        effort: (modelSupportsEffort(model) && effort !== 'off') ? effort : '',
      });
      setIsDefault(!!cfg.is_default);
      setUpdatedAt(cfg.updated_at);
      toast.success(`${meta.label} verifier saved`);
      onSaved && onSaved(cfg);
      onClose && onClose();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to save verifier config'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const cfg = await resetVerifierConfig(benchType);
      setPrompt(cfg.prompt);
      setModel(cfg.model);
      setEffort(cfg.effort || 'off');
      setIsDefault(true);
      setUpdatedAt(null);
      setModelForceCustom(false);
      toast.success('Reset to default');
      onSaved && onSaved(cfg);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to reset verifier config'));
    } finally {
      setResetting(false);
    }
  };

  const isPresetModel = MODEL_PRESETS.includes(model);
  const showCustomInput = modelForceCustom || (!!model && !isPresetModel);
  let selectValue;
  if (!model) selectValue = MODEL_PRESETS[0];
  else if (modelForceCustom || !isPresetModel) selectValue = CUSTOM_SENTINEL;
  else selectValue = model;

  const handleModelSelect = (next) => {
    if (next === CUSTOM_SENTINEL) {
      setModelForceCustom(true);
    } else {
      setModelForceCustom(false);
      setModel(next);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {isDefault ? (
          <Badge variant="outline" className="text-[10px] font-mono">unsaved · using default</Badge>
        ) : (
          <Badge variant="default" className="text-[10px] font-mono">customized</Badge>
        )}
        {updatedAt && (
          <span className="text-[10px] text-muted-foreground font-mono">
            last updated {new Date(updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div>
            <Label className="text-xs font-medium">{meta.modelLabel}</Label>
            <div className="mt-1">
              <Select value={selectValue} onValueChange={handleModelSelect}>
                <SelectTrigger
                  className="text-sm font-mono"
                  data-testid="verifier-model-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_PRESETS.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_SENTINEL}>Custom…</SelectItem>
                </SelectContent>
              </Select>
              {showCustomInput && (
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. claude-sonnet-4-5"
                  className="mt-1.5 font-mono text-sm"
                  data-testid="verifier-model-custom"
                />
              )}
            </div>
          </div>

          {modelSupportsEffort(model) && (
            <div>
              <Label className="text-xs font-medium">Reasoning effort</Label>
              <div className="mt-1">
                <Select value={effort} onValueChange={setEffort}>
                  <SelectTrigger className="text-sm" data-testid="verifier-effort-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    {THINKING_EFFORTS.map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Mapped to the model's native reasoning param (Gemini <span className="font-mono">thinking_level</span> / OpenAI <span className="font-mono">reasoning_effort</span>). Sent on each eval; omitted when Off.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-medium">{meta.promptLabel} *</Label>
              <div className="flex items-center gap-1.5">
                {tokenStatus.map(({ token, present }) => (
                  <Badge
                    key={token}
                    variant={present ? 'default' : 'destructive'}
                    className="text-[10px] font-mono"
                  >
                    {present ? '✓' : '✗'} {token}
                  </Badge>
                ))}
              </div>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-[11px] min-h-[360px] leading-relaxed"
              spellCheck={false}
              data-testid="verifier-prompt-textarea"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {meta.footerHelper}
            </p>
          </div>
        </>
      )}

      {showSaveFooter && !loading && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={loading || resetting || saving}
            data-testid="verifier-config-reset"
          >
            {resetting ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1.5" />}
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={saving}
                data-testid="verifier-config-cancel"
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading || saving || !promptValid}
              data-testid="verifier-config-save"
            >
              {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Modal wrapper around <VerifierConfigForm/> — kept for the Run Eval
 * Step 2 "Edit prompt & model" button. Default bench = testing_agent_bench
 * so the existing call site doesn't have to change props.
 */
export function VerifierConfigDialog({ open, onOpenChange, onSaved, benchType = 'testing_agent_bench' }) {
  const meta = BENCH_META[benchType] || BENCH_META.testing_agent_bench;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="verifier-config-dialog"
      >
        <DialogHeader>
          <DialogTitle>{meta.label} — Verifier Configuration</DialogTitle>
          <DialogDescription className="text-xs">
            {meta.helperHeading}{' '}
            {meta.helperBody}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-1">
          {open && (
            <VerifierConfigForm
              key={`${open}-${benchType}`}
              benchType={benchType}
              onClose={() => onOpenChange(false)}
              onSaved={onSaved}
              showSaveFooter
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Back-compat aliases — RunEvalModal still imports these names. ──────
export const JudgeConfigForm = (props) => (
  <VerifierConfigForm benchType="testing_agent_bench" {...props} />
);
export const JudgeConfigDialog = (props) => (
  <VerifierConfigDialog benchType="testing_agent_bench" {...props} />
);
