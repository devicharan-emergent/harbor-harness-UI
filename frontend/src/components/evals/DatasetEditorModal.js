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
const escapeAttr = (s) => escapeXml(s).replace(/"/g, '&quot;');

function indentBlock(text, indent = '    ') {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t
    .split('\n')
    .map((l) => indent + l)
    .join('\n');
}

function phasesToXml(phases, field) {
  // field: 'problemText' | 'testsText'
  const inner = phases
    .map((p) => {
      const body = indentBlock(escapeXml(p[field]), '    ');
      const open = `  <phase name="${escapeAttr(p.name || '')}">`;
      const close = `  </phase>`;
      return body ? `${open}\n${body}\n${close}` : `${open}\n${close}`;
    })
    .join('\n');
  return `<phases>\n${inner}\n</phases>`;
}

// Best-effort parse: returns an array of { name, content } or [] if unparseable.
function parsePhaseBlocks(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const regex = /<phase\b([^>]*)>([\s\S]*?)<\/phase>/gi;
  const out = [];
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const attrs = m[1] || '';
    const nameMatch = attrs.match(/name\s*=\s*"([^"]*)"/i);
    let content = m[2];
    // Unescape the basic entities we escape on serialize
    content = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    // Trim leading/trailing whitespace including indent
    content = content.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
    // Remove leading 4-space indent (if present on every line)
    const lines = content.split('\n');
    const allIndented =
      lines.length > 0 && lines.every((l) => l === '' || l.startsWith('    '));
    const unindented = allIndented
      ? lines.map((l) => l.replace(/^ {4}/, '')).join('\n')
      : content;
    out.push({ name: nameMatch?.[1] || '', content: unindented.trim() });
  }
  return out;
}

function makePhaseId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeParsedPhases(problemXml, testsXml) {
  const p = parsePhaseBlocks(problemXml);
  const t = parsePhaseBlocks(testsXml);
  const max = Math.max(p.length, t.length);
  if (max === 0) return null;
  const phases = [];
  for (let i = 0; i < max; i++) {
    phases.push({
      id: makePhaseId(),
      name: p[i]?.name || t[i]?.name || `Phase ${i + 1}`,
      problemText: p[i]?.content || '',
      testsText: t[i]?.content || '',
    });
  }
  return phases;
}

function makeEmptyPhase(index) {
  return {
    id: makePhaseId(),
    name: `Phase ${index + 1}`,
    problemText: '',
    testsText: '',
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
      // collapse existing phases so the new one gets focus
      ...prev.map((p) => ({ ...p, collapsed: true })),
      makeEmptyPhase(prev.length),
    ]);
  };
  const collapseAll = () => {
    setPhases((prev) => prev.map((p) => ({ ...p, collapsed: true })));
  };
  const expandAll = () => {
    setPhases((prev) => prev.map((p) => ({ ...p, collapsed: false })));
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
        const filledCount = [phase.problemText, phase.testsText].filter(
          (v) => v && v.trim()
        ).length;

        return (
          <div
            key={phase.id}
            className={`rounded-md border border-l-4 bg-card transition-colors ${accent} ${
              isCollapsed ? '' : 'shadow-sm'
            }`}
            data-testid={`phase-card-${idx}`}
          >
            {/* Header — always visible */}
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                onClick={() => togglePhase(phase.id)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? 'Expand phase' : 'Collapse phase'}
                data-testid={`phase-toggle-${idx}`}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                />
              </button>

              <Badge
                variant="secondary"
                className="text-[10px] font-mono flex-shrink-0"
              >
                #{idx + 1}
              </Badge>

              {isCollapsed ? (
                <button
                  type="button"
                  onClick={() => togglePhase(phase.id)}
                  className="flex-1 flex items-center gap-2 min-w-0 text-left hover:text-foreground"
                >
                  <span className="font-medium text-sm truncate">
                    {phase.name || `Phase ${idx + 1}`}
                  </span>
                  {preview ? (
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      · {preview}
                    </span>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/10"
                    >
                      empty
                    </Badge>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                    {filledCount}/2
                  </span>
                </button>
              ) : (
                <Input
                  value={phase.name}
                  onChange={(e) => updatePhase(phase.id, 'name', e.target.value)}
                  placeholder={`Phase ${idx + 1}`}
                  className="h-8 text-sm font-medium flex-1 border-0 shadow-none focus-visible:ring-1 px-2"
                  data-testid={`phase-name-${idx}`}
                />
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => removePhase(phase.id)}
                disabled={phases.length <= 1}
                title={
                  phases.length <= 1
                    ? 'At least one phase is required'
                    : 'Remove phase'
                }
                data-testid={`phase-remove-${idx}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Expanded body */}
            {!isCollapsed && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t bg-muted/20">
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
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Test cases
                  </Label>
                  <Textarea
                    value={phase.testsText}
                    onChange={(e) =>
                      updatePhase(phase.id, 'testsText', e.target.value)
                    }
                    placeholder="One test per line, e.g. 'When the user clicks Save, the note is persisted.'"
                    className="mt-1 text-sm min-h-[80px] bg-background"
                    data-testid={`phase-tests-${idx}`}
                  />
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
  const [phases, setPhases] = useState([makeEmptyPhase(0)]);

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

  const isPhasedType = datasetType === 'scratch_bench_phased';
  const usePhasedEditor = isPhasedType && !rawMode;

  useEffect(() => {
    if (!open) return;
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
          setPhases([makeEmptyPhase(0)]);
          setRawMode(true);
        }
      } else {
        setPhases([makeEmptyPhase(0)]);
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
      setPhases([makeEmptyPhase(0)]);
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
        setPhases([makeEmptyPhase(0)]);
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
    () => (usePhasedEditor ? phasesToXml(phases, 'problemText') : ''),
    [usePhasedEditor, phases]
  );
  const generatedTestsXml = useMemo(
    () => (usePhasedEditor ? phasesToXml(phases, 'testsText') : ''),
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
      const missing = phases.findIndex(
        (p) => !p.problemText.trim() || !p.testsText.trim()
      );
      if (missing >= 0) {
        toast.error(
          `Phase ${missing + 1}: both problem statement and test cases are required`
        );
        return false;
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

          <div className="flex-1 overflow-y-auto pr-2 min-h-0">
            <div className="space-y-5 py-2">
              {/* Core Fields */}
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

              <Separator />

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

              <Separator />

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
          </div>

          <DialogFooter className="gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
              data-testid="dataset-cancel-btn"
            >
              Cancel
            </Button>
            <Button onClick={handleOpenPreview} disabled={saving} data-testid="dataset-save-btn">
              <Eye className="w-4 h-4 mr-2" />
              {isEditing ? 'Preview & Update' : 'Preview & Create'}
            </Button>
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
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 min-h-0">
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
