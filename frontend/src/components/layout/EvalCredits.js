import { useState, useEffect, useCallback } from 'react';
import { Coins, Loader2, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { authAxios, useAuth } from '@/contexts/AuthContext';

const LOW_BALANCE = 2000;

const fmt = (n) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';

// Compact, read-only "Eval credits" indicator shown to any signed-in user.
// Calls GET /api/credits via the shared authAxios instance and degrades
// gracefully — it never throws, toasts, or blocks the page. Non-admins get a
// 403 from the backend and simply see "unavailable".
export function EvalCredits() {
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await authAxios.get('/credits');
      setData(res.data || null);
    } catch {
      // 403 (not admin), 404 (endpoint rolling out), network — all degrade silently.
      setErrored(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchCredits();
  }, [user, fetchCredits]);

  if (!user) return null;

  const available = data?.available === true;
  const ecu = available ? data.ecu : null;
  const low = available && Number.isFinite(ecu) && ecu < LOW_BALANCE;
  const negative = available && Number.isFinite(ecu) && ecu <= 0;
  const valueColor = negative
    ? 'text-rose-600 dark:text-rose-400'
    : low
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="px-2.5 py-2 rounded-md w-full hover:bg-[hsl(var(--accent)/0.4)] transition-colors"
            data-testid="eval-credits-indicator"
          >
            {/* Label row */}
            <div className="flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Eval credits
              </span>
              <button
                type="button"
                onClick={fetchCredits}
                disabled={loading}
                aria-label="Refresh eval credits"
                className="ml-auto text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                data-testid="eval-credits-refresh"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {/* Value row — aligned under the label */}
            <div className="pl-[1.375rem] mt-0.5">
              {loading ? (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="eval-credits-loading">
                  <Loader2 className="w-3 h-3 animate-spin" /> loading…
                </span>
              ) : available ? (
                <span className="flex items-baseline gap-1" data-testid="eval-credits-value">
                  <span className={`text-base font-semibold leading-none tabular-nums ${valueColor}`}>{fmt(ecu)}</span>
                  <span className="text-[10px] font-medium text-muted-foreground tracking-wide">ECU</span>
                  {low && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" aria-hidden />}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground italic" data-testid="eval-credits-unavailable">
                  unavailable
                </span>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {available ? (
            <>
              <p>Spendable balance: <span className="font-mono">{fmt(ecu)} ECU</span></p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Total incl. monthly/daily: <span className="font-mono">{fmt(data.total)} ECU</span>
              </p>
              {low && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">Low balance</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              {errored ? 'Credits unavailable right now.' : (data?.reason || 'Credits data not available yet.')}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
