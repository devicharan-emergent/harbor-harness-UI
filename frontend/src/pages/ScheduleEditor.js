import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Loader2,
  Save,
  Search,
  X,
  CalendarClock,
  Clock,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { listDatasets, listDatasetsByType } from '@/services/evalApi';
import {
  createScheduledBatch,
  getScheduledBatch,
  updateScheduledBatch,
} from '@/services/schedulesApi';
import { parseApiError } from '@/lib/errorUtils';
import { humanizeCron } from './SchedulesList';

const DATASET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
];

const CRON_PRESETS = [
  { label: 'Daily at 3:00 AM IST', value: '0 3 * * *' },
  { label: 'Daily at 9:00 AM IST', value: '0 9 * * *' },
  { label: 'Daily at 11:00 PM IST', value: '0 23 * * *' },
  { label: 'Every hour at :00', value: '0 * * * *' },
  { label: 'Weekdays at 3 AM IST', value: '0 3 * * 1-5' },
];

// Get problem_id for a dataset row: "{dataset_type}/{instance_id}"
function datasetToProblemId(ds) {
  if (ds.name && ds.name.includes('/')) return ds.name;
  if (ds.dataset_type && ds.instance_id) return `${ds.dataset_type}/${ds.instance_id}`;
  return ds.name || '';
}

