import { useState, useRef, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Upload, FileText, FileDown, X, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { importDatasetsCsv, getDatasetTemplateCsv, triggerBlobDownload } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

// 5 dataset_types supported by the BFF /datasets/import + /datasets/template
// routes. Keep this list in sync with `_CSV_ATTR_COLS` in backend/server.py.
export const IMPORT_DATASET_TYPES = [
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'wingman_bench', label: 'Wingman Bench' },
];

// Per-type column legend. Lifted from the handoff spec (Part 6b) — required
// columns + the XML-shape rules that bite new users.
const COLUMN_HELP = {
  scratch_bench_phased: {
    required: ['instance_id', 'problem_statement', 'natural_language_tests'],
    optional: ['name', 'description', 'tags', 'base_image', 'agent_name',
      'subagents', 'preview_url', 'image', 'auto_compact_strategy',
      'model_name', 'system_prompt', 'thinking_level', 'hints', 'nudge'],
    callouts: [
      'Both `problem_statement` AND `natural_language_tests` must be `<phases><phase>…</phase></phases>` XML.',
      'Tests nest `<test_cases><test_case>…</test_case></test_cases>` inside each `<phase>`.',
      'Both columns must have the **same number of phases, in the same order**.',
    ],
  },
  bug_bench: {
    required: ['instance_id', 'problem_statement', 'natural_language_tests', 'repo', 'eph_job_id'],
    optional: ['name', 'description', 'tags', 'base_image', 'agent_name',
      'base_commit', 'base_commit_squashed', 'pull_number', 'issue_number', 'request_id', 'image'],
    callouts: [
      '`problem_statement` is **plain text** — the bug description.',
      '`natural_language_tests` uses `<test_cases><test_case>…</test_case></test_cases>` (no `<phases>` wrapper).',
    ],
  },
  test_report_bench: {
    required: ['instance_id', 'problem_statement', 'natural_language_tests',
      'repo', 'eph_job_id', 'testing_hitl', 'Bug_description', 'Bug_fix_status'],
    optional: ['name', 'description', 'tags', 'base_image', 'agent_name',
      'request_id', 'base_commit', 'pull_number', 'issue_number'],
    callouts: [
      'Column headers `Bug_description` and `Bug_fix_status` are **case-sensitive**.',
      '`natural_language_tests` uses `<test_cases><test_case>…</test_case></test_cases>`.',
    ],
  },
  testing_agent_bench: {
    required: ['instance_id', 'problem_statement', 'natural_language_tests', 'agent_name'],
    optional: ['name', 'description', 'tags', 'base_image', 'prod_job_id', 'model_name'],
    callouts: [
      '`problem_statement` = HITL input (plain text).',
      '`natural_language_tests` = golden output (plain text).',
      '`agent_name` is required (top-level column, not an attribute).',
    ],
  },
  wingman_bench: {
    required: ['instance_id', 'problem_statement', 'natural_language_tests', 'wingman_id', 'user_id'],
    optional: ['name', 'description', 'tags', 'base_image', 'agent_name',
      'expected_integrations', 'max_iterations', 'agent_id', 'model_name'],
    callouts: [
      '`expected_integrations` is a **comma-separated list in one cell** (e.g. `slack,github`).',
      '`max_iterations` is an **integer** (`7`, not `"7.0"`).',
    ],
  },
};

const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MB client-side cap.

