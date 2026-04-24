import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { createDataset, updateDataset } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';
import { toast } from 'sonner';
import {
  Loader2,
  Save,
  X,
  Plus,
  Eye,
  ArrowLeft,
  Trash2,
  Code2,
  ChevronDown,
  ChevronRight,
  Check,
} from 'lucide-react';

const DATASET_TYPE_OPTIONS = [
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
];

// ── XML helpers (phased mode only) ──────────────────────────────────────
const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Build the problem_statement XML. Real format: <phases><phase>...text...</phase></phases>
// No `name` attribute, text sits directly inside <phase>.
function phasesToProblemXml(phases) {
  const inner = phases
    .map((p) => {
      const text = String(p.problemText ?? '').trim();
      return `<phase>\n${escapeXml(text)}\n</phase>`;
    })
    .join('\n');
  return `<phases>\n${inner}\n</phases>`;
}

// Build the natural_language_tests XML. Real format:
//   <phases>
//     <phase>
//       <test_cases>
//         <test_case>...</test_case>
//         <test_case>...</test_case>
//       </test_cases>
//     </phase>
//   </phases>
function phasesToTestsXml(phases) {
  const inner = phases
    .map((p) => {
      const tests = (p.tests || [])
        .map((t) => String(t.text ?? '').trim())
        .filter((t) => t.length > 0);
      const testXml = tests
        .map((t) => `    <test_case>\n${escapeXml(t)}\n    </test_case>`)
        .join('\n');
      const block = testXml
        ? `  <test_cases>\n${testXml}\n  </test_cases>`
        : `  <test_cases></test_cases>`;
      return `<phase>\n${block}\n</phase>`;
    })
    .join('\n');
  return `<phases>\n${inner}\n</phases>`;
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

// Best-effort parse. Returns an array of inner-text-of-phase strings.
// Accepts both `<phase>` and `<phase name="...">` forms.
function parseProblemPhases(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const regex = /<phase\b[^>]*>([\s\S]*?)<\/phase>/gi;
  const out = [];
  let m;
  while ((m = regex.exec(xml)) !== null) {
    out.push(decodeEntities(m[1]).trim());
  }
  return out;
}

// Parse natural_language_tests into an array of arrays of test case strings.
// One outer entry per phase; inner array contains each <test_case> body.
function parseTestsPhases(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const phaseRe = /<phase\b[^>]*>([\s\S]*?)<\/phase>/gi;
  const testRe = /<test_case\b[^>]*>([\s\S]*?)<\/test_case>/gi;
  const out = [];
  let pm;
  while ((pm = phaseRe.exec(xml)) !== null) {
    const body = pm[1];
    const tests = [];
    let tm;
    while ((tm = testRe.exec(body)) !== null) {
      const t = decodeEntities(tm[1]).trim();
      if (t) tests.push(t);
    }
    out.push(tests);
  }
  return out;
}

function makeTestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `t-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeParsedPhases(problemXml, testsXml) {
  const problemTexts = parseProblemPhases(problemXml);
  const testsPerPhase = parseTestsPhases(testsXml);
  const max = Math.max(problemTexts.length, testsPerPhase.length);
  if (max === 0) return null;
  const phases = [];
  for (let i = 0; i < max; i++) {
    const tests = (testsPerPhase[i] || []).map((text) => ({
      id: makeTestId(),
      text,
    }));
    phases.push({
      id: makePhaseId(),
      problemText: problemTexts[i] || '',
      tests: tests.length > 0 ? tests : [{ id: makeTestId(), text: '' }],
      collapsed: false,
    });
  }
  return phases;
}

function makePhaseId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2, 10)}`;
}

function makeEmptyPhase() {
  return {
    id: makePhaseId(),
    problemText: '',
    tests: [{ id: makeTestId(), text: '' }],
    collapsed: false,
  };
}

// Color accents per phase (cycles after 6)
const PHASE_ACCENTS = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-violet-500',
  'border-l-amber-500',
  'border-l-pink-500',
  'border-l-teal-500',
];

