import { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { getEphReadiness, parseCortexError } from '@/services/cortexApi';

// Reusable eph picker with live readiness gate. Used by RunEvalModal (now) and
// ScheduleEditor (fast-follow). Replaces free-text URL inputs — the whole
// point is that humans never paste a URL that's silently rotted.
//
// Props:
//   value: the eph name currently selected (controlled).
//   onChange(name): user typed in the input (no probe yet).
//   onReadiness(readinessObj | null): called whenever a readiness probe
//     resolves. Parent uses this to enable/disable submit. `null` means
//     "not yet probed for the current input" — parent should treat as not ready.
//   defaultValue: optional seed for the input on first mount.
//
// The readiness contract (built against the spec'd stub):
//   { eph, db, emergent, cortex, ready, emergent_url, cortex_url, message }
export function EphPicker({ value, onChange, onReadiness, defaultValue = '' }) {
  const [input, setInput] = useState(defaultValue || value || '');
  const [probing, setProbing] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [error, setError] = useState(null);

  // Keep input synced if parent updates `value` programmatically.
  useEffect(() => { if (value && value !== input) setInput(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const probe = useCallback(async (name) => {
    if (!name) return;
    setProbing(true);
    setError(null);
    setReadiness(null);
    onReadiness?.(null);
    try {
      const data = await getEphReadiness(name);
      setReadiness(data);
      onReadiness?.(data);
    } catch (err) {
      const e = parseCortexError(err);
      setError(e);
      onReadiness?.(null);
    } finally {
      setProbing(false);
    }
  }, [onReadiness]);

  const handleConnect = (e) => {
    e?.preventDefault?.();
    const name = input.trim();
    if (!name) return;
    onChange?.(name);
    probe(name);
  };

  const handleRefresh = () => { if (value) probe(value); };

  // ---------- helpers for readiness badge ----------

  const Dot = ({ ok, label, testid }) => (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono ${
        ok === undefined ? 'text-muted-foreground' :
        ok ? 'text-emerald-600 dark:text-emerald-400' :
        'text-red-600 dark:text-red-400'
      }`}
      data-testid={testid}
    >
      {ok === true && <CheckCircle2 className="w-3 h-3" />}
      {ok === false && <XCircle className="w-3 h-3" />}
      {ok === undefined && <span className="w-3 h-3 inline-block" />}
      {label} {ok === true ? '✓' : ok === false ? '✗' : '·'}
    </span>
  );

  // ----------------- render -----------------

  const showBadge = readiness && (readiness.eph === value || readiness.eph === input.trim());

  return (
    <div className="space-y-2" data-testid="eph-picker">
      <form onSubmit={handleConnect} className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[260px] max-w-md">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter eph name (e.g. preview-7)"
            className="h-8 text-xs font-mono"
            disabled={probing}
            data-testid="eph-picker-input"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-8 gap-1.5"
          disabled={probing || !input.trim()}
          data-testid="eph-picker-connect-btn"
        >
          {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Check readiness
        </Button>
        {value && readiness && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleRefresh}
            title="Re-probe"
            disabled={probing}
            data-testid="eph-picker-refresh-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </form>

      {/* Readiness badge */}
      {showBadge && (
        <div
          className={`rounded-md border px-3 py-2 space-y-1 ${
            readiness.ready
              ? 'border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20'
              : 'border-red-500/30 bg-red-50/40 dark:bg-red-950/20'
          }`}
          data-testid="eph-picker-readiness"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <Badge
              variant="outline"
              className={`text-[10px] font-mono ${
                readiness.ready ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                : 'border-red-500/40 text-red-600 dark:text-red-400'
              }`}
            >
              {readiness.eph}
            </Badge>
            <Dot ok={readiness.db}       label="DB"       testid="eph-readiness-db" />
            <Dot ok={readiness.emergent} label="emergent" testid="eph-readiness-emergent" />
            <Dot ok={readiness.cortex}   label="cortex"   testid="eph-readiness-cortex" />
            {readiness.ready ? (
              <span className="ml-auto text-[10px] text-emerald-700 dark:text-emerald-300">Ready to submit</span>
            ) : (
              <span className="ml-auto text-[10px] text-red-700 dark:text-red-300">Cannot submit</span>
            )}
          </div>
          {!readiness.ready && readiness.message && (
            <p className="text-[11px] text-foreground/80 leading-relaxed" data-testid="eph-readiness-message">
              {readiness.message}
            </p>
          )}
        </div>
      )}

      {/* Probe error (network / 500 etc.) */}
      {error && (
        <div
          className="flex items-start gap-2 text-xs rounded-md border border-red-500/30 bg-red-50/40 dark:bg-red-950/20 px-3 py-2"
          data-testid="eph-picker-error"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-red-700 dark:text-red-300 font-medium">Readiness probe failed</p>
            <p className="text-foreground/70 break-words mt-0.5 font-mono text-[11px]">{error.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default EphPicker;