export function ImportCsvDialog({
  open,
  onClose,
  defaultType,
  onImported, // (datasetType) => void  — fires after a successful import
}) {
  const [datasetType, setDatasetType] = useState(
    defaultType && defaultType !== 'all' ? defaultType : 'scratch_bench_phased',
  );
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { created, skipped, errors }
  const [errorMsg, setErrorMsg] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const fileInputRef = useRef(null);

  const help = COLUMN_HELP[datasetType] || { required: [], optional: [], callouts: [] };
  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  const reset = useCallback(() => {
    setFiles([]);
    setResult(null);
    setErrorMsg('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const handleTypeChange = (v) => {
    setDatasetType(v);
    setResult(null);
    setErrorMsg('');
  };

  const handleFileChange = (e) => {
    const picked = Array.from(e.target.files || []);
    const csvs = picked.filter(
      (f) => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv',
    );
    if (csvs.length !== picked.length) {
      toast.warning(`Ignored ${picked.length - csvs.length} non-CSV file(s)`);
    }
    setFiles(csvs);
    setResult(null);
    setErrorMsg('');
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const downloadTemplate = async () => {
    try {
      const { blob, filename } = await getDatasetTemplateCsv(datasetType);
      triggerBlobDownload(blob, filename);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to download template'));
    }
  };

  const handleUpload = async () => {
    if (!files.length) {
      toast.error('Pick at least one CSV file');
      return;
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      toast.error(`Total upload exceeds 32 MB (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setUploading(true);
    setResult(null);
    setErrorMsg('');
    try {
      const res = await importDatasetsCsv(datasetType, files);
      setResult(res);
      const created = (res.created || []).length;
      const skipped = (res.skipped || []).length;
      const errors = (res.errors || []).length;
      if (errors === 0 && created > 0) {
        toast.success(`Imported ${created} dataset(s) — ${skipped} skipped`);
      } else if (errors > 0) {
        toast.warning(`Imported ${created}, skipped ${skipped}, ${errors} row error(s)`);
      } else if (skipped > 0) {
        toast.info(`All ${skipped} row(s) skipped (already exist)`);
      } else {
        toast.info('Import returned no changes');
      }
      onImported?.(datasetType);
      // Clear the file list so re-clicking Upload doesn't re-import the
      // same rows. The result banner stays so the user can still see
      // created/skipped/errors counts.
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = parseApiError(err, 'Upload failed');
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] flex flex-col p-0 overflow-hidden"
        data-testid="import-csv-dialog"
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Import datasets from CSV
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload one or more CSVs of the selected type. Existing rows are skipped; invalid rows are
            reported per-index. Need a starting point? <span className="font-mono">Download template</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* Type picker + template download */}
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">
                Dataset type
              </label>
              <Select value={datasetType} onValueChange={handleTypeChange} disabled={uploading}>
                <SelectTrigger className="font-mono text-sm" data-testid="import-dataset-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_DATASET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="font-mono text-xs">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              disabled={uploading}
              data-testid="import-download-template-btn"
              className="h-9 gap-1.5"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download template
            </Button>
          </div>

          {/* Column legend */}
          <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
            <CollapsibleTrigger asChild>
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="import-legend-toggle"
              >
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${legendOpen ? 'rotate-90' : ''}`} />
                Column legend for <span className="font-mono">{datasetType}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div
                className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3 text-xs"
                data-testid="import-legend-panel"
              >
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Required columns
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {help.required.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] font-mono bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Optional columns
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {help.optional.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
                {help.callouts.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                      Notes
                    </p>
                    <ul className="space-y-1 list-disc pl-4 text-[11px] leading-relaxed">
                      {help.callouts.map((c, i) => (
                        <li key={i} dangerouslySetInnerHTML={{ __html: c.replace(/`([^`]+)`/g, '<code class="font-mono bg-muted px-1 rounded text-[10px]">$1</code>') }} />
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground italic">
                  Common rules: <code className="font-mono">tags</code> is comma-separated in one cell · <code className="font-mono">name</code> can be blank (auto = <code className="font-mono">&lt;type&gt;/&lt;instance_id&gt;</code>) · <code className="font-mono">id</code> column on input is ignored.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* File picker */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">
              CSV files
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer cursor-pointer"
              data-testid="import-file-input"
            />
            {files.length > 0 && (
              <div className="mt-3 space-y-1.5" data-testid="import-file-list">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs"
                    data-testid={`import-file-row-${i}`}
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-mono truncate flex-1">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeFile(i)}
                      disabled={uploading}
                      data-testid={`import-file-remove-${i}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground pt-1">
                  {files.length} file{files.length === 1 ? '' : 's'} · {(totalBytes / 1024).toFixed(1)} KB total
                  {totalBytes > MAX_TOTAL_BYTES && (
                    <span className="text-destructive ml-1">· exceeds 32 MB cap</span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Inline error */}
          {errorMsg && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2"
              data-testid="import-error-banner"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="font-mono whitespace-pre-wrap break-words">{errorMsg}</span>
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2" data-testid="import-result-banner">
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> created: {(result.created || []).length}
                </Badge>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                  skipped: {(result.skipped || []).length}
                </Badge>
                <Badge variant="outline" className={`${
                  (result.errors || []).length > 0
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                    : ''
                }`}>
                  errors: {(result.errors || []).length}
                </Badge>
              </div>
              {(result.errors || []).length > 0 && (
                <div className="space-y-1 pt-1" data-testid="import-result-errors">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Row errors</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => (
                      <div key={i} className="text-[11px] font-mono leading-snug" data-testid={`import-error-row-${i}`}>
                        <span className="text-muted-foreground">index {e.index}</span>
                        {e.instance_id && <span className="text-muted-foreground"> · {e.instance_id}</span>}
                        <span className="text-rose-600 dark:text-rose-400">: {e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(result.skipped || []).length > 0 && (result.skipped || []).length <= 20 && (
                <p className="text-[10px] text-muted-foreground">
                  Skipped: <span className="font-mono">{result.skipped.join(', ')}</span>
                </p>
              )}
              {(result.created || []).length > 0 && (result.created || []).length <= 20 && (
                <p className="text-[10px] text-muted-foreground">
                  Created: <span className="font-mono">{result.created.join(', ')}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/20">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
            data-testid="import-cancel-btn"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={uploading || files.length === 0 || totalBytes > MAX_TOTAL_BYTES}
            data-testid="import-upload-btn"
          >
            {uploading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-3.5 h-3.5 mr-1.5" /> Upload {files.length || ''}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportCsvDialog;