function snippet(text, n = 80) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ── Step indicator ──────────────────────────────────────────────────────
const STEPS = [
  { n: 1, label: 'Metadata' },
  { n: 2, label: 'Phases & Tests' },
  { n: 3, label: 'Tags & Attributes' },
];

function StepIndicator({ step, setStep }) {
  return (
    <div
      className="flex items-center gap-1.5 py-1"
      role="tablist"
      aria-label="Wizard steps"
      data-testid="wizard-step-indicator"
    >
      {STEPS.map((s, idx) => {
        const isActive = step === s.n;
        const isDone = step > s.n;
        const clickable = isDone; // only allow going back via the indicator
        return (
          <div key={s.n} className="flex items-center gap-1.5 flex-1">
            <button
              type="button"
              onClick={() => clickable && setStep(s.n)}
              disabled={!clickable && !isActive}
              role="tab"
              aria-selected={isActive}
              className={[
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md flex-1 transition-colors text-left',
                isActive
                  ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
                  : isDone
                  ? 'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer'
                  : 'text-muted-foreground/60 cursor-default',
              ].join(' ')}
              data-testid={`wizard-step-${s.n}`}
            >
              <span
                className={[
                  'flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold font-mono flex-shrink-0',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {isDone ? <Check className="w-3 h-3" /> : s.n}
              </span>
              <span className="text-xs font-medium truncate">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-px flex-shrink-0 w-4 ${
                  step > s.n ? 'bg-emerald-500' : 'bg-border'
                }`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Phased editor sub-component ─────────────────────────────────────────
function PhasedEditor({ phases, setPhases }) {
  const updatePhase = (id, field, value) => {
    setPhases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };
  const removePhase = (id) => {
    setPhases((prev) => prev.filter((p) => p.id !== id));
  };
  const togglePhase = (id) => {
    setPhases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p))
    );
  };
  const addPhase = () => {
    setPhases((prev) => [
      ...prev.map((p) => ({ ...p, collapsed: true })),
      makeEmptyPhase(),
    ]);
  };
  const collapseAll = () => {
    setPhases((prev) => prev.map((p) => ({ ...p, collapsed: true })));
  };
  const expandAll = () => {
    setPhases((prev) => prev.map((p) => ({ ...p, collapsed: false })));
  };

  // Test-case operations (per phase)
  const addTest = (phaseId) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? {
              ...p,
              tests: [...(p.tests || []), { id: makeTestId(), text: '' }],
            }
          : p
      )
    );
  };
  const removeTest = (phaseId, testId) => {
    setPhases((prev) =>
      prev.map((p) => {
        if (p.id !== phaseId) return p;
        const next = (p.tests || []).filter((t) => t.id !== testId);
        return { ...p, tests: next.length > 0 ? next : [{ id: makeTestId(), text: '' }] };
      })
    );
  };
  const updateTest = (phaseId, testId, text) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id !== phaseId
          ? p
          : {
              ...p,
              tests: (p.tests || []).map((t) =>
                t.id === testId ? { ...t, text } : t
              ),
            }
      )
    );
  };

  const allCollapsed = phases.length > 0 && phases.every((p) => p.collapsed);

  return (
    <div className="space-y-2" data-testid="phased-editor">
      {phases.length > 1 && (
        <div className="flex items-center justify-end -mt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={allCollapsed ? expandAll : collapseAll}
            data-testid="phased-toggle-all"
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
        </div>
      )}

      {phases.map((phase, idx) => {
        const accent = PHASE_ACCENTS[idx % PHASE_ACCENTS.length];
        const isCollapsed = !!phase.collapsed;
        const preview = snippet(phase.problemText);
        const testCount = (phase.tests || []).filter((t) => t.text && t.text.trim()).length;
        const totalTests = (phase.tests || []).length;

        return (
          <div
            key={phase.id}
            className={`rounded-md border border-l-4 bg-card transition-colors ${accent} ${
              isCollapsed ? '' : 'shadow-sm'
            }`}
            data-testid={`phase-card-${idx}`}
          >
            {/* Header — always visible */}
            <button
              type="button"
              onClick={() => togglePhase(phase.id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/30 rounded-t-md"
              aria-expanded={!isCollapsed}
              data-testid={`phase-toggle-${idx}`}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <Badge
                variant="secondary"
                className="text-[10px] font-mono flex-shrink-0"
              >
                #{idx + 1}
              </Badge>
              <span className="font-medium text-sm flex-shrink-0">
                Phase {idx + 1}
              </span>
              {isCollapsed && (
                <>
                  {preview ? (
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      · {preview}
                    </span>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/10 ml-1"
                    >
                      empty
                    </Badge>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                    {testCount} test{testCount === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {!isCollapsed && <span className="flex-1" />}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (phases.length > 1) removePhase(phase.id);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && phases.length > 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    removePhase(phase.id);
                  }
                }}
                className={`h-7 w-7 inline-flex items-center justify-center rounded-md flex-shrink-0 ${
                  phases.length <= 1
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer'
                }`}
                title={
                  phases.length <= 1
                    ? 'At least one phase is required'
                    : 'Remove phase'
                }
                aria-disabled={phases.length <= 1}
                data-testid={`phase-remove-${idx}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </span>
            </button>

            {/* Expanded body */}
            {!isCollapsed && (
              <div className="px-3 pb-3 pt-1 space-y-4 border-t bg-muted/20">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Problem statement
                  </Label>
                  <Textarea
                    value={phase.problemText}
                    onChange={(e) =>
                      updatePhase(phase.id, 'problemText', e.target.value)
                    }
                    placeholder="Describe what the agent must do in this phase. Plain text — no XML tags needed."
                    className="mt-1 text-sm min-h-[90px] bg-background"
                    data-testid={`phase-problem-${idx}`}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Test cases
                    </Label>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {testCount}/{totalTests} filled
                    </span>
                  </div>

                  <div className="mt-1.5 space-y-2">
                    {(phase.tests || []).map((t, tIdx) => (
                      <div
                        key={t.id}
                        className="flex items-start gap-1.5"
                        data-testid={`phase-${idx}-test-${tIdx}`}
                      >
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono mt-1 flex-shrink-0"
                        >
                          {tIdx + 1}
                        </Badge>
                        <Textarea
                          value={t.text}
                          onChange={(e) =>
                            updateTest(phase.id, t.id, e.target.value)
                          }
                          placeholder={
                            tIdx === 0
                              ? "e.g. When the user clicks Save, the note is persisted."
                              : 'Another test case…'
                          }
                          className="text-sm min-h-[60px] bg-background flex-1"
                          data-testid={`phase-${idx}-test-${tIdx}-input`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 mt-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                          onClick={() => removeTest(phase.id, t.id)}
                          disabled={(phase.tests || []).length <= 1}
                          title={
                            (phase.tests || []).length <= 1
                              ? 'At least one test case is required'
                              : 'Remove test case'
                          }
                          data-testid={`phase-${idx}-test-${tIdx}-remove`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 text-[11px] border-dashed text-muted-foreground hover:text-foreground"
                    onClick={() => addTest(phase.id)}
                    data-testid={`phase-${idx}-add-test`}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add test case
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full border-dashed text-muted-foreground hover:text-foreground"
        onClick={addPhase}
        data-testid="add-phase-btn"
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Add phase
      </Button>
    </div>
  );
}

// ── Main modal ──────────────────────────────────────────────────────────
export function DatasetEditorModal({ open, onClose, onSaved, dataset }) {
  const isEditing = !!dataset?.id;

  // Core fields
  const [datasetType, setDatasetType] = useState('scratch_bench_phased');
  const [instanceId, setInstanceId] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState([]);

  // Phased editor state (scratch_bench_phased only)
  const [phases, setPhases] = useState([makeEmptyPhase()]);

  // Raw XML state (non-phased types + fallback when parsing fails)
  const [problemStatement, setProblemStatement] = useState('');
  const [naturalLanguageTests, setNaturalLanguageTests] = useState('');
  const [rawMode, setRawMode] = useState(false); // forces raw textareas even for scratch_bench_phased

  // Attribute fields (type-specific)
  const [subagents, setSubagents] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [image, setImage] = useState('');
  const [agentName, setAgentName] = useState('');
  const [modelName, setModelName] = useState('');
  const [repo, setRepo] = useState('');
  const [ephJobId, setEphJobId] = useState('');
  const [testingHitl, setTestingHitl] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [bugFixStatus, setBugFixStatus] = useState('');

  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [step, setStep] = useState(1); // 1: metadata, 2: phases, 3: tags + attributes

  const isPhasedType = datasetType === 'scratch_bench_phased';
  const usePhasedEditor = isPhasedType && !rawMode;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    if (dataset) {
      const t = dataset.dataset_type || 'scratch_bench_phased';
      setDatasetType(t);
      setInstanceId(dataset.instance_id || '');
      setProblemStatement(dataset.problem_statement || '');
      setNaturalLanguageTests(dataset.natural_language_tests || '');
      setDescription(dataset.description || '');
      setTags(dataset.tags || []);
      setTagsInput('');

      if (t === 'scratch_bench_phased') {
        const parsed = mergeParsedPhases(
          dataset.problem_statement || '',
          dataset.natural_language_tests || ''
        );
        if (parsed && parsed.length > 0) {
          setPhases(parsed);
          setRawMode(false);
        } else {
          // Couldn't parse — fall back to raw editing
          setPhases([makeEmptyPhase()]);
          setRawMode(true);
        }
      } else {
        setPhases([makeEmptyPhase()]);
        setRawMode(false);
      }

      const attrs = dataset.attributes || {};
      setSubagents(attrs.subagents || '');
      setPreviewUrl(attrs.preview_url || '');
      setImage(attrs.image || '');
      setAgentName(attrs.agent_name || '');
      setModelName(attrs.model_name || '');
      setRepo(attrs.repo || '');
      setEphJobId(attrs.eph_job_id || '');
      setTestingHitl(attrs.testing_hitl || '');
      setBugDescription(attrs.Bug_description || '');
      setBugFixStatus(attrs.Bug_fix_status || '');
    } else {
      setDatasetType('scratch_bench_phased');
      setInstanceId('');
      setPhases([makeEmptyPhase()]);
      setProblemStatement('');
      setNaturalLanguageTests('');
      setDescription('');
      setTags([]);
      setTagsInput('');
      setRawMode(false);
      setSubagents('');
      setPreviewUrl('');
      setImage('');
      setAgentName('');
      setModelName('');
      setRepo('');
      setEphJobId('');
      setTestingHitl('');
      setBugDescription('');
      setBugFixStatus('');
    }
  }, [open, dataset]);

  const handleTypeChange = (newType) => {
    setDatasetType(newType);
    if (!isEditing) {
      if (newType === 'scratch_bench_phased') {
        setPhases([makeEmptyPhase()]);
        setProblemStatement('');
        setNaturalLanguageTests('');
        setRawMode(false);
      } else {
        setProblemStatement('');
        setNaturalLanguageTests('');
      }
    }
  };

  // Serialized XML — live-computed for preview
  const generatedProblemXml = useMemo(
    () => (usePhasedEditor ? phasesToProblemXml(phases) : ''),
    [usePhasedEditor, phases]
  );
  const generatedTestsXml = useMemo(
    () => (usePhasedEditor ? phasesToTestsXml(phases) : ''),
    [usePhasedEditor, phases]
  );

  const addTag = () => {
    const tag = tagsInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagsInput('');
    }
  };

  const removeTag = (t) => setTags(tags.filter((x) => x !== t));

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const buildAttributes = () => {
    const attrs = {};
    if (datasetType === 'scratch_bench_phased') {
      if (subagents) attrs.subagents = subagents;
      if (previewUrl) attrs.preview_url = previewUrl;
      if (agentName) attrs.agent_name = agentName;
    } else if (datasetType === 'bug_bench') {
      if (repo) attrs.repo = repo;
      if (ephJobId) attrs.eph_job_id = ephJobId;
      if (image) attrs.image = image;
      if (agentName) attrs.agent_name = agentName;
      if (modelName) attrs.model_name = modelName;
    } else if (datasetType === 'test_report_bench') {
      if (repo) attrs.repo = repo;
      if (ephJobId) attrs.eph_job_id = ephJobId;
      if (testingHitl) attrs.testing_hitl = testingHitl;
      if (bugDescription) attrs.Bug_description = bugDescription;
      if (bugFixStatus) attrs.Bug_fix_status = bugFixStatus;
    }
    return attrs;
  };

  const validateBeforePreview = () => {
    if (!datasetType) {
      toast.error('Dataset type is required');
      return false;
    }
    if (!isEditing && !instanceId.trim()) {
      toast.error('Instance ID is required');
      return false;
    }
    if (usePhasedEditor) {
      if (phases.length === 0) {
        toast.error('Add at least one phase');
        return false;
      }
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        if (!p.problemText || !p.problemText.trim()) {
          toast.error(`Phase ${i + 1}: problem statement is required`);
          return false;
        }
        const filled = (p.tests || []).filter((t) => t.text && t.text.trim());
        if (filled.length === 0) {
          toast.error(`Phase ${i + 1}: add at least one test case`);
          return false;
        }
      }
    } else {
      if (!problemStatement.trim()) {
        toast.error('Problem Statement is required');
        return false;
      }
      if (!naturalLanguageTests.trim()) {
        toast.error('Natural Language Tests is required');
        return false;
      }
    }
    return true;
  };

  // Step validation helpers
  const canAdvanceFromStep1 = () => {
    if (!datasetType) return false;
    if (!isEditing && !instanceId.trim()) return false;
    return true;
  };

  const canAdvanceFromStep2 = () => {
    if (usePhasedEditor) {
      if (phases.length === 0) return false;
      return phases.every((p) => {
        if (!p.problemText || !p.problemText.trim()) return false;
        const filled = (p.tests || []).filter((t) => t.text && t.text.trim());
        return filled.length > 0;
      });
    }
    return problemStatement.trim() && naturalLanguageTests.trim();
  };

  const handleNext = () => {
    if (step === 1) {
      if (!canAdvanceFromStep1()) {
        toast.error(
          !isEditing && !instanceId.trim()
            ? 'Instance ID is required'
            : 'Dataset type is required'
        );
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!canAdvanceFromStep2()) {
        if (usePhasedEditor) {
          for (let i = 0; i < phases.length; i++) {
            const p = phases[i];
            if (!p.problemText || !p.problemText.trim()) {
              toast.error(`Phase ${i + 1}: problem statement is required`);
              return;
            }
            const filled = (p.tests || []).filter((t) => t.text && t.text.trim());
            if (filled.length === 0) {
              toast.error(`Phase ${i + 1}: add at least one test case`);
              return;
            }
          }
        } else if (!problemStatement.trim()) {
          toast.error('Problem Statement is required');
        } else {
          toast.error('Natural Language Tests is required');
        }
        return;
      }
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleOpenPreview = () => {
    if (!validateBeforePreview()) return;
    setPreviewOpen(true);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      const problem = usePhasedEditor ? generatedProblemXml : problemStatement;
      const tests = usePhasedEditor ? generatedTestsXml : naturalLanguageTests;
      const payload = {
        dataset_type: datasetType,
        problem_statement: problem,
        natural_language_tests: tests,
        description: description,
        tags: tags,
        attributes: buildAttributes(),
      };

      if (isEditing) {
        await updateDataset(dataset.id, payload);
        toast.success('Dataset updated (new version created)');
      } else {
        payload.instance_id = instanceId.trim();
        await createDataset(payload);
        toast.success('Dataset created and activated');
      }
      setPreviewOpen(false);
      onSaved();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to save dataset'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
          data-testid="dataset-editor-modal"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEditing ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {isEditing ? 'Edit Dataset' : 'New Dataset'}
            </DialogTitle>
            {isEditing && (
              <p className="text-xs text-muted-foreground mt-1">
                Editing:{' '}
                <span className="font-mono">
                  {dataset.name || dataset.instance_id}
                </span>{' '}
                (v{dataset.version})
              </p>
            )}
          </DialogHeader>

          {/* Step indicator */}
          <StepIndicator step={step} setStep={setStep} />

          <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">
            <div className="space-y-5 py-2">
              {/* ── STEP 1 — Metadata ───────────────────────────────── */}
              {step === 1 && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Dataset Type *</Label>
                    <Select
                      value={datasetType}
                      onValueChange={handleTypeChange}
                      disabled={isEditing}
                    >
                      <SelectTrigger className="mt-1" data-testid="dataset-type-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATASET_TYPE_OPTIONS.map((dt) => (
                          <SelectItem key={dt.value} value={dt.value}>
                            {dt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">
                      Instance ID {!isEditing && '*'}
                    </Label>
                    <Input
                      value={instanceId}
                      onChange={(e) => setInstanceId(e.target.value)}
                      placeholder="e.g. my-problem-name"
                      className="mt-1 font-mono text-sm"
                      disabled={isEditing}
                      data-testid="dataset-instance-id-input"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium">Description</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of this dataset"
                    className="mt-1 text-sm"
                    data-testid="dataset-description-input"
                  />
                </div>
              </div>
              )}

              {/* ── STEP 2 — Phases / Raw editor ─────────────────────── */}
              {step === 2 && (
              <div className="space-y-4">
              {/* Phased OR raw editor */}
              {isPhasedType && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">
                      Phases *
                    </Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Add one or more phases. Write in plain text — XML is generated for
                      you at create time.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setRawMode((v) => !v)}
                    data-testid="toggle-raw-mode"
                  >
                    <Code2 className="w-3 h-3 mr-1" />
                    {rawMode ? 'Switch to phased editor' : 'Edit raw XML'}
                  </Button>
                </div>
              )}

              {usePhasedEditor ? (
                <PhasedEditor phases={phases} setPhases={setPhases} />
              ) : (
                <>
                  <div>
                    <Label className="text-xs font-medium">
                      Problem Statement *
                    </Label>
                    <Textarea
                      value={problemStatement}
                      onChange={(e) => setProblemStatement(e.target.value)}
                      placeholder="Enter the problem statement..."
                      className="mt-1 font-mono text-xs min-h-[120px]"
                      data-testid="dataset-problem-statement-textarea"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">
                      Natural Language Tests *
                    </Label>
                    <Textarea
                      value={naturalLanguageTests}
                      onChange={(e) => setNaturalLanguageTests(e.target.value)}
                      placeholder="Enter test cases..."
                      className="mt-1 font-mono text-xs min-h-[80px]"
                      data-testid="dataset-nl-tests-textarea"
                    />
                  </div>
                </>
              )}
              </div>
              )}

              {/* ── STEP 3 — Tags + Attributes ───────────────────────── */}
              {step === 3 && (
              <div className="space-y-5">

              {/* Tags */}
              <div>
                <Label className="text-xs font-medium">Tags</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add a tag and press Enter"
                    className="text-sm flex-1"
                    data-testid="dataset-tag-input"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addTag}
                    type="button"
                    data-testid="add-tag-btn"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tags.map((t) => (
                      <Badge
                        key={t}
                        variant="secondary"
                        className="text-xs flex items-center gap-1"
                      >
                        {t}
                        <button
                          onClick={() => removeTag(t)}
                          className="hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Type-specific Attributes */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Attributes (
                  {DATASET_TYPE_OPTIONS.find((d) => d.value === datasetType)?.label}
                  )
                </p>

                {datasetType === 'scratch_bench_phased' && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Subagents</Label>
                      <Input
                        value={subagents}
                        onChange={(e) => setSubagents(e.target.value)}
                        placeholder="Subagents"
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-subagents"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Preview URL</Label>
                      <Input
                        value={previewUrl}
                        onChange={(e) => setPreviewUrl(e.target.value)}
                        placeholder="https://..."
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-preview-url"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Agent Name</Label>
                      <Input
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        placeholder="Agent name"
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-agent-name"
                      />
                    </div>
                  </div>
                )}

                {datasetType === 'bug_bench' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Repo *</Label>
                        <Input
                          value={repo}
                          onChange={(e) => setRepo(e.target.value)}
                          placeholder="owner/repo"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-repo"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Eph Job ID *</Label>
                        <Input
                          value={ephJobId}
                          onChange={(e) => setEphJobId(e.target.value)}
                          placeholder="Job ID"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-eph-job-id"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Image</Label>
                      <Input
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder="Docker image"
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-image"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Agent Name</Label>
                        <Input
                          value={agentName}
                          onChange={(e) => setAgentName(e.target.value)}
                          placeholder="Agent name"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-agent-name"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Model Name</Label>
                        <Input
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                          placeholder="Model name"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-model-name"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {datasetType === 'test_report_bench' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Repo *</Label>
                        <Input
                          value={repo}
                          onChange={(e) => setRepo(e.target.value)}
                          placeholder="owner/repo"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-repo"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Eph Job ID *</Label>
                        <Input
                          value={ephJobId}
                          onChange={(e) => setEphJobId(e.target.value)}
                          placeholder="Job ID"
                          className="mt-1 text-sm font-mono"
                          data-testid="attr-eph-job-id"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Testing HITL</Label>
                      <Input
                        value={testingHitl}
                        onChange={(e) => setTestingHitl(e.target.value)}
                        placeholder="Testing HITL value"
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-testing-hitl"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Bug Description</Label>
                      <Textarea
                        value={bugDescription}
                        onChange={(e) => setBugDescription(e.target.value)}
                        placeholder="Describe the bug..."
                        className="mt-1 text-xs font-mono min-h-[60px]"
                        data-testid="attr-bug-description"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Bug Fix Status</Label>
                      <Input
                        value={bugFixStatus}
                        onChange={(e) => setBugFixStatus(e.target.value)}
                        placeholder="e.g. fixed, pending"
                        className="mt-1 text-sm font-mono"
                        data-testid="attr-bug-fix-status"
                      />
                    </div>
                  </div>
                )}
              </div>
              </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-4 border-t sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={saving}
                data-testid="dataset-cancel-btn"
              >
                Cancel
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {step > 1 && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={saving}
                  data-testid="wizard-back-btn"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              {step < 3 ? (
                <Button
                  onClick={handleNext}
                  disabled={saving}
                  data-testid="wizard-next-btn"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleOpenPreview}
                  disabled={saving}
                  data-testid="dataset-save-btn"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  {isEditing ? 'Preview & Update' : 'Preview & Create'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog (nested) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="max-w-3xl max-h-[90vh] flex flex-col"
          data-testid="dataset-preview-modal"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Review generated XML
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              This is exactly what will be saved for{' '}
              <span className="font-mono">
                {instanceId || dataset?.instance_id || 'this dataset'}
              </span>
              .
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar min-h-0">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Problem statement XML
                </Label>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {usePhasedEditor ? `${phases.length} phase(s)` : 'raw'}
                </Badge>
              </div>
              <pre
                className="rounded-md border bg-muted/30 p-3 text-[11px] font-mono overflow-auto max-h-[260px] whitespace-pre-wrap"
                data-testid="preview-problem-xml"
              >
                {usePhasedEditor ? generatedProblemXml : problemStatement}
              </pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Natural language tests XML
                </Label>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {usePhasedEditor ? `${phases.length} phase(s)` : 'raw'}
                </Badge>
              </div>
              <pre
                className="rounded-md border bg-muted/30 p-3 text-[11px] font-mono overflow-auto max-h-[260px] whitespace-pre-wrap"
                data-testid="preview-tests-xml"
              >
                {usePhasedEditor ? generatedTestsXml : naturalLanguageTests}
              </pre>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(false)}
              disabled={saving}
              data-testid="preview-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to edit
            </Button>
            <Button
              onClick={handleConfirmSave}
              disabled={saving}
              data-testid="preview-confirm-btn"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isEditing ? 'Confirm & Update' : 'Confirm & Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
