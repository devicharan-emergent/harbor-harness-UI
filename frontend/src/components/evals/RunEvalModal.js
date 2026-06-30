import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { listDatasetsByType, getDatasetForProblem, submitEvalJobs, submitEvalJobsWithEs, submitTestingAgentEval, checkAgentExists, getVerifierConfig, getDatasetView, listEvalAgents } from '@/services/evalApi';
import { listAgents } from '@/services/cortexApi';
import { agentApi } from '@/lib/api';
import { useCreatedBy } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Rocket, FileText, Search, ChevronRight, Check, AlertCircle, X, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { parseApiError } from '@/lib/errorUtils';
import { useEnv } from '@/components/layout/EnvSwitcher';
import { EphPicker } from '@/components/cortex/EphPicker';
import { ModelNamePicker } from './ModelNamePicker';
import { AgentMultiSelect } from './AgentMultiSelect';
import { Combobox } from '@/components/ui/combobox';
import { JudgeConfigDialog } from './JudgeConfigDialog';
import { DatasetViewsDropdown } from '@/components/datasets/DatasetViewsDropdown';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'wingman_bench', label: 'Wingman Bench' },
];

// Resource sizing — formerly user-tweakable per-run. The UI was removed
// (overwhelming + nobody changed the defaults), so we lock the previous
// defaults in as constants and still ship them in the payload so harness
// behaviour stays identical.
const DEFAULT_CPUS = 2;
const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_STORAGE_GB = 10;

// ── Helpers ───────────────────────────────────────────────────────────
const decode = (s) =>
  String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

// Parse <phases><phase>...</phase></phases> (problem_statement, scratch_bench_phased)
const parsePhasesProblem = (xml) => {
  if (!xml) return [];
  const out = [];
  const re = /<phase\b[^>]*>([\s\S]*?)<\/phase>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decode(m[1]).trim());
  return out;
};

// Parse <phases><phase><test_cases><test_case>...</test_case></test_cases></phase></phases>
// → array of arrays (one per phase) of test case strings
const parsePhasesTests = (xml) => {
  if (!xml) return [];
  const phases = [];
  const phaseRe = /<phase\b[^>]*>([\s\S]*?)<\/phase>/gi;
  const caseRe = /<test_case\b[^>]*>([\s\S]*?)<\/test_case>/gi;
  let pm;
  while ((pm = phaseRe.exec(xml)) !== null) {
    const body = pm[1];
    const tests = [];
    let tm;
    while ((tm = caseRe.exec(body)) !== null) tests.push(decode(tm[1]).trim());
    phases.push(tests);
  }
  return phases;
};

// Parse flat <test_cases><test_case>...</test_case></test_cases> (bug_bench / test_report_bench)
const parseFlatTests = (xml) => {
  if (!xml) return [];
  const out = [];
  const re = /<test_case\b[^>]*>([\s\S]*?)<\/test_case>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decode(m[1]).trim());
  return out;
};

// bug_bench: harness exposes `attributes.image_available` as an explicit
// boolean. Three states:
//   true  → image in registry, runnable (green)
//   false → no image yet, needs a build (red)
//   undef → field hasn't been backfilled for this row (no indicator)
const bugBenchImageState = (ds) => {
  if (ds?.dataset_type !== 'bug_bench') return null;
  const v = ds?.attributes?.image_available;
  if (v === true) return 'ready';
  if (v === false) return 'missing';
  return null;
};

const isBugBenchMissingImage = (ds) => bugBenchImageState(ds) === 'missing';

