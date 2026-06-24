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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  getJudgeConfig,
  updateJudgeConfig,
  resetJudgeConfig,
} from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

// The user has explicitly restricted the judge model to these two
// production-ready options. If the harness later supports more we add
// them here — there's no free-text Custom option by design.
const MODEL_OPTIONS = [
  'gemini-flash-latest',
  'gpt-5.5',
];
const FALLBACK_MODEL = MODEL_OPTIONS[0];

/**
 * Shared body shared between the modal dialog and the standalone page.
 * Manages load / dirty state / validation / save / reset and surfaces
 * the persisted config via `onSaved`.
 *
 * Props:
 *   onClose?:        () => void  // optional — dialog uses it for auto-close on Save
 *   onSaved?:        (cfg) => void  // called whenever the server returns a fresh config
 *   showHeader:      bool         // page hides the inner header (it uses the page header)
 *   showSaveFooter:  bool         // page renders its own footer; dialog uses ours
 */
export function JudgeConfigForm({ onClose, onSaved, showHeader = true, showSaveFooter = true }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [judgePrompt, setJudgePrompt] = useState('');
  const [judgeModel, setJudgeModel] = useState(FALLBACK_MODEL);
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cfg = await getJudgeConfig();
        if (cancelled) return;
        setJudgePrompt(cfg.judge_prompt || '');
        // If a previously-saved value isn't one of the two allowed
        // options anymore, coerce back to the fallback so the Select
        // always has a valid match. The original value is NOT mutated
        // server-side until the user clicks Save.
        const model = cfg.judge_model || FALLBACK_MODEL;
        setJudgeModel(MODEL_OPTIONS.includes(model) ? model : FALLBACK_MODEL);
        setIsDefault(!!cfg.is_default);
        setUpdatedAt(cfg.updated_at || null);
      } catch (err) {
        toast.error(parseApiError(err, 'Failed to load judge config'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasGoldenToken = judgePrompt.includes('{golden}');
  const hasCandidateToken = judgePrompt.includes('{candidate}');
  const promptValid = hasGoldenToken && hasCandidateToken && !!judgePrompt.trim();

  const handleSave = async () => {
    if (!promptValid) {
      if (!judgePrompt.trim()) toast.error('judge_prompt cannot be empty');
      else if (!hasGoldenToken) toast.error('Prompt must contain the literal token {golden}');
      else toast.error('Prompt must contain the literal token {candidate}');
      return;
    }
    setSaving(true);
    try {
      const cfg = await updateJudgeConfig({
        judge_prompt: judgePrompt,
        judge_model: judgeModel,
      });
      setIsDefault(!!cfg.is_default);
      setUpdatedAt(cfg.updated_at);
      toast.success('Judge config saved');
      onSaved && onSaved(cfg);
      onClose && onClose();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to save judge config'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const cfg = await resetJudgeConfig();
      setJudgePrompt(cfg.judge_prompt);
      setJudgeModel(MODEL_OPTIONS.includes(cfg.judge_model) ? cfg.judge_model : FALLBACK_MODEL);
      setIsDefault(true);
      setUpdatedAt(null);
      toast.success('Reset to default');
      onSaved && onSaved(cfg);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to reset judge config'));
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      {showHeader && (
        <div className="mb-3">
          {isDefault ? (
            <Badge variant="outline" className="text-[10px] font-mono">unsaved · using default</Badge>
          ) : (
            <Badge variant="default" className="text-[10px] font-mono">customized</Badge>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-medium">Judge Model</Label>
              {updatedAt && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  last updated {new Date(updatedAt).toLocaleString()}
                </span>
              )}
            </div>
            <Select value={judgeModel} onValueChange={setJudgeModel}>
              <SelectTrigger
                className="text-sm font-mono"
                data-testid="judge-model-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-medium">Judge Prompt *</Label>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={hasGoldenToken ? 'default' : 'destructive'}
                  className="text-[10px] font-mono"
                >
                  {hasGoldenToken ? '✓' : '✗'} {'{golden}'}
                </Badge>
                <Badge
                  variant={hasCandidateToken ? 'default' : 'destructive'}
                  className="text-[10px] font-mono"
                >
                  {hasCandidateToken ? '✓' : '✗'} {'{candidate}'}
                </Badge>
              </div>
            </div>
            <Textarea
              value={judgePrompt}
              onChange={(e) => setJudgePrompt(e.target.value)}
              className="font-mono text-[11px] min-h-[360px] leading-relaxed"
              spellCheck={false}
              data-testid="judge-prompt-textarea"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Other curly braces (e.g. JSON literals in the output spec) flow
              through untouched — only <code className="font-mono">{'{golden}'}</code> and{' '}
              <code className="font-mono">{'{candidate}'}</code> are substituted.
            </p>
          </div>
        </div>
      )}

      {showSaveFooter && !loading && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={loading || resetting || saving}
            data-testid="judge-config-reset"
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
                data-testid="judge-config-cancel"
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading || saving || !promptValid}
              data-testid="judge-config-save"
            >
              {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Modal wrapper around <JudgeConfigForm/> — kept for the Run Eval Step 2
 * "Edit judge prompt & model" button.
 */
export function JudgeConfigDialog({ open, onOpenChange, onSaved }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="judge-config-dialog"
      >
        <DialogHeader>
          <DialogTitle>LLM Judge Configuration</DialogTitle>
          <DialogDescription className="text-xs">
            Used as the top-level <code className="font-mono">judge_prompt</code> +{' '}
            <code className="font-mono">judge_model</code> on every testing_agent_bench
            eval. The prompt must contain the literal tokens{' '}
            <code className="font-mono">{'{golden}'}</code> and{' '}
            <code className="font-mono">{'{candidate}'}</code> — they&apos;re the only
            two substitutions the harness performs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-1">
          {/* Re-mount the form whenever the dialog opens so it re-fetches
              fresh config and clears prior dirty state. The form renders
              its own Save/Cancel/Reset row at the bottom. */}
          {open && (
            <JudgeConfigForm
              key={open ? 'open' : 'closed'}
              onClose={() => onOpenChange(false)}
              onSaved={onSaved}
              showHeader
              showSaveFooter
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
