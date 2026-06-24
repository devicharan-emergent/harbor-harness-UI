import { useRef, useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2,
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { importDatasetsCSV } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

export const IMPORT_DATASET_TYPES = [
  { value: 'scratch_bench_phased', label: 'Scratch Bench (Phased)' },
  { value: 'bug_bench', label: 'Bug Bench' },
  { value: 'test_report_bench', label: 'Test Report Bench' },
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'wingman_bench', label: 'Wingman Bench' },
];

// Per-type expected CSV header. Attribute columns must match harness
// attribute field names exactly (see handoff spec Part 3).
const HEADER_TEMPLATES = {
  bug_bench:
    'instance_id,problem_statement,natural_language_tests,repo,eph_job_id,agent_name,base_commit,pull_number,issue_number',
  scratch_bench_phased:
    'instance_id,problem_statement,natural_language_tests,subagents,preview_url,image,model_name,system_prompt,thinking_level,hints,nudge',
  test_report_bench:
    'instance_id,problem_statement,natural_language_tests,repo,eph_job_id,testing_hitl,Bug_description,Bug_fix_status,request_id,base_commit,pull_number,issue_number',
  testing_agent_bench:
    'instance_id,agent_name,problem_statement,natural_language_tests,prod_job_id,model_name',
  wingman_bench:
    'instance_id,problem_statement,natural_language_tests,wingman_id,user_id,expected_integrations,max_iterations,agent_id,model_name',
};

const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export function ImportDatasetsModal({ open, onClose, onImported, defaultType }) {
  const [datasetType, setDatasetType] = useState(defaultType || 'bug_bench');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef(null);

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.size || 0), 0),
    [files],
  );

  const reset = () => {
    setFiles([]);
    setResult(null);
    setErrorMsg('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose?.();
  };

  const handleFilePick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    // Dedupe re-picks by name+size+lastModified.
    const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    const seen = new Set(files.map(key));
    const merged = [...files];
    for (const f of picked) if (!seen.has(key(f))) merged.push(f);
    setFiles(merged);
    setResult(null);
    setErrorMsg('');
    // Clear the input so re-picking the same file path triggers onChange again.
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleUpload = async () => {
    if (!files.length) return;
    if (totalBytes > MAX_TOTAL_BYTES) {
      setErrorMsg(`Total upload size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds 32 MB limit.`);
      return;
    }
    setUploading(true);
    setErrorMsg('');
    setResult(null);
    try {
      const data = await importDatasetsCSV(datasetType, files);
      setResult({
        created: data.created || [],
        skipped: data.skipped || [],
        errors: data.errors || [],
      });
      const c = (data.created || []).length;
      const s = (data.skipped || []).length;
      const e = (data.errors || []).length;
      if (c && !e) toast.success(`Imported ${c} dataset${c !== 1 ? 's' : ''}` + (s ? ` · ${s} skipped` : ''));
      else if (c) toast.success(`Imported ${c} · skipped ${s} · errors ${e}`);
      else if (!e && s) toast.message(`Nothing new — ${s} skipped (all already exist)`);
      else toast.error(`Import finished with errors — created ${c} · skipped ${s} · errors ${e}`);
      onImported?.(data);
    } catch (err) {
      setErrorMsg(parseApiError(err, 'Failed to import datasets'));
    } finally {
      setUploading(false);
    }
  };

  const downloadHeaderTemplate = () => {
    const header = HEADER_TEMPLATES[datasetType] || 'instance_id,problem_statement';
    const blob = new Blob([header + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${datasetType}_template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const createdCount = result?.created?.length ?? 0;
  const skippedCount = result?.skipped?.length ?? 0;
  const errorCount = result?.errors?.length ?? 0;
  const isAllSuccess = result && errorCount === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl" data-testid="import-datasets-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Import datasets from CSV
          </DialogTitle>
          <DialogDescription>
            Pick a dataset type, then upload one or more CSV files. All rows are stamped with the
            selected type. Existing rows (by instance_id) are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type picker + template link */}
          <div className="space-y-1.5">
            <Label className="text-xs">Dataset type</Label>
            <div className="flex items-center gap-2">
              <Select
                value={datasetType}
                onValueChange={(v) => { setDatasetType(v); setResult(null); }}
                disabled={uploading}
              >
                <SelectTrigger className="w-full" data-testid="import-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_DATASET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadHeaderTemplate}
                className="shrink-0"
                disabled={uploading}
                data-testid="import-download-template-btn"
                title="Download a CSV with just the header row for this type"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Header
              </Button>
            </div>
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">CSV file(s)</Label>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={handleFilePick}
              className="hidden"
              data-testid="import-file-input"
            />
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <FileText className="w-7 h-7 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground mb-2">
                    No files selected. CSV columns must match the selected type.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    data-testid="import-pick-files-btn"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Choose files
                  </Button>
                </div>
              ) : (
                <ul className="space-y-1.5" data-testid="import-file-list">
                  {files.map((f, idx) => (
                    <li
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1.5 border"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs truncate" title={f.name}>{f.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        disabled={uploading}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                        data-testid={`import-remove-file-${idx}`}
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                  <li className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {files.length} file{files.length !== 1 ? 's' : ''} · {(totalBytes / 1024).toFixed(1)} KB total
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => inputRef.current?.click()}
                      disabled={uploading}
                      className="h-6 text-xs"
                      data-testid="import-add-more-btn"
                    >
                      Add more
                    </Button>
                  </li>
                </ul>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Tip: rows are processed in file-then-row order. A row whose <code>instance_id</code> already
              exists (or repeats across files) is skipped, not overwritten.
            </p>
          </div>

          {errorMsg && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
              data-testid="import-error-banner"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {result && (
            <div className="space-y-2" data-testid="import-result">
              <Separator />
              <div className="flex items-center gap-2 flex-wrap">
                {isAllSuccess
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                <Badge variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  data-testid="import-created-badge">created: {createdCount}</Badge>
                <Badge variant="outline"
                  className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
                  data-testid="import-skipped-badge">skipped: {skippedCount}</Badge>
                <Badge variant="outline"
                  className={errorCount
                    ? 'bg-destructive/10 text-destructive border-destructive/30'
                    : 'bg-muted text-muted-foreground border-border'}
                  data-testid="import-errors-badge">errors: {errorCount}</Badge>
              </div>

              {errorCount > 0 && (
                <ScrollArea className="max-h-44 rounded-md border bg-muted/30 p-2">
                  <ul className="space-y-1" data-testid="import-errors-list">
                    {result.errors.map((err, idx) => (
                      <li key={idx} className="text-[11px] font-mono text-destructive flex gap-2">
                        <span className="text-muted-foreground shrink-0">#{err.index}</span>
                        <span className="text-foreground shrink-0">{err.instance_id || '(no id)'}:</span>
                        <span className="break-words">{err.error}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleClose}
            disabled={uploading} data-testid="import-close-btn">
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button type="button" onClick={handleUpload}
            disabled={uploading || files.length === 0}
            data-testid="import-submit-btn">
            {uploading
              ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading…</>)
              : (<><Upload className="w-3.5 h-3.5 mr-1.5" />Import</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportDatasetsModal;
