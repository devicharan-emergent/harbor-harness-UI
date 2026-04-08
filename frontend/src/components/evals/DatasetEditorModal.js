import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { createDataset, updateDataset } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';
import { toast } from 'sonner';
import { Loader2, Save, X, Plus, ChevronRight } from 'lucide-react';

const DATASET_TYPE_OPTIONS = [
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
];

const FORMAT_PRESETS = {
  scratch_bench_phased: {
    problemStatement: '<phases>\n  <phase name="Phase 1">\n    \n  </phase>\n</phases>',
    naturalLanguageTests: '<phases>\n  <phase name="Phase 1">\n    \n  </phase>\n</phases>',
  },
  bug_bench: {
    problemStatement: '',
    naturalLanguageTests: '',
  },
  test_report_bench: {
    problemStatement: '',
    naturalLanguageTests: '',
  },
};

export function DatasetEditorModal({ open, onClose, onSaved, dataset }) {
  const isEditing = !!dataset?.id;

  // Core fields
  const [datasetType, setDatasetType] = useState('scratch_bench_phased');
  const [instanceId, setInstanceId] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [naturalLanguageTests, setNaturalLanguageTests] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState([]);

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

  useEffect(() => {
    if (open) {
      if (dataset) {
        setDatasetType(dataset.dataset_type || 'scratch_bench_phased');
        setInstanceId(dataset.instance_id || '');
        setProblemStatement(dataset.problem_statement || '');
        setNaturalLanguageTests(dataset.natural_language_tests || '');
        setDescription(dataset.description || '');
        setTags(dataset.tags || []);
        setTagsInput('');

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
        const preset = FORMAT_PRESETS['scratch_bench_phased'];
        setProblemStatement(preset.problemStatement);
        setNaturalLanguageTests(preset.naturalLanguageTests);
        setDescription('');
        setTags([]);
        setTagsInput('');
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
    }
  }, [open, dataset]);

  // When dataset type changes on new dataset, update format presets
  const handleTypeChange = (newType) => {
    setDatasetType(newType);
    if (!isEditing) {
      const preset = FORMAT_PRESETS[newType] || { problemStatement: '', naturalLanguageTests: '' };
      setProblemStatement(preset.problemStatement);
      setNaturalLanguageTests(preset.naturalLanguageTests);
    }
  };

  const addTag = () => {
    const tag = tagsInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagsInput('');
    }
  };

  const removeTag = (t) => setTags(tags.filter(x => x !== t));

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

  const handleSave = async () => {
    if (!datasetType) {
      toast.error('Dataset type is required');
      return;
    }
    if (!isEditing && !instanceId.trim()) {
      toast.error('Instance ID is required');
      return;
    }
    if (!problemStatement.trim()) {
      toast.error('Problem Statement is required');
      return;
    }
    if (!naturalLanguageTests.trim()) {
      toast.error('Natural Language Tests is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        dataset_type: datasetType,
        problem_statement: problemStatement,
        natural_language_tests: naturalLanguageTests,
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
      onSaved();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to save dataset'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dataset-editor-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {isEditing ? 'Edit Dataset' : 'New Dataset'}
          </DialogTitle>
          {isEditing && (
            <p className="text-xs text-muted-foreground mt-1">
              Editing: <span className="font-mono">{dataset.name || dataset.instance_id}</span> (v{dataset.version})
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
                  <Select value={datasetType} onValueChange={handleTypeChange} disabled={isEditing}>
                    <SelectTrigger className="mt-1" data-testid="dataset-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATASET_TYPE_OPTIONS.map(dt => (
                        <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Instance ID {!isEditing && '*'}</Label>
                  <Input
                    value={instanceId}
                    onChange={e => setInstanceId(e.target.value)}
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
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Brief description of this dataset"
                  className="mt-1 text-sm"
                  data-testid="dataset-description-input"
                />
              </div>
            </div>

            <Separator />

            {/* Problem Statement */}
            <div>
              <Label className="text-xs font-medium">Problem Statement *</Label>
              <Textarea
                value={problemStatement}
                onChange={e => setProblemStatement(e.target.value)}
                placeholder="Enter the problem statement..."
                className="mt-1 font-mono text-xs min-h-[120px]"
                data-testid="dataset-problem-statement-textarea"
              />
            </div>

            {/* NL Tests */}
            <div>
              <Label className="text-xs font-medium">Natural Language Tests *</Label>
              <Textarea
                value={naturalLanguageTests}
                onChange={e => setNaturalLanguageTests(e.target.value)}
                placeholder="Enter test cases..."
                className="mt-1 font-mono text-xs min-h-[80px]"
                data-testid="dataset-nl-tests-textarea"
              />
            </div>

            <Separator />

            {/* Tags */}
            <div>
              <Label className="text-xs font-medium">Tags</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add a tag and press Enter"
                  className="text-sm flex-1"
                  data-testid="dataset-tag-input"
                />
                <Button variant="outline" size="sm" onClick={addTag} type="button" data-testid="add-tag-btn">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tags.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs flex items-center gap-1">
                      {t}
                      <button onClick={() => removeTag(t)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Type-specific Attributes */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Attributes ({DATASET_TYPE_OPTIONS.find(d => d.value === datasetType)?.label})
              </p>

              {datasetType === 'scratch_bench_phased' && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Subagents</Label>
                    <Input value={subagents} onChange={e => setSubagents(e.target.value)} placeholder="Subagents" className="mt-1 text-sm font-mono" data-testid="attr-subagents" />
                  </div>
                  <div>
                    <Label className="text-xs">Preview URL</Label>
                    <Input value={previewUrl} onChange={e => setPreviewUrl(e.target.value)} placeholder="https://..." className="mt-1 text-sm font-mono" data-testid="attr-preview-url" />
                  </div>
                  <div>
                    <Label className="text-xs">Agent Name</Label>
                    <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Agent name" className="mt-1 text-sm font-mono" data-testid="attr-agent-name" />
                  </div>
                </div>
              )}

              {datasetType === 'bug_bench' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Repo *</Label>
                      <Input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" className="mt-1 text-sm font-mono" data-testid="attr-repo" />
                    </div>
                    <div>
                      <Label className="text-xs">Eph Job ID *</Label>
                      <Input value={ephJobId} onChange={e => setEphJobId(e.target.value)} placeholder="Job ID" className="mt-1 text-sm font-mono" data-testid="attr-eph-job-id" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Image</Label>
                    <Input value={image} onChange={e => setImage(e.target.value)} placeholder="Docker image" className="mt-1 text-sm font-mono" data-testid="attr-image" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Agent Name</Label>
                      <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Agent name" className="mt-1 text-sm font-mono" data-testid="attr-agent-name" />
                    </div>
                    <div>
                      <Label className="text-xs">Model Name</Label>
                      <Input value={modelName} onChange={e => setModelName(e.target.value)} placeholder="Model name" className="mt-1 text-sm font-mono" data-testid="attr-model-name" />
                    </div>
                  </div>
                </div>
              )}

              {datasetType === 'test_report_bench' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Repo *</Label>
                      <Input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" className="mt-1 text-sm font-mono" data-testid="attr-repo" />
                    </div>
                    <div>
                      <Label className="text-xs">Eph Job ID *</Label>
                      <Input value={ephJobId} onChange={e => setEphJobId(e.target.value)} placeholder="Job ID" className="mt-1 text-sm font-mono" data-testid="attr-eph-job-id" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Testing HITL</Label>
                    <Input value={testingHitl} onChange={e => setTestingHitl(e.target.value)} placeholder="Testing HITL value" className="mt-1 text-sm font-mono" data-testid="attr-testing-hitl" />
                  </div>
                  <div>
                    <Label className="text-xs">Bug Description</Label>
                    <Textarea value={bugDescription} onChange={e => setBugDescription(e.target.value)} placeholder="Describe the bug..." className="mt-1 text-xs font-mono min-h-[60px]" data-testid="attr-bug-description" />
                  </div>
                  <div>
                    <Label className="text-xs">Bug Fix Status</Label>
                    <Input value={bugFixStatus} onChange={e => setBugFixStatus(e.target.value)} placeholder="e.g. fixed, pending" className="mt-1 text-sm font-mono" data-testid="attr-bug-fix-status" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="dataset-cancel-btn">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} data-testid="dataset-save-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
