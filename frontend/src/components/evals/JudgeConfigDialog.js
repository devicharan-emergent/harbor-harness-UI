import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Save } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  getJudgeConfig,
  updateJudgeConfig,
  resetJudgeConfig,
} from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

const MODEL_PRESETS = [
  'gemini-flash-latest',
  'gemini-2.5-pro-latest',
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'gpt-5.2',
];
const CUSTOM_SENTINEL = '__custom__';

/**
 * Singleton judge-prompt / judge-model editor.
 * - Loads current config on open via GET /api/eval/judge-config.
 * - Save validates locally that the prompt contains both {golden} and
 *   {candidate} tokens (backend re-validates and 400s on mismatch).
 * - Reset wipes the stored doc; subsequent loads serve the in-code defaults.
 * - onSaved(config) bubbles the persisted record back to the parent so it
 *   can immediately attach `judge_prompt` / `judge_model` to the next submit.
 */
export function JudgeConfigDialog({ open, onOpenChange, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [judgePrompt, setJudgePrompt] = useState('');
  const [judgeModel, setJudgeModel] = useState('gemini-flash-latest');
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [modelForceCustom, setModelForceCustom] = useState(false);

  // Load on every open so stale state doesn't survive across opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cfg = await getJudgeConfig();
        if (cancelled) return;
        setJudgePrompt(cfg.judge_prompt || '');
        setJudgeModel(cfg.judge_model || 'gemini-flash-latest');
        setIsDefault(!!cfg.is_default);
        setUpdatedAt(cfg.updated_at || null);
        setModelForceCustom(false);
      } catch (err) {
        toast.error(parseApiError(err, 'Failed to load judge config'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

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
        judge_model: judgeModel.trim() || 'gemini-flash-latest',
      });
      setIsDefault(!!cfg.is_default);
      setUpdatedAt(cfg.updated_at);
      toast.success('Judge config saved');
      onSaved && onSaved(cfg);
      onOpenChange(false);
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
      setJudgeModel(cfg.judge_model);
      setIsDefault(true);
      setUpdatedAt(null);
      setModelForceCustom(false);
      toast.success('Reset to default');
      onSaved && onSaved(cfg);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to reset judge config'));
    } finally {
      setResetting(false);
    }
  };

  const isPresetModel = MODEL_PRESETS.includes(judgeModel);
  const selectValue = !modelForceCustom && isPresetModel ? judgeModel : CUSTOM_SENTINEL;

  const handleModelSelect = (next) => {
    if (next === CUSTOM_SENTINEL) {
      setModelForceCustom(true);
    } else {
      setModelForceCustom(false);
      setJudgeModel(next);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="judge-config-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            LLM Judge Configuration
            {isDefault ? (
              <Badge variant="outline" className="text-[10px] font-mono">unsaved · using default</Badge>
            ) : (
              <Badge variant="default" className="text-[10px] font-mono">customized</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Used as the top-level <code className="font-mono">judge_prompt</code> +{' '}
            <code className="font-mono">judge_model</code> on every testing_agent_bench
            eval. The prompt must contain the literal tokens{' '}
            <code className="font-mono">{'{golden}'}</code> and{' '}
            <code className="font-mono">{'{candidate}'}</code> — they&apos;re the only
            two substitutions the harness performs.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 px-1">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-medium">Judge Model</Label>
                {updatedAt && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    last updated {new Date(updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <Select value={selectValue} onValueChange={handleModelSelect}>
                <SelectTrigger
                  className="text-sm font-mono"
                  data-testid="judge-model-select"
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
              {(modelForceCustom || !isPresetModel) && (
                <Input
                  value={judgeModel}
                  onChange={(e) => setJudgeModel(e.target.value)}
                  placeholder="e.g. gemini-flash-latest"
                  className="mt-1.5 font-mono text-sm"
                  data-testid="judge-model-custom"
                />
              )}
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

        <DialogFooter className="flex items-center justify-between sm:justify-between">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              data-testid="judge-config-cancel"
            >
              Cancel
            </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
