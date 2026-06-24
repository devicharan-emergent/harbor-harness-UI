import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { listDatasets, listDatasetsByType, getDatasetForProblem, submitEvalJobs, submitEvalJobsWithEs, submitTestingAgentEval, checkAgentExists, getJudgeConfig } from '@/services/evalApi';
import { toast } from 'sonner';
import { Loader2, Rocket, FileText, Search, ChevronRight, Check, AlertCircle, X } from 'lucide-react';
import { parseApiError } from '@/lib/errorUtils';
import { useEnv } from '@/components/layout/EnvSwitcher';
import { EphPicker } from '@/components/cortex/EphPicker';
import { ModelNamePicker } from './ModelNamePicker';
import { JudgeConfigDialog } from './JudgeConfigDialog';

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
export function RunEvalModal({ open, onClose, initialEph = '', initialAgentName = '' }) {
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

  // Group ID (mandatory tag for batch jobs)
  const [groupId, setGroupId] = useState('');

  // Resources
  const [cpus, setCpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [storageGb, setStorageGb] = useState(10);
  const [headed, setHeaded] = useState(true);
  const [forceBuild, setForceBuild] = useState(false);
  const [userId, setUserId] = useState('6e01d102-2641-44a2-89b8-039927baefde');

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

  // Judge config (singleton, Mongo-backed). Loaded lazily on entering
  // Step 2 in testing_agent_mode; stamped onto the batch body as
  // top-level judge_prompt + judge_model.
  const [judgeConfig, setJudgeConfig] = useState(null);
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

  // Lazy-load the judge config on entering Step 2 in testing_agent_mode.
  // Cached on the modal so users can pop the dialog open without a re-fetch.
  useEffect(() => {
    if (step !== 2 || !isTestingAgentMode || judgeConfig) return;
    (async () => {
      try {
        const cfg = await getJudgeConfig();
        setJudgeConfig(cfg);
      } catch {
        // Non-fatal — submit will fall back to omitting judge_* keys and
        // the backend defaults will kick in.
      }
    })();
  }, [step, isTestingAgentMode, judgeConfig]);

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
    if (!groupId.trim()) {
      toast.error('Group Run ID is required');
      return;
    }
    setSubmitting(true);
    try {
      // Harness requires `group_run_id` to be unique per submission. Append
      // an ISO timestamp + short random suffix so users can reuse the same
      // human-friendly label (e.g. "nightly") across runs without
      // collisions even on rapid double-clicks.
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rand = Math.random().toString(36).slice(2, 6);
      const groupRunId = `${groupId.trim()}-${ts}-${rand}`;

      // ── testing_agent_bench fork-eval branch ───────────────────
      // Single batched POST with `items[]` — one entry per selected
      // dataset. `group_run_id` / `user_id` / `created_by` are shared
      // top-level (the backend rejects duplicate group_run_id across
      // requests, so looping would 409 on the 2nd dataset).
      if (isTestingAgentMode) {
        const trimmedAgentOverride = agentNameOverride.trim();
        // Resolve the per-batch model_name once:
        //  - If the user touched the override field, that value wins for
        //    every item (incl. blank → key omitted on every item).
        //  - Otherwise each item falls back to its own dataset's
        //    `attributes.model_name`.
        const items = [];
        for (const ds of selectedProblems) {
          // Hydrate full dataset if list endpoint trimmed fields.
          let full = ds;
          if (!ds.problem_statement || !ds.natural_language_tests || !ds.attributes) {
            try {
              full = (await getDatasetForProblem(ds.name)) || ds;
            } catch {
              full = ds;
            }
          }
          const attrs = full.attributes || {};
          const agent = trimmedAgentOverride || (attrs.agent_name || '').trim();
          const hitl = full.problem_statement || '';
          const golden = full.natural_language_tests || '';
          const prodJobId = (attrs.prod_job_id || full.instance_id || '').trim();
          if (!agent) {
            throw new Error(
              `Dataset ${full.name || ds.name}: agent_name is required (set on the dataset or via the override)`
            );
          }
          if (!hitl.trim() || !golden.trim()) {
            throw new Error(
              `Dataset ${full.name || ds.name}: HITL input and golden output are required`
            );
          }
          if (!prodJobId) {
            throw new Error(
              `Dataset ${full.name || ds.name}: prod_job_id (or instance_id) is required`
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
          group_run_id: groupRunId,
          items,
        };
        if (userId.trim()) batchBody.user_id = userId.trim();
        // Stamp the saved judge config (if any) at the top level. Omit
        // when the config call failed or we're using the in-memory
        // defaults — the harness uses its own defaults in that case.
        if (judgeConfig?.judge_prompt) batchBody.judge_prompt = judgeConfig.judge_prompt;
        if (judgeConfig?.judge_model) batchBody.judge_model = judgeConfig.judge_model;
        const result = await submitTestingAgentEval(batchBody);
        const jobCount = Array.isArray(result?.jobs) ? result.jobs.length : items.length;
        toast.success(`Submitted ${jobCount} testing-agent eval(s)`);
        onClose();
        navigate('/evals');
        return;
      }

      // ── Standard scratch/bug/test-report batch ─────────────────
      const trimmedOverride = agentNameOverride.trim();

      const evals = selectedProblems.map(problem => {
        const evalItem = {
          problem: problem.name,
          cpus,
          memory: memoryMb,
          storage: storageGb,
          headed,
          force_build: forceBuild,
        };
        if (templateName.trim()) evalItem.template_name = templateName.trim();
        const experiments = {};
        if (showExpConfig) {
          if (expImage) experiments.image = expImage;
          if (expModelName) experiments.model_name = expModelName;
          // cortex_url only flows through in advanced mode AND when there's no
          // eph selected — eph-driven submission derives URLs from the eph name.
          if (advancedMode && !submitEph && expCortexUrl) experiments.cortex_url = expCortexUrl;
        }
        // Eph-driven path: derive per-eval cortex_url from the eph name so
        // the harness sees it on every eval item. Mirrors the same project
        // suffix used by EnvSwitcher.
        if (submitEph) {
          experiments.cortex_url = `https://cortex-${submitEph}-tit7tznrtq-uc.a.run.app`;
        }
        if (breakpointEnabled && breakpointMins > 0) {
          experiments.breakpoint_duration_mins = breakpointMins;
        }
        if (Object.keys(experiments).length > 0) evalItem.experiments = experiments;
        return evalItem;
      });

      const payload = { user_id: userId, group_run_id: groupRunId, evals };
      if (trimmedOverride) payload.agent_name = trimmedOverride;
      // Eph-driven: derive both emergent_agents_url + cortex_url from the
      // eph name (same Cloud Run project suffix as EnvSwitcher). The
      // backend used to do this server-side via a readiness preflight; we
      // now construct on the client so the /jobs-with-es contract is
      // satisfied without depending on the readiness stub.
      if (submitEph) {
        payload.eph_name = submitEph;
        payload.emergent_agents_url = `https://emergent-agents-${submitEph}-tit7tznrtq-uc.a.run.app`;
        payload.cortex_url = `https://cortex-${submitEph}-tit7tznrtq-uc.a.run.app`;
      }

      // Route through /jobs-with-es when an eph is set so the backend can
      // derive emergent_agents_url + cortex_url and re-validate readiness.
      const result = submitEph
        ? await submitEvalJobsWithEs(payload)
        : await submitEvalJobs(payload);
      const jobCount = result.jobs?.length || evals.length;
      toast.success(`Submitted ${jobCount} eval job(s)`);
      onClose();
      navigate('/evals');
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to submit evaluation'));
    } finally {
      setSubmitting(false);
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
          <p className="text-xs text-muted-foreground mt-1">
            Pick problems, configure resources, then submit
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
              </div>

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
                  className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-[11px]"
                  data-testid="mixed-types-warning"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    You&apos;ve mixed <strong>testing_agent_bench</strong> problems with other
                    dataset types. Submit them as separate batches — testing_agent_bench
                    forks a prod job and uses a different harness endpoint.
                  </span>
                </div>
              )}
              {isTestingAgentMode && (
                <div
                  className="flex items-start gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 px-3 py-2 text-[11px]"
                  data-testid="testing-agent-mode-banner"
                >
                  <Rocket className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>Testing Agent Bench mode.</strong> The harness will fork
                    each prod job and run the testing agent against the dataset&apos;s
                    HITL input + golden output. Infra config is sourced from the
                    forked prod job, so only Group Run ID and User ID are needed.
                  </span>
                </div>
              )}

              {/* Eph picker (hidden in testing_agent_mode) */}
              {!isTestingAgentMode && (
                <div>
                  <Label className="text-sm font-semibold">Target eph</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                    Pick the ephemeral deployment to evaluate against. The backend derives
                    emergent + cortex URLs from this name.
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      Readiness check temporarily disabled — submission proceeds without preflight.
                    </span>
                  </p>
                  <EphPicker
                    value={submitEph}
                    onChange={(name) => { setSubmitEph(name); setSubmitEphReadiness(null); }}
                    onReadiness={setSubmitEphReadiness}
                  />
                </div>
              )}

              {/* Group Run ID — always shown */}
              <div>
                <Label className="text-sm font-semibold">Group Run ID *</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                  Tag all jobs in this batch. We'll auto-suffix a timestamp so it's unique
                  per submission.
                </p>
                <Input
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  placeholder="e.g. nightly, sonnet-vs-opus"
                  className="font-mono text-sm"
                  data-testid="eval-group-id"
                />
              </div>

              {!isTestingAgentMode && (
                <>
                  {/* Template */}
                  <div>
                    <Label className="text-sm font-semibold">Template Name</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">Optional: start from a pre-built template snapshot</p>
                    <Input
                      value={templateName}
                      onChange={e => setTemplateName(e.target.value)}
                      placeholder="e.g. task_manager, ecom_store"
                      className="font-mono text-sm"
                      data-testid="eval-template-name"
                    />
                  </div>

                  {/* Agent name override (free-text) + existence check */}
                  <div>
                    <Label className="text-sm font-semibold">Agent name</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                  Optional. Type any agent name the harness/cortex recognizes
                  (e.g. <code className="font-mono">full_stack_app_builder_cloud_v8_sonnet_4_5</code>).
                  When set, sent as the batch-level <code className="font-mono">agent_name</code>.
                </p>
                <Input
                  value={agentNameOverride}
                  onChange={e => setAgentNameOverride(e.target.value)}
                  placeholder="e.g. full_stack_app_builder_cloud_v8_sonnet_4_5"
                  className="font-mono text-sm"
                  data-testid="eval-agent-name-override"
                />

                {/* Eph name + verify button */}
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={ephName}
                    onChange={e => setEphName(e.target.value)}
                    placeholder="eph name (e.g. leadgen1)"
                    className="font-mono text-xs h-8 flex-1"
                    data-testid="eval-eph-name"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleCheckAgent}
                    disabled={checking || !ephName.trim() || !agentNameOverride.trim()}
                    data-testid="check-agent-btn"
                  >
                    {checking ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5 mr-1" />
                    )}
                    Check
                  </Button>
                </div>

                {/* Status pill */}
                {agentVerified === true && (
                  <div
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400"
                    data-testid="agent-check-ok"
                  >
                    <Check className="w-3 h-3" />
                    {agentCheckMsg}
                  </div>
                )}
                {agentVerified === false && (
                  <div
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-mono text-rose-600 dark:text-rose-400"
                    data-testid="agent-check-fail"
                  >
                    <AlertCircle className="w-3 h-3" />
                    {agentCheckMsg}
                  </div>
                )}
              </div>
                </>
              )}

              {/* User ID — always shown */}
              <div>
                <Label className="text-sm font-semibold">User ID</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                  UUID forwarded to the harness as <code className="font-mono">user_id</code>.
                </p>
                <Input
                  value={userId}
                  onChange={e => setUserId(e.target.value)}
                  className="font-mono text-xs"
                  data-testid="eval-user-id"
                />
              </div>

              {/* Agent name override — testing_agent_mode only */}
              {isTestingAgentMode && (
                <div>
                  <Label className="text-sm font-semibold">Agent Name (override)</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                    Optional. When set, overrides each dataset&apos;s
                    {' '}<code className="font-mono">attributes.agent_name</code>
                    {' '}for this submission only — useful for A/B testing a
                    different testing agent against the same HITL + golden.
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
                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                    Pre-filled from the selected dataset&apos;s{' '}
                    <code className="font-mono">attributes.model_name</code>.
                    Edit to override for this run only — the dataset is not
                    modified. Leave on{' '}
                    <span className="font-mono">(default)</span> to use the
                    agent&apos;s default model (key is omitted from the payload).
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
                      <code className="font-mono">{judgeConfig?.judge_model || 'gemini-flash-latest'}</code>
                      {judgeConfig?.is_default !== false && (
                        <Badge variant="outline" className="text-[9px] font-mono">default</Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      Prompt: {judgeConfig?.judge_prompt
                        ? `${judgeConfig.judge_prompt.length} chars · {golden} + {candidate} tokens`
                        : 'using harness default'}
                    </div>
                  </div>
                </div>
              )}

              {!isTestingAgentMode && (
                <>
              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Resources</Label>
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
                  <Badge variant="secondary" className="font-mono text-[10px]" data-testid="review-group-id">{groupId || '—'}</Badge>
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
                    <div><span className="text-muted-foreground">Group:</span> <span className="font-mono">{groupId}</span></div>
                    <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{userId}</span></div>
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
                    All <strong className="text-foreground">{totalJobs}</strong> jobs will start running simultaneously, tagged with group <strong className="text-foreground font-mono">{groupId}</strong>.
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
                  (step === 2 && !groupId.trim())
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
                Submit {totalJobs > 0 && `(${totalJobs} job${totalJobs > 1 ? 's' : ''})`}
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
