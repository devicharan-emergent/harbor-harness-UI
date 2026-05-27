import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Plug } from 'lucide-react';
import { checkEphExists, parseCortexError } from '@/services/cortexApi';

// Connect form + state badge. Confirms an eph exists before any CRUD is enabled.
// `value` is the connected eph name (or '' if not connected). `onConnect(name)` is
// called on success; `onDisconnect()` clears the connection.
export function EphGate({ value, onConnect, onDisconnect, defaultInput = '' }) {
  const [input, setInput] = useState(defaultInput || value || '');
  const [checking, setChecking] = useState(false);
  // Result of last connect attempt for this input value.
  const [status, setStatus] = useState(null); // { ok: bool, message: string, code?: string }

  // If parent updates `value` (e.g. URL changed), reflect it.
  useEffect(() => {
    if (value) setInput(value);
  }, [value]);

  const handleConnect = async (e) => {
    e?.preventDefault?.();
    const name = input.trim();
    if (!name) return;
    setChecking(true);
    setStatus(null);
    try {
      const data = await checkEphExists(name);
      if (data?.exists) {
        setStatus({ ok: true, message: `Connected to ${name}` });
        onConnect(name);
      } else {
        setStatus({ ok: false, message: `No eph named "${name}"`, code: 'not_found' });
        if (value) onDisconnect();
      }
    } catch (err) {
      const e = parseCortexError(err);
      setStatus({ ok: false, message: e.message, code: e.code, status: e.status });
      if (value) onDisconnect();
    } finally {
      setChecking(false);
    }
  };

  const isConnected = Boolean(value) && status?.ok && value === input.trim();

  return (
    <div className="space-y-2" data-testid="cortex-eph-gate">
      <form onSubmit={handleConnect} className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[260px] max-w-md">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter eph name (e.g. preview-7)"
            className="h-8 text-xs font-mono"
            data-testid="cortex-eph-input"
            disabled={checking}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-8 gap-1.5"
          disabled={checking || !input.trim()}
          data-testid="cortex-eph-connect-btn"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          {isConnected ? 'Reconnect' : 'Connect'}
        </Button>

        {isConnected && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => { onDisconnect(); setStatus(null); }}
            data-testid="cortex-eph-disconnect-btn"
          >
            Disconnect
          </Button>
        )}

        {isConnected && (
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400 gap-1"
            data-testid="cortex-eph-connected-badge"
          >
            <CheckCircle2 className="w-3 h-3" />
            {value}
          </Badge>
        )}
      </form>

      {status && !status.ok && (
        <div
          className="flex items-start gap-2 text-xs rounded-md border border-red-500/30 bg-red-50/40 dark:bg-red-950/20 px-3 py-2"
          data-testid="cortex-eph-error"
        >
          {status.status >= 500 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-red-700 dark:text-red-300 font-medium">
              {status.code === 'invalid_request' ? 'Invalid eph name' :
               status.code === 'not_found' ? 'Eph not found' :
               status.status >= 500 ? 'Harness error' : 'Connect failed'}
            </p>
            <p className="text-foreground/70 break-words mt-0.5 font-mono text-[11px]">
              {status.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default EphGate;
