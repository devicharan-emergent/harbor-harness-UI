import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getEvalLiveResults, getEvalLlmCalls, getEvalLlmCallDetail } from '@/services/evalApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2, CheckCircle, XCircle, AlertTriangle, MinusCircle, ChevronDown, ActivitySquare, MessageSquare,
} from 'lucide-react';

const POLL_MS = 4000;

const resultKey = (r) => `${r.phase_index}-${r.test_index}-${r.replay_index ?? 0}`;

const STATUS_META = {
  running: { Icon: Loader2, cls: 'text-blue-500', badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20', spin: true, label: 'running' },
  pass: { Icon: CheckCircle, cls: 'text-emerald-500', badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', label: 'pass' },
  fail: { Icon: XCircle, cls: 'text-rose-500', badge: 'bg-rose-500/10 text-rose-600 border-rose-500/20', label: 'fail' },
  error: { Icon: AlertTriangle, cls: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground border-border', label: 'error' },
  skip: { Icon: MinusCircle, cls: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground border-border', label: 'skip' },
  cancelled: { Icon: MinusCircle, cls: 'text-amber-500', badge: 'bg-amber-500/10 text-amber-600 border-amber-500/20', label: 'cancelled' },
};

function StatusChip({ status, testId }) {
  const meta = STATUS_META[status] || STATUS_META.skip;
  const { Icon } = meta;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${meta.badge}`} data-testid={testId}>
      <Icon className={`w-3 h-3 ${meta.cls} ${meta.spin ? 'animate-spin' : ''}`} />
      {meta.label}
    </Badge>
  );
}

function CallDetailDialog({ jobId, call, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!call) return;
    setDetail(null);
    setLoading(true);
    getEvalLlmCallDetail(jobId, call.id)
      .then(setDetail)
      .catch(() => setDetail({ _error: true }))
      .finally(() => setLoading(false));
  }, [jobId, call]);

  const messages = detail?.request_body?.messages;

  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="llm-call-detail-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            LLM Call — {call?.model} · seq {call?.call_seq}
          </DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading transcript…
          </div>
        )}
        {detail?._error && (
          <div className="text-xs text-rose-600 py-4">Failed to load call detail.</div>
        )}
        {detail && !detail._error && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold mb-1.5">Request ({messages?.length || 0} messages)</p>
              <div className="space-y-2">
                {Array.isArray(messages) ? messages.map((m, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2" data-testid={`llm-call-message-${i}`}>
                    <div className="text-[10px] font-mono uppercase text-violet-600 dark:text-violet-400 mb-1">{m.role}</div>
                    <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-foreground/80 max-h-60 overflow-y-auto">
                      {typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)}
                    </pre>
                  </div>
                )) : (
                  <pre className="text-[11px] whitespace-pre-wrap break-words font-mono bg-muted/30 p-2 rounded-md">{JSON.stringify(detail.request_body, null, 2)}</pre>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1.5">Raw response</p>
              <pre className="text-[11px] whitespace-pre-wrap break-words font-mono bg-muted/30 p-2 rounded-md max-h-80 overflow-y-auto" data-testid="llm-call-response-body">
                {JSON.stringify(detail.response_body, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LiveEvalResults({ jobId, active }) {
  const [results, setResults] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [openCall, setOpenCall] = useState(null);
  const resultsMap = useRef(new Map());
  const callsMap = useRef(new Map());

  const poll = useCallback(async () => {
    const [lr, lc] = await Promise.allSettled([
      getEvalLiveResults(jobId),
      getEvalLlmCalls(jobId),
    ]);
    if (lr.status === 'fulfilled' && Array.isArray(lr.value?.results)) {
      for (const r of lr.value.results) {
        const k = resultKey(r);
        resultsMap.current.set(k, { ...resultsMap.current.get(k), ...r });
      }
      setResults(Array.from(resultsMap.current.values()));
    }
    if (lc.status === 'fulfilled' && Array.isArray(lc.value?.llm_calls)) {
      for (const c of lc.value.llm_calls) {
        callsMap.current.set(c.id, { ...callsMap.current.get(c.id), ...c });
      }
      setCalls(Array.from(callsMap.current.values()));
    }
    setLoadedOnce(true);
  }, [jobId]);

  useEffect(() => {
    // Always fetch once so terminal jobs (including cancelled) render their
    // test cases from live-results; only keep polling while the job is active.
    poll();
    if (!active) return undefined;
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [active, poll]);

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) =>
      (a.phase_index - b.phase_index) ||
      (a.test_index - b.test_index) ||
      ((a.replay_index ?? 0) - (b.replay_index ?? 0)),
    );
  }, [results]);

  // Group by phase_index (ascending); rows within a phase stay ordered by
  // test_index thanks to sortedResults.
  const phaseGroups = useMemo(() => {
    const m = new Map();
    for (const r of sortedResults) {
      if (!m.has(r.phase_index)) m.set(r.phase_index, []);
      m.get(r.phase_index).push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [sortedResults]);
  const multiPhase = phaseGroups.length > 1;

  // Calls grouped by (phase_index, test_index)
  const callsByTest = useMemo(() => {
    const m = new Map();
    for (const c of calls) {
      const k = `${c.phase_index}-${c.test_index}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.call_seq ?? 0) - (b.call_seq ?? 0));
    return m;
  }, [calls]);

  const total = sortedResults.length;
  const doneCount = sortedResults.filter(r => r.status && r.status !== 'running').length;
  const passCount = sortedResults.filter(r => r.status === 'pass').length;
  const failCount = sortedResults.filter(r => r.status === 'fail').length;
  const isEmpty = total === 0 && calls.length === 0;

  // Terminal job with nothing to show → render nothing (don't leave an empty
  // card). Running jobs keep the waiting/loading affordances below.
  if (loadedOnce && isEmpty && !active) return null;

  return (
    <Card data-testid="live-eval-results-card" className="border-blue-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ActivitySquare className="w-4 h-4 text-blue-500" />
          Test Cases
          {active && (
            <span className="ml-1 flex items-center gap-1 text-[10px] font-normal text-blue-500">
              <Loader2 className="w-3 h-3 animate-spin" /> live
            </span>
          )}
          {total > 0 && (
            <span className="ml-auto text-xs font-normal text-muted-foreground" data-testid="live-results-header">
              {doneCount}/{total} done
              {passCount > 0 && <span className="text-emerald-600"> · {passCount} passed</span>}
              {failCount > 0 && <span className="text-rose-600"> · {failCount} failed</span>}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loadedOnce && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {loadedOnce && isEmpty && active && (
          <div className="text-xs text-muted-foreground py-4 text-center" data-testid="live-results-waiting">
            Waiting for tests to start… (the browser phase hasn&apos;t begun yet)
          </div>
        )}
        {phaseGroups.map(([phaseIndex, rows]) => (
          <div key={phaseIndex} className="space-y-2" data-testid={`live-phase-group-${phaseIndex}`}>
            {multiPhase && (
              <div className="text-[11px] font-semibold text-muted-foreground px-1" data-testid={`live-phase-header-${phaseIndex}`}>
                Phase {phaseIndex + 1}
              </div>
            )}
            {rows.map((r) => {
              const tkey = `${r.phase_index}-${r.test_index}`;
              const testCalls = callsByTest.get(tkey) || [];
              return (
                <Collapsible key={resultKey(r)} className="rounded-md border" data-testid={`live-test-row-${r.phase_index}-${r.test_index}-${r.replay_index ?? 0}`}>
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
                    <StatusChip status={r.status} testId={`live-test-status-${r.phase_index}-${r.test_index}-${r.replay_index ?? 0}`} />
                    <span className="text-xs font-medium truncate flex-1" title={r.test_name || ''}>
                      {(r.test_name || `test ${r.test_index}`).split('\n')[0]}
                      {r.replay_index ? <span className="text-muted-foreground"> · replay {r.replay_index}</span> : null}
                    </span>
                    {(r.pass_cases != null && r.total_cases != null) && (
                      <span className="text-[10px] font-mono text-muted-foreground" data-testid={`live-test-cases-${r.phase_index}-${r.test_index}`}>{r.pass_cases}/{r.total_cases} cases</span>
                    )}
                    {testCalls.length > 0 && (
                      <Badge variant="outline" className="text-[9px] font-mono">{testCalls.length} call{testCalls.length === 1 ? '' : 's'}</Badge>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-2">
                    {(r.test_name && r.test_name.includes('\n')) && (
                      <pre className="text-[10px] whitespace-pre-wrap break-words font-mono text-muted-foreground bg-muted/30 rounded p-2 mt-1 mb-2 max-h-48 overflow-y-auto">{r.test_name}</pre>
                    )}
                    {testCalls.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground py-1">No LLM calls recorded yet.</p>
                    ) : (
                      <div className="space-y-1 pt-1">
                        {testCalls.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setOpenCall(c)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-accent text-left"
                            data-testid={`live-llm-call-${c.id}`}
                          >
                            <span className="font-mono text-muted-foreground w-8 flex-shrink-0">#{c.call_seq}</span>
                            <span className="font-mono truncate flex-1">{c.model}</span>
                            <Badge variant="outline" className={`text-[9px] ${c.status === 'ok' || c.status === 'pass' ? 'text-emerald-600' : c.status === 'running' ? 'text-blue-600' : 'text-rose-600'}`}>{c.status}</Badge>
                            <span className="font-mono text-muted-foreground flex-shrink-0">
                              {(c.prompt_tokens ?? 0).toLocaleString()}→{(c.completion_tokens ?? 0).toLocaleString()} tok
                            </span>
                            {c.latency_ms != null && (
                              <span className="font-mono text-muted-foreground flex-shrink-0">{(c.latency_ms / 1000).toFixed(1)}s</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        ))}
      </CardContent>
      <CallDetailDialog jobId={jobId} call={openCall} onClose={() => setOpenCall(null)} />
    </Card>
  );
}
