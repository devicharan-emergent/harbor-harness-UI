import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Save } from 'lucide-react';

// Build a unified diff of two YAML buffers, line-level. We avoid pulling in a
// dep — this is a Myers-light implementation that is good enough for visual
// diff and renders <100 lines anyway. For larger files the visual jumps
// straight to the changed regions via context windows.
function computeDiff(a, b) {
  const aLines = (a || '').split(/\r?\n/);
  const bLines = (b || '').split(/\r?\n/);
  // LCS table
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ kind: 'ctx', text: aLines[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: 'del', text: aLines[i] }); i += 1; }
    else { ops.push({ kind: 'add', text: bLines[j] }); j += 1; }
  }
  while (i < n) { ops.push({ kind: 'del', text: aLines[i] }); i += 1; }
  while (j < m) { ops.push({ kind: 'add', text: bLines[j] }); j += 1; }
  return ops;
}

// Collapse long context runs to keep the diff readable; show 3 lines of
// context around each hunk.
function collapseContext(ops, ctx = 3) {
  const out = [];
  for (let k = 0; k < ops.length; k += 1) {
    const op = ops[k];
    if (op.kind !== 'ctx') { out.push(op); continue; }
    // Look ahead for a run of ctx ops.
    let end = k;
    while (end + 1 < ops.length && ops[end + 1].kind === 'ctx') end += 1;
    const runLen = end - k + 1;
    if (runLen <= ctx * 2 + 1) {
      for (let q = k; q <= end; q += 1) out.push(ops[q]);
    } else {
      for (let q = k; q < k + ctx; q += 1) out.push(ops[q]);
      out.push({ kind: 'gap', text: `… ${runLen - ctx * 2} unchanged lines …` });
      for (let q = end - ctx + 1; q <= end; q += 1) out.push(ops[q]);
    }
    k = end;
  }
  return out;
}

export function DiffConfirmModal({ open, onClose, oldYaml, newYaml, onConfirm, saving, agentId, isCreate }) {
  const diff = useMemo(() => collapseContext(computeDiff(oldYaml, newYaml)), [oldYaml, newYaml]);
  const adds = diff.filter((d) => d.kind === 'add').length;
  const dels = diff.filter((d) => d.kind === 'del').length;
  const noChange = adds === 0 && dels === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] p-0 overflow-hidden flex flex-col" data-testid="cortex-agent-diff-modal">
        <DialogHeader className="px-6 pt-6 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-base">
              {isCreate ? 'Create agent' : 'Save changes'} — review diff
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] font-mono">{agentId}</Badge>
              {!isCreate && (
                <>
                  <Badge variant="outline" className="text-[10px] font-mono text-emerald-600 border-emerald-500/40">+{adds}</Badge>
                  <Badge variant="outline" className="text-[10px] font-mono text-red-600 border-red-500/40">−{dels}</Badge>
                </>
              )}
            </div>
          </div>
          <DialogDescription className="text-xs">
            {isCreate
              ? 'New YAML to be written. Saved YAML is structurally checked only — full validation runs at eval time.'
              : 'Review the changes about to be written to ' }
            {!isCreate && <span className="font-mono">cortex_&lt;eph&gt;.agent_definitions[{agentId}]</span>}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6">
          {isCreate ? (
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 p-3" data-testid="diff-create-body">
              {newYaml}
            </pre>
          ) : noChange ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center" data-testid="diff-no-change">
              No changes to save.
            </p>
          ) : (
            <div className="rounded-md border border-border/40 bg-background/40 font-mono text-[11px] leading-relaxed overflow-x-auto">
              {diff.map((op, idx) => {
                const cls =
                  op.kind === 'add' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                  op.kind === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-300' :
                  op.kind === 'gap' ? 'text-muted-foreground italic' :
                  'text-foreground/70';
                const prefix = op.kind === 'add' ? '+ ' : op.kind === 'del' ? '- ' : op.kind === 'gap' ? '  ' : '  ';
                return (
                  <div key={idx} className={`px-3 ${cls}`} data-testid={`diff-line-${op.kind}`}>
                    <span className="select-none opacity-60">{prefix}</span>
                    <span className="whitespace-pre">{op.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={onConfirm}
            disabled={saving || (!isCreate && noChange)}
            data-testid="cortex-agent-diff-confirm-btn"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            {isCreate ? 'Create' : 'Confirm save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DiffConfirmModal;
