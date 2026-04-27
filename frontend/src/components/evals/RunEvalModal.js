import { useState, useEffect, useCallback } from 'react';
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
import { listDatasets, listDatasetsByType, getDatasetForProblem, submitEvalJobs } from '@/services/evalApi';
import agentApi from '@/lib/api';
import { toast } from 'sonner';
import { X, Loader2, Rocket, FileText, Search, ChevronRight, Users, Layers, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { parseApiError } from '@/lib/errorUtils';
import { useEnv } from '@/components/layout/EnvSwitcher';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
];

// ── Pair Row ──────────────────────────────────────────────────────────
function PairRow({ pair, index, total, agents, problems, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs bg-card/50 border-border/50 hover:border-border transition-colors"
      data-testid={`pair-row-${pair.id}`}
    >
      {/* Move up/down */}
      <div className="flex flex-col flex-shrink-0">
        <button
          onClick={() => onMoveUp(pair.id)}
          disabled={index === 0}
          className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed p-0.5 transition-colors"
          data-testid={`move-up-${pair.id}`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onMoveDown(pair.id)}
          disabled={index === total - 1}
          className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed p-0.5 transition-colors"
          data-testid={`move-down-${pair.id}`}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Position indicator */}
      <div className="flex-shrink-0 w-6 text-center">
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground font-mono">
          {index + 1}
        </Badge>
      </div>

      {/* Agent selector */}
      <Select
        value={pair.agentId || '_none'}
        onValueChange={(val) => onUpdate(pair.id, 'agentId', val === '_none' ? null : val)}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs" data-testid={`pair-agent-select-${pair.id}`}>
          <SelectValue placeholder="No agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">No agent</SelectItem>
          {agents.map(a => (
            <SelectItem key={a.id} value={a.id}>
              {a.name || a.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />

      {/* Problem selector */}
      <Select
        value={pair.problemName || ''}
        onValueChange={(val) => onUpdate(pair.id, 'problemName', val)}
      >
        <SelectTrigger className="flex-1 h-8 text-xs font-mono" data-testid={`pair-problem-select-${pair.id}`}>
          <SelectValue placeholder="Select problem" />
        </SelectTrigger>
        <SelectContent>
          {problems.map(p => (
            <SelectItem key={p.name} value={p.name}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Remove */}
      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0 h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(pair.id)}
        data-testid={`remove-pair-${pair.id}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────
export function RunEvalModal({ open, onClose }) {
  const navigate = useNavigate();
  const { cortexUrl: envCortexUrl } = useEnv();
  const [step, setStep] = useState(1); // 1: problems, 2: agents, 3: pair & order, 4: configure, 5: review

  // Problem selection
  const [searchQuery, setSearchQuery] = useState('');
  const [datasetType, setDatasetType] = useState('all');
  const [datasets, setDatasets] = useState([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectedProblems, setSelectedProblems] = useState([]);

  // Agent selection
  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [agentSearch, setAgentSearch] = useState('');

  // Pairs
  const [pairs, setPairs] = useState([]);

  // Group ID (mandatory tag for batch jobs)
  const [groupId, setGroupId] = useState('');

  // Resources
  const [cpus, setCpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [storageGb, setStorageGb] = useState(10);
  const [headed, setHeaded] = useState(true);
  const [forceBuild, setForceBuild] = useState(false);
  const [userId, setUserId] = useState('acm-user');

  // Experiment config
  const [showExpConfig, setShowExpConfig] = useState(false);
  const [expImage, setExpImage] = useState('');
  const [expModelName, setExpModelName] = useState('');
  const [expCortexUrl, setExpCortexUrl] = useState('');

  // Template
  const [templateName, setTemplateName] = useState('');

  // Free-text agent_name override. When non-empty this wins over the
  // agent(s) chosen in Step 2 and is sent at the batch level.
  const [agentNameOverride, setAgentNameOverride] = useState('');

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

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await agentApi.list();
      setAgents(data || []);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchDatasets();
      fetchAgents();
    }
  }, [open, fetchDatasets, fetchAgents]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedProblems([]);
      setSelectedAgents([]);
      setPairs([]);
      setSelectedPreview(null);
      setSearchQuery('');
      setAgentSearch('');
      setAgentNameOverride('');
    }
  }, [open]);

  // Generate pairs when entering step 3
  const generatePairs = () => {
    const newPairs = [];
    let id = Date.now();
    if (selectedAgents.length > 0) {
      for (const agent of selectedAgents) {
        for (const problem of selectedProblems) {
          newPairs.push({
            id: String(id++),
            agentId: agent.id,
            agentName: agent.name,
            problemName: problem.name,
          });
        }
      }
    } else {
      for (const problem of selectedProblems) {
        newPairs.push({
          id: String(id++),
          agentId: null,
          agentName: null,
          problemName: problem.name,
        });
      }
    }
    setPairs(newPairs);
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

  const filteredAgents = agents.filter(a => {
    if (!agentSearch) return true;
    const q = agentSearch.toLowerCase();
    return (
      (a.name || '').toLowerCase().includes(q) ||
      (a.id || '').toLowerCase().includes(q) ||
      (a.model?.provider || '').toLowerCase().includes(q)
    );
  });

  const toggleProblem = (ds) => {
    if (selectedProblems.find(p => p.name === ds.name)) {
      setSelectedProblems(selectedProblems.filter(p => p.name !== ds.name));
    } else {
      setSelectedProblems([...selectedProblems, ds]);
    }
  };

  const toggleAgent = (agent) => {
    if (selectedAgents.find(a => a.id === agent.id)) {
      setSelectedAgents(selectedAgents.filter(a => a.id !== agent.id));
    } else {
      setSelectedAgents([...selectedAgents, agent]);
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

  // Pair reordering
  const movePairUp = (pairId) => {
    setPairs(prev => {
      const idx = prev.findIndex(p => p.id === pairId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const movePairDown = (pairId) => {
    setPairs(prev => {
      const idx = prev.findIndex(p => p.id === pairId);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const updatePair = (pairId, field, value) => {
    setPairs(prev => prev.map(p => {
      if (p.id !== pairId) return p;
      if (field === 'agentId') {
        const agent = agents.find(a => a.id === value);
        return { ...p, agentId: value, agentName: agent?.name || null };
      }
      return { ...p, [field]: value };
    }));
  };

  const removePair = (pairId) => {
    setPairs(prev => prev.filter(p => p.id !== pairId));
  };

  const addPair = () => {
    setPairs(prev => [...prev, {
      id: String(Date.now()),
      agentId: selectedAgents[0]?.id || null,
      agentName: selectedAgents[0]?.name || null,
      problemName: selectedProblems[0]?.name || '',
    }]);
  };

  const goToStep = (target) => {
    if (target === 3 && step < 3) {
      generatePairs();
    }
    setStep(target);
  };

  const handleSubmit = async () => {
    const validPairs = pairs.filter(p => p.problemName);
    if (validPairs.length === 0) {
      toast.error('No valid job pairs to submit');
      return;
    }
    if (!groupId.trim()) {
      toast.error('Group ID is required');
      return;
    }
    setSubmitting(true);
    try {
      const trimmedOverride = agentNameOverride.trim();

      // If every valid pair targets the same agent, send `agent_name` at
      // the batch level (new harness contract) and omit it per-eval. This
      // avoids ever sending both shapes — which the harness silently
      // resolves in favor of the batch-level value.
      const agentIds = validPairs.map((p) => p.agentId).filter(Boolean);
      const uniformAgentId =
        agentIds.length === validPairs.length && new Set(agentIds).size === 1
          ? agentIds[0]
          : null;

      // Free-text override always wins.
      const batchAgentName = trimmedOverride || uniformAgentId || null;

      const evals = validPairs.map(pair => {
        const evalItem = {
          problem: pair.problemName,
          cpus,
          memory: memoryMb,
          storage: storageGb,
          headed,
          force_build: forceBuild,
        };
        if (templateName.trim()) evalItem.template_name = templateName.trim();
        const experiments = {};
        // Per-eval agent override only when there's no batch-level winner
        // and pairs target *different* agents.
        if (!batchAgentName && pair.agentId) {
          experiments.agent_name = pair.agentId;
        }
        if (showExpConfig) {
          if (expImage) experiments.image = expImage;
          if (expModelName) experiments.model_name = expModelName;
          if (expCortexUrl) experiments.cortex_url = expCortexUrl;
        }
        if (breakpointEnabled && breakpointMins > 0) {
          experiments.breakpoint_duration_mins = breakpointMins;
        }
        if (Object.keys(experiments).length > 0) evalItem.experiments = experiments;
        return evalItem;
      });

      // group_id goes at the top level of the payload, not inside each eval
      const payload = { user_id: userId, group_id: groupId.trim(), evals };
      if (batchAgentName) payload.agent_name = batchAgentName;
      const result = await submitEvalJobs(payload);
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

  const validPairCount = pairs.filter(p => p.problemName).length;
  const stepLabels = ['Problems', 'Agents', 'Pair & Order', 'Configure', 'Review'];

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
            Select problems and agents, arrange job order, then submit
          </p>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-1 py-2 flex-wrap">
          {[1, 2, 3, 4, 5].map(s => (
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
              {s < 5 && <ChevronRight className="w-3 h-3" />}
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
                        return (
                          <div
                            key={ds.name || ds.id}
                            onClick={() => toggleProblem(ds)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleProblem(ds);
                              }
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors cursor-pointer select-none ${isSelected ? 'bg-primary/10' : 'hover:bg-accent'}`}
                            data-testid={`dataset-item-${ds.name}`}
                          >
                            <Checkbox checked={isSelected} tabIndex={-1} className="flex-shrink-0 pointer-events-none" />
                            <div className="flex-1 min-w-0">
                              <div className="font-mono font-medium truncate">{ds.name}</div>
                              <div className="text-muted-foreground text-[10px] mt-0.5">{ds.dataset_type || ds.name?.split('/')[0]}</div>
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

                <div className="border rounded-lg p-3 h-[350px] overflow-y-auto">
                  {loadingPreview ? (
                    <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : selectedPreview ? (
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Problem Statement</h4>
                        <p className="font-mono text-xs mt-1 font-medium">{selectedPreview.name}</p>
                      </div>
                      <Separator />
                      {selectedPreview.problem_statement ? (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed" data-testid="problem-statement-preview">{selectedPreview.problem_statement}</pre>
                      ) : (
                        <p className="text-xs text-muted-foreground">No problem statement available.</p>
                      )}
                    </div>
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

          {/* ── Step 2: Select Agents ──────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">
                Select agents to pair with your {selectedProblems.length} problem(s). Each agent will run all selected problems.
                <br /><span className="text-foreground/60">Skipping agents runs problems without association.</span>
              </p>

              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search agents..." value={agentSearch} onChange={e => setAgentSearch(e.target.value)} className="pl-8 text-sm" data-testid="agent-search-input" />
              </div>

              {selectedAgents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgents.map(a => (
                    <Badge key={a.id} variant="secondary" className="text-[10px] flex items-center gap-1" data-testid={`selected-agent-${a.id}`}>
                      <Users className="w-3 h-3" />{a.name || a.id}
                      <button onClick={() => toggleAgent(a)} className="ml-0.5 hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}

              <ScrollArea className="h-[380px] border rounded-lg">
                {loadingAgents ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">No agents found</div>
                ) : (
                  <div className="p-1">
                    {filteredAgents.map(agent => {
                      const isSelected = !!selectedAgents.find(a => a.id === agent.id);
                      return (
                        <div
                          key={agent.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-xs transition-colors cursor-pointer ${isSelected ? 'bg-primary/10' : 'hover:bg-accent'}`}
                          onClick={() => toggleAgent(agent)}
                          data-testid={`agent-item-${agent.id}`}
                        >
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleAgent(agent)} className="flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{agent.name}</div>
                            <div className="text-muted-foreground text-[10px] font-mono mt-0.5">{agent.id}</div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {agent.model?.provider && <Badge variant="outline" className="text-[9px] font-mono">{agent.model.provider}</Badge>}
                            {agent.model?.model_id && <Badge variant="outline" className="text-[9px] font-mono">{agent.model.model_id}</Badge>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ── Step 3: Pair & Order (Drag-and-Drop) ────────── */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Use arrows to reorder. Change agent/problem assignments as needed. All jobs run simultaneously.
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                    <Rocket className="w-3 h-3" />
                    Every job starts immediately upon submission.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addPair} data-testid="add-pair-btn">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Row
                </Button>
              </div>

              {pairs.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No job pairs. Go back to select problems.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pairs.map((pair, index) => (
                    <PairRow
                      key={pair.id}
                      pair={pair}
                      index={index}
                      total={pairs.length}
                      agents={agents}
                      problems={[...selectedProblems, ...datasets.filter(d => !selectedProblems.find(sp => sp.name === d.name))]}
                      onUpdate={updatePair}
                      onRemove={removePair}
                      onMoveUp={movePairUp}
                      onMoveDown={movePairDown}
                    />
                  ))}
                </div>
              )}

              {pairs.length > 1 && (
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                  <Rocket className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-600" />
                  <span>
                    All <strong className="text-foreground">{pairs.length}</strong> jobs will start running simultaneously.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Configure ──────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4 py-2">
              {/* Agent name override (free-text) */}
              <div>
                <Label className="text-sm font-semibold">Agent name override</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                  Optional. Type any agent name the harness/cortex recognizes
                  (e.g. <code className="font-mono">full_stack_app_builder_cloud_v8_sonnet_4_5</code>).
                  When set, this is sent as the batch-level <code className="font-mono">agent_name</code> and
                  overrides any agents picked in Step 2.
                </p>
                <Input
                  value={agentNameOverride}
                  onChange={e => setAgentNameOverride(e.target.value)}
                  placeholder="e.g. full_stack_app_builder_cloud_v8_sonnet_4_5"
                  className="font-mono text-sm"
                  data-testid="eval-agent-name-override"
                />
              </div>

              {/* Group ID */}
              <div>
                <Label className="text-sm font-semibold">Group ID *</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">Tag all jobs in this batch for easier analysis</p>
                <Input
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  placeholder="e.g. experiment-2026-03-10, sonnet-vs-opus"
                  className="font-mono text-sm"
                  data-testid="eval-group-id"
                />
              </div>

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

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Resources</Label>
                <div className="grid grid-cols-2 gap-3">
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
                  <div>
                    <Label className="text-xs">User ID</Label>
                    <Input value={userId} onChange={e => setUserId(e.target.value)} className="font-mono text-xs" data-testid="eval-user-id" />
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
                    <div>
                      <Label className="text-xs">Cortex URL</Label>
                      <Input value={expCortexUrl} onChange={e => setExpCortexUrl(e.target.value)} className="font-mono text-xs" placeholder="https://cortex-cli..." />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 5: Review & Submit ────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <Rocket className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Total jobs:</span>
                  <span className="font-mono font-bold">{validPairCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Group:</span>
                  <Badge variant="secondary" className="font-mono text-[10px]" data-testid="review-group-id">{groupId || '—'}</Badge>
                </div>
              </div>

              <Card>
                <CardContent className="pt-4 space-y-3">
                  <ScrollArea className="max-h-[220px]">
                    <div className="space-y-1.5">
                      {pairs.filter(p => p.problemName).map((pair, idx) => (
                        <div key={pair.id} className="flex items-center gap-2 text-xs py-1.5 px-2.5 rounded bg-accent/30">
                          <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground w-5 text-center">{idx + 1}</span>
                          {pair.agentName && (
                            <>
                              <Badge variant="outline" className="text-[9px] font-mono flex-shrink-0">
                                <Users className="w-2.5 h-2.5 mr-1" />{pair.agentName}
                              </Badge>
                              <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            </>
                          )}
                          <span className="font-mono text-[10px] truncate">{pair.problemName}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <Separator />

                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Group:</span> <span className="font-mono">{groupId}</span></div>
                    <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{userId}</span></div>
                    <div><span className="text-muted-foreground">CPUs:</span> <span className="font-mono">{cpus}</span></div>
                    <div><span className="text-muted-foreground">Memory:</span> <span className="font-mono">{memoryMb} MB</span></div>
                    <div><span className="text-muted-foreground">Storage:</span> <span className="font-mono">{storageGb} GB</span></div>
                    <div><span className="text-muted-foreground">Headed:</span> <span className="font-mono">{headed ? 'Yes' : 'No'}</span></div>
                    <div><span className="text-muted-foreground">Force Build:</span> <span className="font-mono">{forceBuild ? 'Yes' : 'No'}</span></div>
                  </div>
                </CardContent>
              </Card>

              {validPairCount > 1 && (
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                  <Rocket className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-600" />
                  <span>
                    All <strong className="text-foreground">{validPairCount}</strong> jobs will start running simultaneously, tagged with group <strong className="text-foreground font-mono">{groupId}</strong>.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => goToStep(step - 1)} disabled={submitting} data-testid="eval-back-btn">
              Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={submitting} data-testid="eval-cancel-btn">
            Cancel
          </Button>
          {step < 5 ? (
            <Button
              onClick={() => goToStep(step + 1)}
              disabled={(step === 1 && selectedProblems.length === 0) || (step === 4 && !groupId.trim())}
              data-testid="eval-next-step"
            >
              {step === 2 && selectedAgents.length === 0 ? 'Skip Agents' : 'Next'} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitting || validPairCount === 0}
              data-testid="submit-eval-button"
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              Submit {validPairCount > 0 && `(${validPairCount} job${validPairCount > 1 ? 's' : ''})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
