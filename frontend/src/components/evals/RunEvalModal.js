import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { listDatasets, listDatasetsByType, getDatasetForProblem, submitEvalJobs, submitEvalJobsWithEs, submitTestingAgentEval, checkAgentExists, getVerifierConfig, getDatasetView } from '@/services/evalApi';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Rocket, FileText, Search, ChevronRight, Check, AlertCircle, X, ChevronDown } from 'lucide-react';
import { parseApiError } from '@/lib/errorUtils';
import { useEnv } from '@/components/layout/EnvSwitcher';
import { EphPicker } from '@/components/cortex/EphPicker';
import { ModelNamePicker } from './ModelNamePicker';
import { JudgeConfigDialog } from './JudgeConfigDialog';
import { DatasetViewsDropdown } from '@/components/datasets/DatasetViewsDropdown';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
];

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
            <strong>Image not available.</strong> This bug_bench problem's base image
            isn't in the registry yet (<code className="font-mono">attributes.image_available = false</code>).
            A build is required before it can run end-to-end.
          </span>
        </div>
      )}

      <Separator />
      {body}
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

  // Active dataset view (loaded via DatasetViewsDropdown or `?view=`
  // deep link). Shown as a chip near the selection area; doesn't gate
  // anything but tells the user where their selection came from.
  const [activeView, setActiveView] = useState(null);
  const [loadingView, setLoadingView] = useState(false);

  // Group ID (mandatory tag for batch jobs)
  const [groupName, setGroupName] = useState('');
  const [groupComment, setGroupComment] = useState('');

  // Resources
  const [cpus, setCpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [storageGb, setStorageGb] = useState(10);
  const [headed, setHeaded] = useState(true);
  const [forceBuild, setForceBuild] = useState(false);
  // user_id is now sourced from the authenticated session (no UI). The
  // user_id stamp is what the harness uses for job ownership lookups.
  const { user } = useAuth();
  const userId = user?.user_id || '';

  // Experiment config
  const [showExpConfig, setShowExpConfig] = useState(false);
  const [expImage, setExpImage] = useState('');
  const [expModelName, setExpModelName] = useState('');
  const [expCortexUrl, setExpCortexUrl] = useState('');

  // Eph-driven submission. When an eph is selected the backend derives
  // emergent_agents_url + per-eval cortex_url server-side and re-runs
  // readiness preflight. Free-text cortex_url stays behind ?advanced=1 only.
  const [searchParams] = useSearchParams();
  const advancedMode = useMemo(() => searchParams.get('advanced') === '1', [searchParams]);

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

  // Template
  const [templateName, setTemplateName] = useState('');

  // Free-text agent_name override — sent at the batch level when set.
  const [agentNameOverride, setAgentNameOverride] = useState('');

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

  // Sync cortex URL from environment switcher
  useEffect(() => {
    if (envCortexUrl) setExpCortexUrl(envCortexUrl);
  }, [envCortexUrl]);

  const [submitting, setSubmitting] = useState(false);

  // Fetch datasets
  const fetchDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      let data;
      if (datasetType === 'all') {
        data = await listDatasets({ limit: 100 });
      } else {
        data = await listDatasetsByType(datasetType, { limit: 100 });
      }
      setDatasets(data.datasets || []);
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
    }
  }, [open, fetchDatasets]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedProblems([]);
      setActiveView(null);
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

  // Apply a dataset view: replace the current selection with the view's
  // items. Items are `{dataset_type, instance_id}` pairs — match them to
  // the loaded `datasets` list. Items that don't match anything currently
  // loaded surface as a non-fatal warning toast (likely soft-deleted).
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
    setSelectedProblems(matched);
    setActiveView(view);
    if (missing.length > 0) {
      toast.warning(
        `Loaded "${view.name}": ${matched.length} matched, ${missing.length} not found (may be soft-deleted).`,
      );
    } else {
      toast.success(
        `Loaded ${matched.length} item${matched.length === 1 ? '' : 's'} from view "${view.name}". Previous selection cleared.`,
      );
    }
  }, [datasets]);

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
    if (activeView?.view_id === initialViewId) return;
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
    const runsCount = Math.max(1, Math.min(NUM_RUNS_MAX, Math.trunc(Number(numRuns) || 1)));
    setSubmitting(true);
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
      const trimmedAgentOverride = agentNameOverride.trim();
      const trimmedTemplate = templateName.trim();

      // Derive the batch-level agent_name for the non-testing_agent flow
      // from (in order):
      //   1. The manual override input on this page
      //   2. The `initialAgentName` prop (deep-link from the Cortex editor)
      //   3. The first selected dataset's `attributes.agent_name` (so when
      //      the user just picks a dataset without typing anything, the
      //      agent baked into that dataset still rides along).
      // This is essential when Number of Runs > 1 — each iteration builds a
      // fresh payload and we were previously dropping `agent_name` whenever
      // the override field happened to be empty, even though it could be
      // resolved from a dataset attribute or the deep-link prop.
      const derivedAgentName = (
        trimmedAgentOverride
        || (initialAgentName || '').trim()
        || ((selectedProblems[0]?.attributes?.agent_name) || '').trim()
      );

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
          const items = [];
          for (const full of hydratedItems) {
            const attrs = full.attributes || {};
            const agent = trimmedAgentOverride || (attrs.agent_name || '').trim();
            const hitl = full.problem_statement || '';
            const golden = full.natural_language_tests || '';
            const prodJobId = (attrs.prod_job_id || full.instance_id || '').trim();
            if (!agent) {
              throw new Error(
                `Dataset ${full.name}: agent_name is required (set on the dataset or via the override)`
              );
            }
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
            // No group_run_id — harness mints a UUID server-side.
            group_name: runGroupName,
            items,
          };
          if (trimmedComment) batchBody.comment = trimmedComment;
          if (userId.trim()) batchBody.user_id = userId.trim();
          // Only stamp the saved judge config when the user has actually
          // customized it — otherwise omit so the harness applies its
          // built-in default.
          if (judgeConfig && !judgeConfig.is_default) {
            if (judgeConfig.prompt) batchBody.judge_prompt = judgeConfig.prompt;
            if (judgeConfig.model) batchBody.judge_model = judgeConfig.model;
          }
          const result = await submitTestingAgentEval(batchBody);
          totalJobsSubmitted += Array.isArray(result?.jobs)
            ? result.jobs.length
            : items.length;
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
            cpus,
            memory: memoryMb,
            storage: storageGb,
            headed,
            force_build: forceBuild,
          };
          if (trimmedTemplate) evalItem.template_name = trimmedTemplate;
          const experiments = {};
          if (showExpConfig) {
            if (expImage) experiments.image = expImage;
            if (expModelName) experiments.model_name = expModelName;
            if (advancedMode && !submitEph && expCortexUrl) experiments.cortex_url = expCortexUrl;
          }
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
        const payload = { user_id: userId, group_name: runGroupName, evals };
        if (trimmedComment) payload.comment = trimmedComment;
        if (derivedAgentName) payload.agent_name = derivedAgentName;
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
      toast.error(parseApiError(error, 'Failed to submit evaluation'));
    } finally {
      setSubmitting(false);
      setRunProgress(null);
    }
  };


  const totalJobs = selectedProblems.length;
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 whitespace-nowrap"
                  onClick={handleSelectAllVisible}
                  disabled={loadingDatasets || filteredDatasets.length === 0}
                  data-testid="select-all-datasets"
                  title={filteredAllSelected ? 'Deselect every dataset currently visible' : 'Select every dataset currently visible'}
                >
                  {filteredAllSelected
                    ? `Clear (${filteredDatasets.length})`
                    : `Select all (${filteredDatasets.length})`}
                </Button>
                <DatasetViewsDropdown
                  label={loadingView ? 'Loading…' : 'Load view'}
                  testId="eval-load-view-btn"
                  onPick={handlePickView}
                  disabled={loadingView}
                  emptyHint="No saved views yet. Save one from the Datasets page."
                />
              </div>

              {activeView && (
                <div
                  className="flex items-center gap-2 text-xs border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-md px-2.5 py-1.5 self-start"
                  data-testid="eval-active-view-chip"
                >
                  <span>Loaded view:</span>
                  <span className="font-semibold">{activeView.name}</span>
                  <span className="font-mono text-[10px] opacity-80">
                    · {activeView.items?.length || 0} items
                  </span>
                  <button
                    onClick={() => { setActiveView(null); setSelectedProblems([]); }}
                    className="text-[10px] underline underline-offset-2 hover:text-foreground ml-1"
                    data-testid="eval-active-view-clear-btn"
                  >
                    clear
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
                    endpoint and can't be batched with scratch/bug/test-report
                    problems. Deselect one type to continue.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ minHeight: '300px' }}>
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
              {isTestingAgentMode && (
                <div
                  className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 px-3 py-1.5 text-[11px]"
                  data-testid="testing-agent-mode-banner"
                >
                  <Rocket className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Testing Agent Bench mode — infra inherited from forked prod job.</span>
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

              {/* Run Nx — compact inline pattern: "Run [N] x" */}
              <div>
                <Label className="text-sm font-semibold">Runs</Label>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-sm text-muted-foreground font-mono">Run</span>
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
                  <span className="text-sm text-muted-foreground font-mono">x</span>
                  <span className="text-[10px] text-muted-foreground ml-2">max {NUM_RUNS_MAX}</span>
                </div>
              </div>

              {/* Comment — collapsed by default (optional) */}
              <Collapsible>
                <CollapsibleTrigger
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground border-b border-border/40 pb-1.5 [&[data-state=open]>svg]:rotate-180"
                  data-testid="toggle-comment"
                >
                  <span className="font-semibold">Comment{groupComment ? ' ·' : ''}{groupComment ? <span className="ml-1 italic font-normal text-foreground/80">{groupComment.length} chars</span> : ''}</span>
                  <ChevronDown className="w-3.5 h-3.5 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Textarea
                    value={groupComment}
                    onChange={e => setGroupComment(e.target.value)}
                    rows={2}
                    placeholder="What is this batch testing?"
                    className="text-sm resize-none"
                    data-testid="eval-group-comment"
                  />
                </CollapsibleContent>
              </Collapsible>

              {!isTestingAgentMode && (
                <>
                  {/* Template — collapsed */}
                  <Collapsible>
                    <CollapsibleTrigger
                      className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground border-b border-border/40 pb-1.5 [&[data-state=open]>svg]:rotate-180"
                      data-testid="toggle-template"
                    >
                      <span className="font-semibold">Template name{templateName ? <span className="ml-1 font-mono font-normal text-foreground/80">· {templateName}</span> : ''}</span>
                      <ChevronDown className="w-3.5 h-3.5 transition-transform" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <Input
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        placeholder="e.g. task_manager, ecom_store"
                        className="font-mono text-sm"
                        data-testid="eval-template-name"
                      />
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Agent name — collapsed; eph input REMOVED per spec */}
                  <Collapsible>
                    <CollapsibleTrigger
                      className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground border-b border-border/40 pb-1.5 [&[data-state=open]>svg]:rotate-180"
                      data-testid="toggle-agent-name"
                    >
                      <span className="font-semibold">Agent name{agentNameOverride.trim() ? <span className="ml-1 font-mono font-normal text-foreground/80">· {agentNameOverride.trim()}</span> : ''}</span>
                      <ChevronDown className="w-3.5 h-3.5 transition-transform" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <Input
                        value={agentNameOverride}
                        onChange={e => setAgentNameOverride(e.target.value)}
                        placeholder="e.g. full_stack_app_builder_cloud_v8_sonnet_4_5"
                        className="font-mono text-sm"
                        data-testid="eval-agent-name-override"
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}

              {/* Agent name override — testing_agent_mode only */}
              {isTestingAgentMode && (
                <div>
                  <Label className="text-sm font-semibold">Agent Name (override)</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
                    Overrides <code className="font-mono">attributes.agent_name</code> for this run only.
                  </p>
                  <Input
                    value={agentNameOverride}
                    onChange={e => setAgentNameOverride(e.target.value)}
                    placeholder="e.g. testing-agent-v3-gpt-5-2-codex"
                    className="font-mono text-sm"
                    data-testid="eval-testing-agent-name-override"
                  />
                </div>
              )}

              {/* Model name override — testing_agent_mode only */}
              {isTestingAgentMode && (
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
                    testId="eval-testing-model-override"
                  />
                </div>
              )}

              {/* LLM Judge config — testing_agent_mode only */}
              {isTestingAgentMode && (
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
              )}

              {!isTestingAgentMode && (
                <>
              <Separator />

              <Collapsible>
                <CollapsibleTrigger
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground border-b border-border/40 pb-1.5 [&[data-state=open]>svg]:rotate-180"
                  data-testid="toggle-resources"
                >
                  <span className="font-semibold">Resources <span className="font-mono font-normal text-foreground/80 ml-1">· {cpus} cpu · {memoryMb} MB · {storageGb} GB</span></span>
                  <ChevronDown className="w-3.5 h-3.5 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">CPUs</Label>
                    <Input type="number" value={cpus} onChange={e => setCpus(Number(e.target.value))} min={1} max={8} data-testid="eval-cpus" />
                  </div>
                  <div>
                    <Label className="text-xs">Memory (MB)</Label>
                    <Input type="number" value={memoryMb} onChange={e => setMemoryMb(Number(e.target.value))} step={1024} data-testid="eval-memory" />
                  </div>
                  <div>
                    <Label className="text-xs">Storage (GB)</Label>
                    <Input type="number" value={storageGb} onChange={e => setStorageGb(Number(e.target.value))} min={5} max={50} data-testid="eval-storage" />
                  </div>
                </div>
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
                <div className="flex items-center gap-3 mt-2">
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
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Separator />
              <div>
                <button onClick={() => setShowExpConfig(!showExpConfig)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" data-testid="toggle-exp-config">
                  <ChevronRight className={`w-3 h-3 transition-transform ${showExpConfig ? 'rotate-90' : ''}`} />
                  Experiment Config (optional)
                </button>
                {showExpConfig && (
                  <div className="mt-3 space-y-3 pl-4 border-l-2 border-border">
                    <div>
                      <Label className="text-xs">Image</Label>
                      <Input value={expImage} onChange={e => setExpImage(e.target.value)} className="font-mono text-xs" placeholder="e.g. us-central1-docker.pkg.dev/..." />
                    </div>
                    <div>
                      <Label className="text-xs">Model Name</Label>
                      <Input value={expModelName} onChange={e => setExpModelName(e.target.value)} className="font-mono text-xs" placeholder="e.g. claude-sonnet-4.5" />
                    </div>
                    {advancedMode && (
                      <div>
                        <Label className="text-xs">Cortex URL (advanced)</Label>
                        <Input value={expCortexUrl} onChange={e => setExpCortexUrl(e.target.value)} className="font-mono text-xs" placeholder="https://cortex-cli..." />
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                          Free-text URL mode is enabled by <span className="font-mono">?advanced=1</span>.
                          Prefer the eph picker — URLs that look fine here can be silently dead.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Review & Submit ────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4 py-2">
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
                    don't have a base image in the registry yet
                    (<code className="font-mono">image_available = false</code>).
                    Those jobs will fail until a build is pushed.
                  </span>
                </div>
              )}
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Rocket className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Total jobs:</span>
                  <span className="font-mono font-bold">{totalJobs}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Group:</span>
                  <Badge variant="secondary" className="font-mono text-[10px]" data-testid="review-group-name">{groupName || '—'}</Badge>
                </div>
                {agentNameOverride.trim() && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Agent:</span>
                    <Badge variant="outline" className="font-mono text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20" data-testid="review-agent-name">
                      {agentNameOverride.trim()}
                    </Badge>
                  </div>
                )}
              </div>

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
                    <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{userId}</span></div>
                    {numRuns > 1 && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Runs:</span>{' '}
                        <span className="font-mono">{numRuns}</span>
                        <span className="text-muted-foreground"> — each gets its own</span>{' '}
                        <code className="font-mono text-[10px]">group_run_id</code>
                        <span className="text-muted-foreground"> with</span>{' '}
                        <code className="font-mono text-[10px]">-run-N</code>{' '}
                        <span className="text-muted-foreground">suffix ({totalJobs * numRuns} total jobs)</span>
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
                        <div><span className="text-muted-foreground">CPUs:</span> <span className="font-mono">{cpus}</span></div>
                        <div><span className="text-muted-foreground">Memory:</span> <span className="font-mono">{memoryMb} MB</span></div>
                        <div><span className="text-muted-foreground">Storage:</span> <span className="font-mono">{storageGb} GB</span></div>
                        <div><span className="text-muted-foreground">Headed:</span> <span className="font-mono">{headed ? 'Yes' : 'No'}</span></div>
                        <div><span className="text-muted-foreground">Force Build:</span> <span className="font-mono">{forceBuild ? 'Yes' : 'No'}</span></div>
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
                  agentVerified === false
                  // NOTE: eph readiness gate temporarily disabled (see Next btn).
                }
                title={
                  agentVerified === false ? 'Agent name failed verification — fix it or clear the eph check' :
                  undefined
                }
                data-testid="submit-eval-button"
              >
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                {runProgress
                  ? `Submitting ${runProgress.current}/${runProgress.total}…`
                  : (
                    <>
                      Submit {totalJobs > 0 && (
                        numRuns > 1
                          ? `(${totalJobs} × ${numRuns} = ${totalJobs * numRuns} jobs)`
                          : `(${totalJobs} job${totalJobs > 1 ? 's' : ''})`
                      )}
                    </>
                  )}
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