export default function ScheduleEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [step, setStep] = useState(1); // 1: name+schedule, 2: problems, 3: enabled, 4: review
  const [loadingBatch, setLoadingBatch] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [cronExpression, setCronExpression] = useState('0 3 * * *');
  const [problemIds, setProblemIds] = useState([]);
  const [enabled, setEnabled] = useState(true);

  // Dataset browsing
  const [datasets, setDatasets] = useState([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [datasetType, setDatasetType] = useState('all');

  // Load existing batch in edit mode
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const data = await getScheduledBatch(id);
        setName(data.name || '');
        setCronExpression(data.cron_expression || '0 3 * * *');
        setProblemIds(data.problem_ids || []);
        setEnabled(data.enabled ?? true);
      } catch (error) {
        toast.error(parseApiError(error, 'Failed to load schedule'));
        navigate('/schedules');
      } finally {
        setLoadingBatch(false);
      }
    })();
  }, [id, isEdit, navigate]);

  const fetchDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      const data =
        datasetType === 'all'
          ? await listDatasets({ limit: 200 })
          : await listDatasetsByType(datasetType, { limit: 200 });
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error('Failed to fetch datasets:', error);
      setDatasets([]);
    } finally {
      setLoadingDatasets(false);
    }
  }, [datasetType]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const filteredDatasets = datasets.filter((ds) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ds.name || '').toLowerCase().includes(q) ||
      (ds.instance_id || '').toLowerCase().includes(q) ||
      (ds.problem_statement || '').toLowerCase().includes(q)
    );
  });

  const toggleProblem = (ds) => {
    const pid = datasetToProblemId(ds);
    if (!pid) return;
    setProblemIds((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]
    );
  };

  const removeProblem = (pid) => {
    setProblemIds((prev) => prev.filter((x) => x !== pid));
  };

  const canProceedFromStep = (s) => {
    if (s === 1) return name.trim().length > 0 && cronExpression.trim().length > 0;
    if (s === 2) return problemIds.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!cronExpression.trim()) {
      toast.error('Cron expression is required');
      return;
    }
    if (problemIds.length === 0) {
      toast.error('Select at least one problem');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateScheduledBatch(id, {
          name: name.trim(),
          cron_expression: cronExpression.trim(),
          problem_ids: problemIds,
          enabled,
        });
        toast.success('Schedule updated');
        navigate(`/schedules/${id}`);
      } else {
        const created = await createScheduledBatch({
          name: name.trim(),
          cron_expression: cronExpression.trim(),
          problem_ids: problemIds,
          enabled,
        });
        toast.success('Schedule created');
        navigate(`/schedules/${created.id}`);
      }
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to save schedule'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingBatch) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stepLabels = ['Name & Schedule', 'Problems', 'Enabled', 'Review'];

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="schedule-editor-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} data-testid="back-btn">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {isEdit ? 'Edit Schedule' : 'New Schedule'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEdit
              ? 'Update the configuration for this scheduled batch'
              : 'Create a batch of problems that runs automatically on a cron schedule'}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-1 flex-wrap">
        {[1, 2, 3, 4].map((s) => (
          <button
            key={s}
            onClick={() => {
              if (s < step) setStep(s);
            }}
            className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
              s === step
                ? 'bg-primary text-primary-foreground'
                : s < step
                ? 'bg-accent text-accent-foreground cursor-pointer hover:bg-accent/80'
                : 'text-muted-foreground'
            }`}
            data-testid={`schedule-step-${s}`}
          >
            {s}. {stepLabels[s - 1]}
          </button>
        ))}
      </div>

      {/* Step 1: Name + Schedule */}
      {step === 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="w-4 h-4" />
              Name & Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label htmlFor="schedule-name" className="text-sm font-semibold">
                Name *
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                A short, descriptive identifier for this batch
              </p>
              <Input
                id="schedule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. daily-notes-regression"
                className="font-mono text-sm"
                data-testid="schedule-name-input"
              />
            </div>

            <div>
              <Label htmlFor="schedule-cron" className="text-sm font-semibold">
                Cron Expression *
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                Standard 5-field cron in Asia/Kolkata (IST) timezone
              </p>

              <div className="flex items-center gap-2">
                <Input
                  id="schedule-cron"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 3 * * *"
                  className="font-mono text-sm flex-1"
                  data-testid="schedule-cron-input"
                />
                <Select
                  value=""
                  onValueChange={(v) => {
                    if (v && v !== '_custom') setCronExpression(v);
                  }}
                >
                  <SelectTrigger className="w-[220px]" data-testid="cron-preset-select">
                    <SelectValue placeholder="Presets" />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="_custom">Custom (advanced)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-2 rounded-md border bg-accent/30 px-3 py-2 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground">This will run:</span>
                <span className="text-xs font-semibold" data-testid="cron-humanized">
                  {humanizeCron(cronExpression)}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2">
                Batches are checked hourly. Schedules with minute ≠ 0 may drift up to 59 minutes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Problems */}
      {step === 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Problems
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={datasetType} onValueChange={setDatasetType}>
                <SelectTrigger className="w-[200px]" data-testid="problems-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATASET_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search problems..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 font-mono text-sm"
                  data-testid="problems-search-input"
                />
              </div>
            </div>

            {problemIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {problemIds.map((pid) => (
                  <Badge
                    key={pid}
                    variant="secondary"
                    className="font-mono text-[10px] flex items-center gap-1"
                    data-testid={`selected-problem-${pid}`}
                  >
                    {pid}
                    <button
                      onClick={() => removeProblem(pid)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {problemIds.length} problem{problemIds.length === 1 ? '' : 's'} selected
            </p>

            <ScrollArea className="h-[400px] border rounded-lg">
              {loadingDatasets ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDatasets.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No problems found
                </div>
              ) : (
                <div className="p-1">
                  {filteredDatasets.map((ds) => {
                    const pid = datasetToProblemId(ds);
                    const isSelected = problemIds.includes(pid);
                    return (
                      <div
                        key={pid || ds.id}
                        onClick={() => toggleProblem(ds)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors cursor-pointer ${
                          isSelected ? 'bg-primary/10' : 'hover:bg-accent'
                        }`}
                        data-testid={`problem-item-${pid}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleProblem(ds)}
                          className="flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-medium truncate">{pid}</div>
                          <div className="text-muted-foreground text-[10px] mt-0.5">
                            {ds.dataset_type || pid.split('/')[0]}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Enabled */}
      {step === 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Enabled</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <Label className="text-sm font-semibold">Enabled</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  When enabled, the batch will fire automatically on its schedule. Disable to pause it
                  without deleting.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="schedule-enabled-switch"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review & Submit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Name
                </p>
                <p className="font-mono font-medium mt-0.5" data-testid="review-name">
                  {name}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Schedule
                </p>
                <p className="mt-0.5" data-testid="review-schedule">
                  {humanizeCron(cronExpression)}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                  {cronExpression}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Enabled
                </p>
                <Badge
                  variant="outline"
                  className={`mt-0.5 ${
                    enabled
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  data-testid="review-enabled"
                >
                  {enabled ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Problems
                </p>
                <p className="mt-0.5" data-testid="review-problem-count">
                  {problemIds.length} problem{problemIds.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <Separator />

            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
                Problem IDs
              </p>
              <div className="flex flex-wrap gap-1.5">
                {problemIds.map((pid) => (
                  <Badge key={pid} variant="outline" className="font-mono text-[10px]">
                    {pid}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-2">
        {step > 1 && (
          <Button
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={submitting}
            data-testid="schedule-back-btn"
          >
            Back
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          disabled={submitting}
          data-testid="schedule-cancel-btn"
        >
          Cancel
        </Button>
        {step < 4 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canProceedFromStep(step)}
            data-testid="schedule-next-btn"
          >
            Next
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || problemIds.length === 0}
            data-testid="schedule-submit-btn"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {isEdit ? 'Save Changes' : 'Create Schedule'}
          </Button>
        )}
      </div>
    </div>
  );
}