// ── Problem preview ──────────────────────────────────────────────────
function ProblemPreview({ ds }) {
  if (!ds) return null;
  const type = ds.dataset_type || ds.name?.split('/')[0];
  const missingImage = isBugBenchMissingImage(ds);

  // Structured body per type
  let body = null;
  if (type === 'scratch_bench_phased') {
    const phases = parsePhasesProblem(ds.problem_statement || '');
    const tests = parsePhasesTests(ds.natural_language_tests || '');
    const n = Math.max(phases.length, tests.length);
    if (n === 0) {
      body = (
        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
          {ds.problem_statement || 'No problem statement.'}
        </pre>
      );
    } else {
      body = (
        <div className="space-y-3">
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="rounded-md border bg-muted/20 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-mono flex-shrink-0">
                  #{i + 1}
                </Badge>
                <span className="text-xs font-semibold">Phase {i + 1}</span>
              </div>
              {phases[i] && (
                <div>
                  <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Problem</div>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/80 mt-0.5">
                    {phases[i]}
                  </pre>
                </div>
              )}
              {(tests[i] || []).length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Test cases ({tests[i].length})
                  </div>
                  <ol className="mt-0.5 space-y-1 list-decimal list-inside text-[11px] font-mono text-foreground/80">
                    {tests[i].map((t, j) => (
                      <li key={j} className="whitespace-pre-wrap break-words">{t}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
  } else {
    // bug_bench, test_report_bench, and anything else: flat problem + flat tests + attrs
    const tests = parseFlatTests(ds.natural_language_tests || '');
    const attrs = ds.attributes || {};
    const attrEntries = Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== '');
    body = (
      <div className="space-y-3">
        {ds.problem_statement && (
          <div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Problem</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/80 mt-0.5">
              {ds.problem_statement}
            </pre>
          </div>
        )}
        {tests.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
              Test cases ({tests.length})
            </div>
            <ol className="mt-0.5 space-y-1 list-decimal list-inside text-[11px] font-mono text-foreground/80">
              {tests.map((t, j) => (
                <li key={j} className="whitespace-pre-wrap break-words">{t}</li>
              ))}
            </ol>
          </div>
        )}
        {attrEntries.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Attributes</div>
            <div className="mt-1 rounded-md border bg-muted/20">
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {attrEntries.map(([k, v]) => (
                    <tr key={k} className="border-b last:border-b-0">
                      <td className="px-2 py-1 text-muted-foreground w-[110px] align-top break-all">{k}</td>
                      <td className="px-2 py-1 break-all">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="problem-preview">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Problem</h4>
        <p className="font-mono text-xs mt-1 font-medium break-all">{ds.name}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant="outline" className="text-[10px] font-mono">{type}</Badge>
          {ds.version && <Badge variant="outline" className="text-[10px] font-mono">v{ds.version}</Badge>}
        </div>
      </div>

      {missingImage && (
        <div
          className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-2.5 py-2 text-[11px]"
          data-testid="preview-missing-image-warning"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Image not available.</strong> This bug_bench problem&apos;s base image
            isn&apos;t in the registry yet (<code className="font-mono">attributes.image_available = false</code>).
            A build is required before it can run end-to-end.
          </span>
        </div>
      )}

      <Separator />
      {body}
    </div>
  );
}

// Surfaces the active verifier (browser or judge) that will be sent with
// the run. A "custom" config (is_default === false) shows its model + an
// expandable prompt; otherwise we note the harness default is used.
function VerifierReview({ label, config, testId }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const custom = config && config.is_default === false;
  const model = config?.model;
  const prompt = config?.prompt;
  if (!config) return null;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{label}</span>
        {custom ? (
          <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20">custom — sent with run</Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] text-muted-foreground">harness default</Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Model:</span>
        <Badge variant="secondary" className="font-mono text-[10px]" data-testid={`${testId}-model`}>
          {model || '—'}
        </Badge>
      </div>
      <div className="flex items-start gap-1.5">
        <span className="text-muted-foreground">Prompt:</span>
        {prompt ? (
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setShowPrompt(v => !v)}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              data-testid={`${testId}-prompt-toggle`}
            >
              view · {prompt.length.toLocaleString()} chars
              <ChevronDown className={`w-3 h-3 transition-transform ${showPrompt ? 'rotate-180' : ''}`} />
            </button>
            {showPrompt && (
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background border p-2 font-mono text-[10px] text-foreground/80" data-testid={`${testId}-prompt-text`}>
                {prompt}
              </pre>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {!custom && (
        <p className="text-[10px] text-muted-foreground">
          This is the default config — the harness applies its built-in {label.toLowerCase()}; these values are not sent explicitly.
        </p>
      )}
    </div>
  );
}


// ── Main Modal ────────────────────────────────────────────────────────
// `initialEph` + `initialAgentName` are used by deep-link entry points
// (e.g. Cortex Agents → "Open in eval"). When set, the modal opens with
// the eph picker + agent override pre-filled, so the user only has to
// choose problems + a group id and submit.
export function RunEvalModal({ open, onClose, initialEph = '', initialAgentName = '', initialViewId = '' }) {
  const navigate = useNavigate();
  const { cortexUrl: envCortexUrl } = useEnv();
  const [step, setStep] = useState(1); // 1: problems, 2: configure, 3: review

  // Problem selection
  const [searchQuery, setSearchQuery] = useState('');
  const [datasetType, setDatasetType] = useState('all');
  const [datasets, setDatasets] = useState([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectedProblems, setSelectedProblems] = useState([]);

  // Loaded dataset views (multi-select supported). Each entry is the
  // full view document (with `items[]`). Selection in the modal is the
  // UNION of every loaded view + any manual picks. Removing a view chip
  // drops that view from the chip strip but does NOT auto-deselect its
  // items — the user can deselect manually if they want.
  const [activeViews, setActiveViews] = useState([]);
  const [loadingView, setLoadingView] = useState(false);

  // Group ID (mandatory tag for batch jobs)
  const [groupName, setGroupName] = useState('');
  const [groupComment, setGroupComment] = useState('');

  // Headed/build toggles still surfaced — they meaningfully change run
  // behaviour. (Resources UI was retired; defaults locked in above.)
  const [headed, setHeaded] = useState(true);
  const [forceBuild, setForceBuild] = useState(false);

  // Authenticated user — the harness uses email-as-identity ever since
  // it migrated off the UUID user_id. We auto-stamp this into the eval
  // payload's `user_id` field; there is no per-run override UI.
  const loggedInUserId = useCreatedBy();

  // Experiment config — only Model + group Comment kept. Image / Cortex
  // URL / collapsible were retired in this change (set was overwhelming
  // and never tweaked in practice).
  const [expModelName, setExpModelName] = useState('');

  // Eph-driven submission. When an eph is selected the backend derives
  // emergent_agents_url + per-eval cortex_url server-side and re-runs
  // readiness preflight.

  // testing_agent_bench fork-eval mode. When every selected problem is
  // testing_agent_bench, we hide infra fields (CPUs/Memory/Storage, Target
  // eph, Template, batch agent override) and POST one body per problem to
  // a different harness endpoint (/api/v1/testing-agent-evals). Mixed
  // selections (some testing_agent_bench + some scratch/bug) are blocked
  // at submit-time with an inline error.
  const testingAgentSelections = useMemo(
    () => selectedProblems.filter((p) => p.dataset_type === 'testing_agent_bench'),
    [selectedProblems]
  );
  const isTestingAgentMode = useMemo(
    () =>
      selectedProblems.length > 0 &&
      testingAgentSelections.length === selectedProblems.length,
    [selectedProblems.length, testingAgentSelections.length]
  );
  const hasMixedTypes = useMemo(
    () =>
      testingAgentSelections.length > 0 &&
      testingAgentSelections.length !== selectedProblems.length,
    [testingAgentSelections.length, selectedProblems.length]
  );

  const [submitEph, setSubmitEph] = useState('');
  // null = not yet probed; otherwise the readiness object from the API.
  const [submitEphReadiness, setSubmitEphReadiness] = useState(null);

  // Agent registry. Two sources merge into the Agent Name combobox so it
  // always has something to show:
  //   1) `prodAgents` — pulled from /api/agents on modal open. This is the
  //      canonical "all agents in production" catalog, eph-independent.
  //   2) `ephAgents`  — pulled from listAgents(submitEph) when the user
  //      picks an eph. Drives the combobox when an eph is selected so
  //      users only see what's actually resolvable on that runner.
  // Model presets are derived from `prodAgents` (`.model.model_id`) so the
  // Model combobox stays in sync with what's actually deployable.
  const [prodAgents, setProdAgents] = useState([]);
  const [ephAgents, setEphAgents] = useState([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await agentApi.list();
        if (cancelled) return;
        setProdAgents(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setProdAgents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!submitEph) {
      setEphAgents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await listAgents(submitEph);
        if (cancelled) return;
        const ids = (data?.agents || [])
          .map((a) => a?.agent_id)
          .filter((id) => typeof id === 'string' && id);
        setEphAgents(Array.from(new Set(ids)));
      } catch {
        if (!cancelled) setEphAgents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [submitEph]);

  // Effective agent option list: prefer eph-scoped when present, else
  // production catalog (id field on /api/agents is the canonical agent id).
  const agentOptions = useMemo(() => {
    if (ephAgents.length > 0) return ephAgents;
    return Array.from(new Set(prodAgents.map(a => a?.id).filter(Boolean)));
  }, [ephAgents, prodAgents]);

  // Model option list derived from production agents. Dedupe across the
  // catalog so the same `model.model_id` only shows once even if many
  // agents share it. Empty array → ModelNamePicker falls back to its
  // built-in MODEL_NAME_PRESETS constant.
  const modelOptions = useMemo(() => {
    const ids = prodAgents
      .map(a => a?.model?.model_id)
      .filter((m) => typeof m === 'string' && m);
    return Array.from(new Set(ids));
  }, [prodAgents]);

  // Template
  const [templateName, setTemplateName] = useState('');

  // Free-text agent_name override — sent at the batch level when set.
  const [agentNameOverride, setAgentNameOverride] = useState('');

  // Multi-agent selection (standard/non-testing-agent flow). Agents come
  // from the harness catalog (GET /api/eval/agents). Submitted as
  // `agent_names: string[]` → the harness fans out one job per agent×problem.
  const [evalAgents, setEvalAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState([]);

  // testing_agent_bench multi-agent selection (agent NAME strings). Defaults
  // to the distinct agent_names baked into the selected datasets; the user
  // can add/remove agents (catalog from GET /api/eval/agents). Each selected
  // agent runs against every selected dataset (agents × datasets jobs).
  const [taAgentNames, setTaAgentNames] = useState([]);
  const [taAgentsTouched, setTaAgentsTouched] = useState(false);
  // Agent objects keyed so the testing-agent multi-select can use NAME as the
  // identity (agent_name is a name string, not the catalog id). De-duped by
  // name — the harness catalog returns some agent_names more than once.
  const evalAgentsByName = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const a of evalAgents) {
      const id = a.name || a.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...a, id });
    }
    return out;
  }, [evalAgents]);

  const fetchEvalAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const data = await listEvalAgents();
      setEvalAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch (err) {
      setAgentsError(err);
      setEvalAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  // testing_agent_bench per-run model_name override. Pre-fills from the
  // selected dataset's `attributes.model_name` when entering Step 2, but
  // any user edit (incl. clearing) wins and is sent in the per-eval body.
  // We never mutate the dataset itself.
  const [modelNameOverride, setModelNameOverride] = useState('');
  const [modelOverrideTouched, setModelOverrideTouched] = useState(false);

  // Number of times to repeat the eval. Each run gets a distinct
  // `group_run_id` suffix `-run-1` / `-run-2` / … so the harness sees N
  // distinct groups. Default = 1 (no suffix, original behaviour).
  const NUM_RUNS_MAX = 10;
  // Stored as a raw string so the input can be freely edited (backspace,
  // empty, typing partial values). Clamped to [1..NUM_RUNS_MAX] only
  // on submit (and onBlur, for the visible value).
  const [numRunsRaw, setNumRunsRaw] = useState('1');
  const numRuns = useMemo(() => {
    const n = Math.trunc(Number(numRunsRaw));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(NUM_RUNS_MAX, n);
  }, [numRunsRaw]);
  // Progress indicator on the Submit button when numRuns > 1.
  const [runProgress, setRunProgress] = useState(null); // null | { current, total }

  // Verifier configs (per-bench, Mongo-backed singletons). Loaded lazily
  // on entering Step 2. testing_agent_bench → top-level judge_prompt +
  // judge_model on the batched submit. scratch_bench_phased → stamped
  // into each eval's `experiments.browser_prompt` + `browser_model`.
  // Only stamped when the saved config is NOT the default (so the
  // harness can use its own built-in defaults when the user hasn't
  // customized).
  const [judgeConfig, setJudgeConfig] = useState(null);
  const [scratchVerifier, setScratchVerifier] = useState(null);
  const [judgeConfigOpen, setJudgeConfigOpen] = useState(false);

  // Eph (ephemeral cortex deployment) name + existence check state.
  // Only used for the "Check" button beside the agent name input.
  const [ephName, setEphName] = useState('');
  const [checking, setChecking] = useState(false);
  // null = untouched, true = verified exists, false = does not exist
  const [agentVerified, setAgentVerified] = useState(null);
  const [agentCheckMsg, setAgentCheckMsg] = useState('');

  // Breakpoint
  const [breakpointEnabled, setBreakpointEnabled] = useState(false);
  const [breakpointMins, setBreakpointMins] = useState(10);

  // The Experiment Config UI was retired (incl. the cortex_url override
  // we previously sync'd from the env switcher). Eph-driven cortex_url
  // resolution still applies in `submitEvalJobsWithEs`.

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Fetch datasets
  const fetchDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      if (datasetType === 'all') {
        // Upstream `/datasets?limit=100` truncates to the first 100 rows
        // (alphabetical), which hides bug_bench / testing_agent_bench /
        // wingman_bench whenever scratch_bench_phased dominates. Fetch
        // each known type in parallel and merge — that gives each type
        // its own 100-row cap.
        const KNOWN_TYPES = DATASET_TYPES
          .map(t => t.value)
          .filter(v => v !== 'all');
        const results = await Promise.allSettled(
          KNOWN_TYPES.map(t => listDatasetsByType(t, { limit: 100 })),
        );
        const merged = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value?.datasets)) {
            merged.push(...r.value.datasets);
          }
        }
        setDatasets(merged);
      } else {
        const data = await listDatasetsByType(datasetType, { limit: 100 });
        setDatasets(data.datasets || []);
      }
    } catch (error) {
      console.error('Failed to fetch datasets:', error);
      setDatasets([]);
    } finally {
      setLoadingDatasets(false);
    }
  }, [datasetType]);

  useEffect(() => {
    if (open) {
      fetchDatasets();
      fetchEvalAgents();
    }
  }, [open, fetchDatasets, fetchEvalAgents]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedProblems([]);
      setActiveViews([]);
      setSelectedPreview(null);
      setSearchQuery('');
      // Seed eph + agent_name from props when the caller deep-linked us
      // (e.g. Cortex Agents editor). Empty defaults fall back to a clean
      // modal state otherwise.
      setAgentNameOverride(initialAgentName || '');
      setEphName(initialEph || '');
      setSubmitEph(initialEph || '');
      setSubmitEphReadiness(null);
      setAgentVerified(null);
      setAgentCheckMsg('');
      setModelNameOverride('');
      setModelOverrideTouched(false);
      setSelectedAgentIds([]);
      setTaAgentNames([]);
      setTaAgentsTouched(false);
      setNumRunsRaw('1');
      setRunProgress(null);
      setJudgeConfig(null);
      setScratchVerifier(null);
    }
  }, [open, initialEph, initialAgentName]);

  // Re-set verification status whenever the user edits either input
  useEffect(() => {
    setAgentVerified(null);
    setAgentCheckMsg('');
  }, [agentNameOverride, ephName]);

  // Pre-fill the per-run model override from the first selected
  // testing_agent_bench dataset's `attributes.model_name` when entering
  // Step 2. We only pre-fill once per modal open AND only if the user
  // hasn't touched the override field yet — clearing is meaningful and
  // must not be re-populated.
  useEffect(() => {
    if (step !== 2 || !isTestingAgentMode || modelOverrideTouched) return;
    const first = selectedProblems[0];
    const seed = first?.attributes?.model_name || '';
    if (seed && !modelNameOverride) {
      setModelNameOverride(seed);
    }
  }, [step, isTestingAgentMode, modelOverrideTouched, selectedProblems, modelNameOverride]);

  // Pre-populate the testing-agent multi-select with the distinct agent_names
  // baked into the selected datasets (once, until the user edits it).
  useEffect(() => {
    if (step !== 2 || !isTestingAgentMode || taAgentsTouched) return;
    const set = new Set();
    for (const p of selectedProblems) {
      const an = (p.attributes?.agent_name || '').trim();
      if (an) set.add(an);
    }
    const seed = Array.from(set);
    setTaAgentNames((prev) => (prev.length === 0 && seed.length > 0 ? seed : prev));
  }, [step, isTestingAgentMode, taAgentsTouched, selectedProblems]);

  // Lazy-load the bench-appropriate verifier config on entering Step 2.
  // Cached on the modal so users can pop the dialog open without a re-fetch.
  useEffect(() => {
    if (step !== 2) return;
    if (isTestingAgentMode && !judgeConfig) {
      (async () => {
        try {
          setJudgeConfig(await getVerifierConfig('testing_agent_bench'));
        } catch { /* non-fatal — backend defaults will apply */ }
      })();
    } else if (!isTestingAgentMode && !scratchVerifier) {
      // Scratch path: only fetch if at least one selected problem is
      // scratch_bench_phased (bug_bench / test_report_bench currently
      // don't use the browser verifier).
      const hasScratch = selectedProblems.some(p => p.dataset_type === 'scratch_bench_phased');
      if (hasScratch) {
        (async () => {
          try {
            setScratchVerifier(await getVerifierConfig('scratch_bench_phased'));
          } catch { /* non-fatal */ }
        })();
      }
    }
  }, [step, isTestingAgentMode, judgeConfig, scratchVerifier, selectedProblems]);

  const handleCheckAgent = async () => {
    const eph = ephName.trim();
    const agent = agentNameOverride.trim();
    if (!eph || !agent) {
      toast.error('Both eph name and agent name are required to check');
      return;
    }
    setChecking(true);
    setAgentVerified(null);
    setAgentCheckMsg('');
    try {
      const res = await checkAgentExists(eph, agent);
      if (res?.exists) {
        setAgentVerified(true);
        setAgentCheckMsg(`Found in "${eph}"`);
      } else {
        setAgentVerified(false);
        setAgentCheckMsg(`Not found in "${eph}"`);
      }
    } catch (err) {
      setAgentVerified(false);
      setAgentCheckMsg(parseApiError(err, 'Check failed'));
    } finally {
      setChecking(false);
    }
  };

  const filteredDatasets = datasets.filter(ds => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ds.name || '').toLowerCase().includes(q) ||
      (ds.instance_id || '').toLowerCase().includes(q) ||
      (ds.problem_statement || '').toLowerCase().includes(q)
    );
  });

  const toggleProblem = (ds) => {
    if (selectedProblems.find(p => p.name === ds.name)) {
      setSelectedProblems(selectedProblems.filter(p => p.name !== ds.name));
    } else {
      setSelectedProblems([...selectedProblems, ds]);
    }
  };

  // Apply a dataset view: MERGE its items into the current selection
  // (union semantics so multiple views can be loaded). Items are
  // `{dataset_type, instance_id}` pairs — match them to the loaded
  // `datasets` list. Items that don't match anything currently loaded
  // surface as a non-fatal warning toast (likely soft-deleted).
  const applyView = useCallback((view) => {
    if (!view?.items?.length) {
      toast.error('View has no items');
      return;
    }
    const byKey = new Map(
      datasets.map(d => [`${d.dataset_type}/${d.instance_id}`, d])
    );
    const matched = [];
    const missing = [];
    for (const it of view.items) {
      const k = `${it.dataset_type}/${it.instance_id}`;
      const ds = byKey.get(k);
      if (ds) matched.push(ds);
      else missing.push(k);
    }
    // Merge into existing selection (union, deduped by .name).
    setSelectedProblems(prev => {
      const seen = new Set(prev.map(p => p.name));
      const next = [...prev];
      for (const ds of matched) {
        if (!seen.has(ds.name)) {
          seen.add(ds.name);
          next.push(ds);
        }
      }
      return next;
    });
    // Track the view in the chip strip. Skip if already loaded.
    setActiveViews(prev => {
      if (prev.some(v => v.view_id === view.view_id)) return prev;
      return [...prev, view];
    });
    if (missing.length > 0) {
      toast.warning(
        `Loaded "${view.name}": ${matched.length} matched, ${missing.length} not found (may be soft-deleted).`,
      );
    } else {
      toast.success(
        `Loaded ${matched.length} item${matched.length === 1 ? '' : 's'} from view "${view.name}" (added to selection).`,
      );
    }
  }, [datasets]);

  // Remove a single view from the chip strip AND deselect any problems
  // that were unique to that view (i.e. not present in any other
  // currently-loaded view). Problems the user added manually or that
  // also belong to another loaded view stay selected.
  const removeView = useCallback((viewId) => {
    setActiveViews(prev => {
      const removed = prev.find(v => v.view_id === viewId);
      const remaining = prev.filter(v => v.view_id !== viewId);
      if (removed) {
        const removedKeys = new Set(
          (removed.items || []).map(it => `${it.dataset_type}/${it.instance_id}`),
        );
        const stillCoveredKeys = new Set();
        for (const v of remaining) {
          for (const it of v.items || []) {
            stillCoveredKeys.add(`${it.dataset_type}/${it.instance_id}`);
          }
        }
        // Keys exclusive to the removed view — drop these from selection.
        const dropKeys = new Set(
          [...removedKeys].filter(k => !stillCoveredKeys.has(k)),
        );
        if (dropKeys.size > 0) {
          setSelectedProblems(cur => cur.filter(
            p => !dropKeys.has(`${p.dataset_type}/${p.instance_id}`),
          ));
        }
      }
      return remaining;
    });
  }, []);

  // Pick handler for the dropdown — wraps the API call + applyView.
  const handlePickView = async (view) => {
    // The dropdown gave us the lightweight list shape; re-fetch full doc
    // (defensive — also lets us refresh items if they changed since list).
    setLoadingView(true);
    try {
      const fresh = await getDatasetView(view.view_id);
      applyView(fresh);
    } catch (err) {
      toast.error(parseApiError(err, `Failed to load view "${view.name}"`));
    } finally {
      setLoadingView(false);
    }
  };

  // Auto-load `initialViewId` (deep link from /dataset-views or /evals?view=).
  // Wait until datasets have finished loading so applyView can match items.
  useEffect(() => {
    if (!open || !initialViewId || loadingDatasets || datasets.length === 0) return;
    if (activeViews.some(v => v.view_id === initialViewId)) return;
    (async () => {
      setLoadingView(true);
      try {
        const v = await getDatasetView(initialViewId);
        applyView(v);
      } catch (err) {
        toast.error(parseApiError(err, `Could not load view ${initialViewId}`));
      } finally {
        setLoadingView(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialViewId, loadingDatasets, datasets.length]);

  // "Select all (N)" — scoped to the currently-filtered list only.
  // Blocks (with a toast) when the filtered list would create a mixed
  // testing_agent_bench + scratch/bug/test_report selection — the user
  // must apply a type filter first so the harness endpoint is consistent.
  const filteredAllSelected =
    filteredDatasets.length > 0 &&
    filteredDatasets.every(ds => selectedProblems.find(p => p.name === ds.name));

  const handleSelectAllVisible = () => {
    if (filteredAllSelected) {
      // Toggle: deselect every currently-visible item.
      const visibleNames = new Set(filteredDatasets.map(d => d.name));
      setSelectedProblems(selectedProblems.filter(p => !visibleNames.has(p.name)));
      return;
    }
    // Block mixed-type select-all: testing_agent_bench uses a different
    // harness endpoint than scratch/bug/test_report, so they can't share
    // a single batch.
    const types = new Set(filteredDatasets.map(d => d.dataset_type));
    const hasTab = types.has('testing_agent_bench');
    const hasOther = [...types].some(t => t && t !== 'testing_agent_bench');
    if (hasTab && hasOther) {
      toast.error('Apply a type filter first, then Select all — testing_agent_bench can\'t be batched with other types.');
      return;
    }
    // Merge filtered into selection, skipping already-selected duplicates.
    const seen = new Set(selectedProblems.map(p => p.name));
    const additions = filteredDatasets.filter(d => !seen.has(d.name));
    setSelectedProblems([...selectedProblems, ...additions]);
  };

  const handlePreview = async (ds) => {
    if (ds.problem_statement) { setSelectedPreview(ds); return; }
    setLoadingPreview(true);
    try {
      const full = await getDatasetForProblem(ds.name);
      setSelectedPreview(full || ds);
    } catch { setSelectedPreview(ds); }
    finally { setLoadingPreview(false); }
  };

  const goToStep = (target) => {
    setStep(target);
  };

  const handleSubmit = async () => {
    if (selectedProblems.length === 0) {
      toast.error('Select at least one problem');
      return;
    }
    if (hasMixedTypes) {
      toast.error(
        'Cannot mix testing_agent_bench with other dataset types. Submit them as separate batches.'
      );
      return;
    }
    if (!groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    // Both flows now require an explicit `agent_name` at submit time —
    // the scratch flow stamps it batch-level; the testing-agent flow
    // sends it as the per-eval `agent_name` (replaces the dataset's
    // placeholder sentinel). The dataset's stored `attributes.agent_name`
    // is a stub ("agent_set_at_runtime") to satisfy the upstream
    // harness's dataset-creation check — the user-meaningful value lives
    // only on the eval submission.
    // Agent selection is required. The testing-agent flow uses a single
    // free-text agent_name; the standard flow uses the multi-select
    // (submitted as agent_names[] → harness fan-out).
    if (isTestingAgentMode) {
      if (taAgentNames.length === 0) {
        toast.error('Select at least one agent');
        return;
      }
    } else if (selectedAgentIds.length === 0) {
      toast.error('Select at least one agent');
      return;
    }
    const runsCount = Math.max(1, Math.min(NUM_RUNS_MAX, Math.trunc(Number(numRuns) || 1)));
    setSubmitting(true);
    setSubmitError('');
    setRunProgress(runsCount > 1 ? { current: 0, total: runsCount } : null);

    // Pre-hydrate testing_agent items ONCE — same problems are reused
    // across every repeat, so we avoid N round-trips per problem to the
    // dataset endpoint when the list response trimmed fields.
    let hydratedItems = null;
    if (isTestingAgentMode) {
      try {
        hydratedItems = await Promise.all(
          selectedProblems.map(async (ds) => {
            if (ds.problem_statement && ds.natural_language_tests && ds.attributes) return ds;
            try {
              return (await getDatasetForProblem(ds.name)) || ds;
            } catch {
              return ds;
            }
          })
        );
      } catch {
        hydratedItems = selectedProblems;
      }
    }

    try {
      // No more client-side group_run_id construction. The harness mints a
      // UUID server-side; we send `group_name` (raw user input) + optional
      // `comment` instead. For Number of Runs > 1 we either send the same
      // group_name (harness mints DISTINCT UUIDs per submit), or — when
      // the user has clearly asked for distinct labels — suffix the name
      // with `(run 1 of N)` so groups stay legible in the list.
      const trimmedGroupName = groupName.trim();
      const trimmedComment = groupComment.trim();

      let totalJobsSubmitted = 0;
      const trimmedTemplate = templateName.trim();

      for (let i = 1; i <= runsCount; i++) {
        // Each run sends the SAME group_name; the harness mints distinct
        // UUIDs per call. When N > 1 we annotate the name so the list
        // doesn't show N duplicates with no visual disambiguation.
        const runGroupName = runsCount > 1
          ? `${trimmedGroupName} (run ${i} of ${runsCount})`
          : trimmedGroupName;
        if (runsCount > 1) setRunProgress({ current: i, total: runsCount });

        // ── testing_agent_bench fork-eval branch ───────────────
        if (isTestingAgentMode) {
          // Fan out: each selected agent runs against EVERY selected dataset
          // → one batch (group) per agent so results stay grouped by agent.
          for (const agentName of taAgentNames) {
            const agent = (agentName || '').trim();
            if (!agent) continue;
            const items = [];
            for (const full of hydratedItems) {
              const attrs = full.attributes || {};
              const hitl = full.problem_statement || '';
              const golden = full.natural_language_tests || '';
              const prodJobId = (attrs.prod_job_id || full.instance_id || '').trim();
              if (!hitl.trim() || !golden.trim()) {
                throw new Error(
                  `Dataset ${full.name}: HITL input and golden output are required`
                );
              }
              if (!prodJobId) {
                throw new Error(
                  `Dataset ${full.name}: prod_job_id (or instance_id) is required`
                );
              }
              const item = {
                prod_job_id: prodJobId,
                agent_name: agent,
                hitl_input: hitl,
                golden_output: golden,
              };
              const resolvedModel = modelOverrideTouched
                ? modelNameOverride.trim()
                : String(attrs.model_name || '').trim();
              if (resolvedModel) item.model_name = resolvedModel;
              items.push(item);
            }
            const batchBody = {
              group_name: runGroupName,
              items,
              agent_name: agent,
            };
            if (trimmedComment) batchBody.comment = trimmedComment;
            if (loggedInUserId) batchBody.user_id = loggedInUserId;
            if (judgeConfig && !judgeConfig.is_default) {
              if (judgeConfig.prompt) batchBody.judge_prompt = judgeConfig.prompt;
              if (judgeConfig.model) batchBody.judge_model = judgeConfig.model;
            }
            const result = await submitTestingAgentEval(batchBody);
            totalJobsSubmitted += Array.isArray(result?.jobs)
              ? result.jobs.length
              : items.length;
          }
          continue;
        }

        // ── Standard scratch/bug/test-report batch ──────────────
        // Only stamp the browser verifier when (a) it's been customized
        // and (b) the eval's dataset is scratch_bench_phased — bug_bench
        // and test_report_bench don't use the browser verifier yet.
        const useScratchVerifier = scratchVerifier && !scratchVerifier.is_default;
        const evals = selectedProblems.map(problem => {
          const evalItem = {
            problem: problem.name,
            cpus: DEFAULT_CPUS,
            memory: DEFAULT_MEMORY_MB,
            storage: DEFAULT_STORAGE_GB,
            headed,
            force_build: forceBuild,
          };
          if (trimmedTemplate) evalItem.template_name = trimmedTemplate;
          const experiments = {};
          // Model name (when set) flows via experiments.model_name. Image
          // and free-text cortex_url overrides were retired with the
          // Experiment Config collapsible.
          if (expModelName) experiments.model_name = expModelName;
          if (submitEph) {
            experiments.cortex_url = `https://cortex-${submitEph}-tit7tznrtq-uc.a.run.app`;
          }
          if (breakpointEnabled && breakpointMins > 0) {
            experiments.breakpoint_duration_mins = breakpointMins;
          }
          if (useScratchVerifier && problem.dataset_type === 'scratch_bench_phased') {
            if (scratchVerifier.prompt) experiments.browser_prompt = scratchVerifier.prompt;
            if (scratchVerifier.model) experiments.browser_model = scratchVerifier.model;
          }
          if (Object.keys(experiments).length > 0) evalItem.experiments = experiments;
          return evalItem;
        });

        // No group_run_id — harness mints a UUID server-side. Send the
        // typed name + optional comment instead.
        const payload = { user_id: loggedInUserId, group_name: runGroupName, evals };
        if (trimmedComment) payload.comment = trimmedComment;
        // Multi-agent fan-out — the harness creates one job per
        // (agent × problem). Replaces the old single agent_name field.
        payload.agent_names = selectedAgentIds;
        if (submitEph) {
          payload.eph_name = submitEph;
          payload.emergent_agents_url = `https://emergent-agents-${submitEph}-tit7tznrtq-uc.a.run.app`;
          payload.cortex_url = `https://cortex-${submitEph}-tit7tznrtq-uc.a.run.app`;
        }

        const result = submitEph
          ? await submitEvalJobsWithEs(payload)
          : await submitEvalJobs(payload);
        totalJobsSubmitted += result.jobs?.length || evals.length;
      }

      toast.success(
        runsCount > 1
          ? `Submitted ${totalJobsSubmitted} job(s) across ${runsCount} run(s)`
          : `Submitted ${totalJobsSubmitted} eval job(s)`
      );
      onClose();
      navigate('/evals');
    } catch (error) {
      const msg = parseApiError(error, 'Failed to submit evaluation');
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setRunProgress(null);
    }
  };


  const totalJobs = selectedProblems.length;
  // Multi-agent fan-out count: agents × problems × runs (testing-agent flow
  // stays single-agent). Used for the pre-submit guardrail + review summary.
  const effectiveAgentCount = isTestingAgentMode ? taAgentNames.length : selectedAgentIds.length;
  const fanoutJobCount = totalJobs * Math.max(effectiveAgentCount, isTestingAgentMode ? 0 : 0) * numRuns;
  const exceedsJobCap = !isTestingAgentMode && totalJobs * Math.max(effectiveAgentCount, 0) > 100;
  // Distinct agent names for the Review step. Standard flow uses the
  // multi-select ids; testing_agent_bench uses the testing-agent multi-select
  // (taAgentNames), each applied to every selected dataset.
  const reviewAgentNames = useMemo(() => {
    if (!isTestingAgentMode) return [];
    return taAgentNames;
  }, [isTestingAgentMode, taAgentNames]);
  const stepLabels = ['Problems', 'Configure', 'Review'];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="run-eval-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            Run Evaluation
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick problems → configure → submit
          </p>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-1 py-2 flex-wrap">
          {[1, 2, 3].map(s => (
            <button
              key={s}
              onClick={() => {
                if (s < step) goToStep(s);
              }}
              className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-md transition-colors ${
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                    ? 'bg-accent text-accent-foreground cursor-pointer hover:bg-accent/80'
                    : 'text-muted-foreground'
              }`}
              data-testid={`eval-step-${s}`}
            >
              {s}. {stepLabels[s - 1]}
              {s < 3 && <ChevronRight className="w-3 h-3" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ── Step 1: Select Problems ─────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Select value={datasetType} onValueChange={setDatasetType}>
                  <SelectTrigger className="w-[200px]" data-testid="dataset-type-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATASET_TYPES.map(dt => (
                      <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search datasets..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 font-mono text-sm"
                    data-testid="dataset-search-input"
                  />
                </div>
                <DatasetViewsDropdown
                  label={loadingView ? 'Loading…' : 'Load view'}
                  testId="eval-load-view-btn"
                  onPick={handlePickView}
                  onUnpick={(v) => removeView(v.view_id)}
                  pickedIds={activeViews.map(v => v.view_id)}
                  closeOnSelect={false}
                  disabled={loadingView}
                  emptyHint="No saved views yet. Save one from the Datasets page."
                />
              </div>

              {activeViews.length > 0 && (
                <div
                  className="flex items-center gap-2 flex-wrap self-start"
                  data-testid="eval-active-views-chips"
                >
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mr-1">
                    Loaded views:
                  </span>
                  {activeViews.map(v => (
                    <div
                      key={v.view_id}
                      className="flex items-center gap-2 text-xs border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-md px-2 py-1"
                      data-testid={`eval-active-view-chip-${v.view_id}`}
                    >
                      <span className="font-semibold">{v.name}</span>
                      <span className="font-mono text-[10px] opacity-80">
                        · {v.items?.length || 0}
                      </span>
                      <button
                        onClick={() => removeView(v.view_id)}
                        className="text-blue-700/70 dark:text-blue-300/70 hover:text-foreground -mr-1"
                        data-testid={`eval-active-view-clear-btn-${v.view_id}`}
                        title="Remove this view (items unique to it are deselected; items also in other loaded views stay)"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      // Clear all: drop every view + every problem that
                      // came from those views. Manually-added problems
                      // (i.e. not in any view) stay.
                      const allViewKeys = new Set();
                      for (const v of activeViews) {
                        for (const it of v.items || []) {
                          allViewKeys.add(`${it.dataset_type}/${it.instance_id}`);
                        }
                      }
                      setActiveViews([]);
                      setSelectedProblems(cur => cur.filter(
                        p => !allViewKeys.has(`${p.dataset_type}/${p.instance_id}`),
                      ));
                    }}
                    className="text-[10px] underline underline-offset-2 text-muted-foreground hover:text-foreground"
                    data-testid="eval-active-views-clear-all"
                  >
                    clear all
                  </button>
                </div>
              )}

              {selectedProblems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProblems.map(p => (
                    <Badge key={p.name} variant="secondary" className="font-mono text-[10px] flex items-center gap-1" data-testid={`selected-problem-${p.name}`}>
                      {p.name}
                      <button onClick={() => toggleProblem(p)} className="ml-0.5 hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}

              {hasMixedTypes && (
                <div
                  className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-[11px]"
                  data-testid="step1-mixed-types-warning"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Mixed dataset types selected.{' '}
                    <strong>testing_agent_bench</strong> uses a different harness
                    endpoint and can&apos;t be batched with scratch/bug/test-report
                    problems. Deselect one type to continue.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ minHeight: '300px' }}>
                <div className="flex flex-col">
                  <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] text-muted-foreground">
                    <span data-testid="eval-list-count">
                      {filteredDatasets.length} dataset{filteredDatasets.length === 1 ? '' : 's'}
                      {selectedProblems.length > 0 && ` · ${selectedProblems.length} selected`}
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectAllVisible}
                      disabled={loadingDatasets || filteredDatasets.length === 0}
                      className="text-[11px] text-foreground/80 hover:text-foreground underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      data-testid="select-all-datasets"
                      title={filteredAllSelected ? 'Deselect every dataset currently visible' : 'Select every dataset currently visible'}
                    >
                      {filteredAllSelected ? `Clear all (${filteredDatasets.length})` : `Select all (${filteredDatasets.length})`}
                    </button>
                  </div>
                <ScrollArea className="h-[350px] border rounded-lg">
                  {loadingDatasets ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : filteredDatasets.length === 0 ? (
                    <div className="text-center py-12 text-sm text-muted-foreground">No datasets found</div>
                  ) : (
                    <div className="p-1">
                      {filteredDatasets.map(ds => {
                        const isSelected = !!selectedProblems.find(p => p.name === ds.name);
                        const imgState = bugBenchImageState(ds);
                        const noImage = imgState === 'missing';
                        const imgReady = imgState === 'ready';
                        return (
                          <div
                            key={ds.name || ds.id}
                            onClick={() => { toggleProblem(ds); handlePreview(ds); }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleProblem(ds);
                                handlePreview(ds);
                              }
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors cursor-pointer select-none ${isSelected ? 'bg-primary/10' : 'hover:bg-accent'}`}
                            data-testid={`dataset-item-${ds.name}`}
                            title={noImage ? 'Base image not in registry yet — needs a build before running' : undefined}
                          >
                            <Checkbox checked={isSelected} tabIndex={-1} className="flex-shrink-0 pointer-events-none" />
                            {/* Image-status dot (bug_bench only) */}
                            {imgState && (
                              <span
                                className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                                  imgReady ? 'bg-emerald-500' : 'bg-rose-500'
                                }`}
                                aria-hidden
                                data-testid={`dataset-img-dot-${ds.name}`}
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div
                                className={`font-mono font-medium truncate ${noImage ? 'underline decoration-rose-500 decoration-2 underline-offset-2' : ''}`}
                              >
                                {ds.name}
                              </div>
                              <div className="text-muted-foreground text-[10px] mt-0.5 flex items-center gap-1">
                                <span>{ds.dataset_type || ds.name?.split('/')[0]}</span>
                                {noImage && (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400"
                                    data-testid={`dataset-no-image-${ds.name}`}
                                  >
                                    <AlertCircle className="w-2.5 h-2.5" />
                                    image not built
                                  </span>
                                )}
                                {imgReady && (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
                                    data-testid={`dataset-img-ready-${ds.name}`}
                                  >
                                    <Check className="w-2.5 h-2.5" />
                                    image ready
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePreview(ds); }}
                              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-background"
                              data-testid={`preview-${ds.name}`}
                              title="Preview problem"
                              type="button"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
                </div>

                <div className="border rounded-lg p-3 h-[350px] overflow-y-auto no-scrollbar">
                  {loadingPreview ? (
                    <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : selectedPreview ? (
                    <ProblemPreview ds={selectedPreview} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      <div className="text-center">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>Click a dataset to preview</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Configure ──────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4 py-2">
              {hasMixedTypes && (
                <div
                  className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-1.5 text-[11px]"
                  data-testid="mixed-types-warning"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Mixed types — submit testing_agent_bench separately.</span>
                </div>
              )}

              {/* Group name — required, always visible */}
              <div>
                <Label className="text-sm font-semibold">Group name *</Label>
                <Input
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="e.g. nightly, sonnet-vs-opus"
                  className="font-mono text-sm mt-1.5"
                  data-testid="eval-group-name"
                />
              </div>

              {/* Agents — multi-select from the harness catalog. The harness
                  fans out one job per (agent × problem). Required (≥1). */}
              {!isTestingAgentMode && (
                <div>
                  <Label className="text-sm font-semibold">Agents *</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
                    Pick one or more agents. One job is created per agent × problem.
                  </p>
                  <AgentMultiSelect
                    agents={evalAgents}
                    value={selectedAgentIds}
                    onChange={setSelectedAgentIds}
                    loading={agentsLoading}
                    error={agentsError}
                    onRetry={fetchEvalAgents}
                    testId="eval-agents-multiselect"
                  />
                  {selectedAgentIds.length > 0 && (
                    <div
                      className={`mt-2 text-[11px] rounded-md px-2.5 py-1.5 border ${
                        exceedsJobCap
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                          : 'bg-muted/40 border-border/60 text-muted-foreground'
                      }`}
                      data-testid="eval-fanout-count"
                    >
                      <span className="font-mono font-semibold text-foreground">{selectedAgentIds.length}</span> agent{selectedAgentIds.length === 1 ? '' : 's'} ×{' '}
                      <span className="font-mono font-semibold text-foreground">{totalJobs}</span> problem{totalJobs === 1 ? '' : 's'}
                      {numRuns > 1 && <> × <span className="font-mono font-semibold text-foreground">{numRuns}</span> run{numRuns === 1 ? '' : 's'}</>}
                      {' '}={' '}
                      <span className="font-mono font-semibold text-foreground">{fanoutJobCount}</span> job{fanoutJobCount === 1 ? '' : 's'}
                      {exceedsJobCap && <> — exceeds the limit of 100, the server will reject this.</>}
                    </div>
                  )}
                </div>
              )}

              {/* Runs — inline single-line pattern */}
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold whitespace-nowrap">Runs</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={numRunsRaw}
                  onChange={e => {
                    // Allow any digit-only text (incl. empty). Strip
                    // non-digits silently so paste of '3,000' becomes '3000'.
                    const raw = (e.target.value || '').replace(/[^0-9]/g, '');
                    setNumRunsRaw(raw);
                  }}
                  onBlur={() => {
                    // Snap to a valid value on blur so the user sees the
                    // effective number that will actually be submitted.
                    const n = Math.trunc(Number(numRunsRaw));
                    if (!Number.isFinite(n) || n < 1) { setNumRunsRaw('1'); return; }
                    setNumRunsRaw(String(Math.min(NUM_RUNS_MAX, n)));
                  }}
                  className="font-mono text-sm w-16 text-center"
                  data-testid="eval-num-runs"
                />
                <span className="text-[10px] text-muted-foreground">max {NUM_RUNS_MAX}</span>
              </div>

              {/* Agents — multi-select for testing_agent_bench. Defaults to
                  the dataset agent(s); each selected agent runs against every
                  selected dataset. */}
              {isTestingAgentMode && (
                <div>
                  <Label className="text-sm font-semibold">Agents *</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
                    The agent(s) the testing harness will run. Pre-filled from the
                    dataset; add more to run the same problems across agents.
                  </p>
                  <AgentMultiSelect
                    agents={evalAgentsByName}
                    value={taAgentNames}
                    onChange={(next) => { setTaAgentNames(next); setTaAgentsTouched(true); }}
                    loading={agentsLoading}
                    error={agentsError}
                    onRetry={fetchEvalAgents}
                    testId="eval-testing-agents-multiselect"
                  />
                  {taAgentNames.length > 0 && totalJobs > 0 && (
                    <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5 border bg-muted/40 border-border/60 text-muted-foreground" data-testid="ta-fanout-count">
                      <span className="font-mono font-semibold text-foreground">{taAgentNames.length}</span> agent{taAgentNames.length === 1 ? '' : 's'} ×{' '}
                      <span className="font-mono font-semibold text-foreground">{totalJobs}</span> dataset{totalJobs === 1 ? '' : 's'}
                      {numRuns > 1 && <> × <span className="font-mono font-semibold text-foreground">{numRuns}</span> run{numRuns === 1 ? '' : 's'}</>}
                      {' '}={' '}
                      <span className="font-mono font-semibold text-foreground">{taAgentNames.length * totalJobs * numRuns}</span> job{taAgentNames.length * totalJobs * numRuns === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              )}

              {/* Extra Options (testing_agent) — Model + LLM Judge, collapsed. */}
              {isTestingAgentMode && (
                <Collapsible className="border border-border/60 rounded-md">
                  <CollapsibleTrigger
                    className="group flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
                    data-testid="ta-extra-options-trigger"
                  >
                    Extra Options
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3 pt-1 space-y-4" data-testid="ta-extra-options-content">
                    {/* Model name override */}
                    <div>
                      <Label className="text-sm font-semibold">Model Name</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
                        Pre-filled from dataset. Leave on <span className="font-mono">(default)</span> to omit.
                      </p>
                      <ModelNamePicker
                        value={modelNameOverride}
                        onChange={(v) => {
                          setModelNameOverride(v);
                          setModelOverrideTouched(true);
                        }}
                        options={modelOptions}
                        testId="eval-testing-model-override"
                      />
                    </div>

                    {/* LLM Judge config */}
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">LLM Judge</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => setJudgeConfigOpen(true)}
                          data-testid="open-judge-config"
                        >
                          Edit judge prompt &amp; model
                        </Button>
                      </div>
                      <div
                        className="mt-1.5 rounded-md border bg-muted/30 px-3 py-2 text-[11px] space-y-1"
                        data-testid="judge-config-summary"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Model:</span>
                          <code className="font-mono">{judgeConfig?.model || 'gemini-flash-latest'}</code>
                          {judgeConfig?.is_default !== false && (
                            <Badge variant="outline" className="text-[9px] font-mono">default</Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          Prompt: {judgeConfig?.prompt
                            ? `${judgeConfig.prompt.length} chars · {golden} + {candidate} tokens`
                            : 'using harness default'}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {!isTestingAgentMode && (
                <>
              <Separator />

              {/* Extra Options — advanced run-behaviour toggles, collapsed
                  by default to keep the config step lean. */}
              <Collapsible className="border border-border/60 rounded-md">
                <CollapsibleTrigger
                  className="group flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
                  data-testid="extra-options-trigger"
                >
                  Extra Options
                  <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3" data-testid="extra-options-content">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch checked={headed} onCheckedChange={setHeaded} id="headed" />
                      <Label htmlFor="headed" className="text-xs cursor-pointer">Headed browser</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={forceBuild} onCheckedChange={setForceBuild} id="forceBuild" />
                      <Label htmlFor="forceBuild" className="text-xs cursor-pointer">Force rebuild</Label>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch checked={breakpointEnabled} onCheckedChange={setBreakpointEnabled} id="breakpoint" data-testid="breakpoint-toggle" />
                      <Label htmlFor="breakpoint" className="text-xs cursor-pointer">Phase breakpoint</Label>
                    </div>
                    {breakpointEnabled && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          value={breakpointMins}
                          onChange={e => setBreakpointMins(Math.max(1, Number(e.target.value)))}
                          min={1}
                          className="w-16 h-7 text-xs font-mono"
                          data-testid="breakpoint-duration"
                        />
                        <span className="text-[10px] text-muted-foreground">min per phase</span>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Review & Submit ────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              {submitError && (
                <div
                  className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-[11px]"
                  data-testid="submit-error-banner"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
              {selectedProblems.some(isBugBenchMissingImage) && (
                <div
                  className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-[11px]"
                  data-testid="review-missing-image-warning"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>
                      {selectedProblems.filter(isBugBenchMissingImage).length} selected bug_bench problem(s)
                    </strong>{' '}
                    don&apos;t have a base image in the registry yet
                    (<code className="font-mono">image_available = false</code>).
                    Those jobs will fail until a build is pushed.
                  </span>
                </div>
              )}
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Rocket className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Total jobs:</span>
                  <span className="font-mono font-bold" data-testid="review-total-jobs">{isTestingAgentMode ? taAgentNames.length * totalJobs * numRuns : fanoutJobCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Group:</span>
                  <Badge variant="secondary" className="font-mono text-[10px]" data-testid="review-group-name">{groupName || '—'}</Badge>
                </div>
                {isTestingAgentMode ? (
                  <div className="flex items-center gap-1.5 flex-wrap" data-testid="review-agents">
                    <span className="text-muted-foreground">
                      Agent{reviewAgentNames.length === 1 ? '' : 's'} ({reviewAgentNames.length}):
                    </span>
                    {reviewAgentNames.slice(0, 4).map((name) => (
                      <Badge key={name} variant="outline" className="font-mono text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20" data-testid={`review-agent-name-${name}`}>
                        {name}
                      </Badge>
                    ))}
                    {reviewAgentNames.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">+{reviewAgentNames.length - 4} more</span>
                    )}
                    {reviewAgentNames.length === 0 && (
                      <span className="text-[10px] text-muted-foreground">— (select an agent)</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap" data-testid="review-agents">
                    <span className="text-muted-foreground">Agents ({selectedAgentIds.length}):</span>
                    {selectedAgentIds.slice(0, 4).map((id) => {
                      const a = evalAgents.find((x) => x.id === id);
                      return (
                        <Badge key={id} variant="outline" className="font-mono text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20">
                          {a?.name || id}
                        </Badge>
                      );
                    })}
                    {selectedAgentIds.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">+{selectedAgentIds.length - 4} more</span>
                    )}
                  </div>
                )}
              </div>

              {/* Active verifier (browser / judge) that will be sent. */}
              {isTestingAgentMode ? (
                <VerifierReview label="Judge verifier" config={judgeConfig} testId="review-judge-verifier" />
              ) : (
                selectedProblems.some(p => p.dataset_type === 'scratch_bench_phased') && (
                  <VerifierReview label="Browser verifier" config={scratchVerifier} testId="review-browser-verifier" />
                )
              )}

              <Card>
                <CardContent className="pt-4 space-y-3">
                  <ScrollArea className="max-h-[220px]">
                    <div className="space-y-1.5">
                      {selectedProblems.map((problem, idx) => (
                        <div key={problem.name} className="flex items-center gap-2 text-xs py-1.5 px-2.5 rounded bg-accent/30">
                          <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground w-5 text-center">{idx + 1}</span>
                          <span className="font-mono text-[10px] truncate">{problem.name}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <Separator />

                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Group:</span> <span className="font-mono">{groupName}</span></div>
                    <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{loggedInUserId || '(unknown)'}</span></div>
                    {numRuns > 1 && (
                      <div>
                        <span className="text-muted-foreground">Runs:</span>{' '}
                        <span className="font-mono">{numRuns}</span>
                      </div>
                    )}
                    {isTestingAgentMode ? (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Mode:</span>{' '}
                        <span className="font-mono text-violet-600 dark:text-violet-400">testing_agent_bench</span>
                        <span className="text-muted-foreground"> — infra from forked prod jobs</span>
                      </div>
                    ) : (
                      <>
                        <div><span className="text-muted-foreground">Resources:</span> <span className="font-mono">{DEFAULT_CPUS} cpu · {DEFAULT_MEMORY_MB} MB · {DEFAULT_STORAGE_GB} GB</span></div>
                        <div><span className="text-muted-foreground">Headed:</span> <span className="font-mono">{headed ? 'Yes' : 'No'}</span></div>
                        <div><span className="text-muted-foreground">Force Build:</span> <span className="font-mono">{forceBuild ? 'Yes' : 'No'}</span></div>
                        {expModelName && (
                          <div><span className="text-muted-foreground">Model:</span> <span className="font-mono">{expModelName}</span></div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {totalJobs > 1 && (
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                  <Rocket className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-600" />
                  <span>
                    All <strong className="text-foreground">{totalJobs}</strong> jobs will start running simultaneously, tagged with group <strong className="text-foreground font-mono">{groupName}</strong>.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={submitting} data-testid="eval-cancel-btn">
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => goToStep(step - 1)} disabled={submitting} data-testid="eval-back-btn">
                Back
              </Button>
            )}
            {step < 3 ? (
              <Button
                onClick={() => goToStep(step + 1)}
                disabled={
                  (step === 1 && (selectedProblems.length === 0 || hasMixedTypes)) ||
                  (step === 2 && !groupName.trim())
                  // NOTE: eph readiness gate temporarily disabled per product
                  // ask. Submission still routes through /jobs-with-es when
                  // an eph is set; we just no longer block Next/Submit on
                  // the readiness probe. Re-enable by restoring the
                  // `submitEphReadiness?.ready` conditions when ready.
                }
                title={hasMixedTypes ? 'Cannot mix testing_agent_bench with other dataset types' : undefined}
                data-testid="eval-next-step"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={
                  submitting || totalJobs === 0 ||
                  agentVerified === false ||
                  (isTestingAgentMode
                    ? taAgentNames.length === 0
                    : selectedAgentIds.length === 0)
                  // NOTE: eph readiness gate temporarily disabled (see Next btn).
                }
                title={
                  agentVerified === false ? 'Agent name failed verification — fix it or clear the eph check' :
                  (isTestingAgentMode ? taAgentNames.length === 0 : selectedAgentIds.length === 0) ? 'Select at least one agent' :
                  undefined
                }
                data-testid="submit-eval-button"
              >
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                {runProgress
                  ? `Submitting ${runProgress.current}/${runProgress.total}…`
                  : 'Submit'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
      <JudgeConfigDialog
        open={judgeConfigOpen}
        onOpenChange={setJudgeConfigOpen}
        onSaved={(cfg) => setJudgeConfig(cfg)}
      />
    </Dialog>
  );
}
