import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, ListChecks, Loader2 } from 'lucide-react';
import { parseProblemPhases, parseTestsPhases } from './DatasetEditorModal';

const TYPE_BADGE_COLORS = {
  scratch_bench_phased: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  bug_bench: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  test_report_bench: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
};

function Pre({ children, testid }) {
  return (
    <pre
      className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed bg-muted/30 rounded-md p-3 border border-border/40"
      data-testid={testid}
    >
      {children}
    </pre>
  );
}

function ProblemTab({ dataset }) {
  const problem = dataset?.problem_statement || '';
  const phases = parseProblemPhases(problem);

  if (!problem) {
    return <p className="text-xs text-muted-foreground italic py-8 text-center">No problem statement</p>;
  }

  // Fallback to plain rendering when the XML had no <phase> tags.
  if (phases.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Problem Statement</p>
        <Pre testid="preview-problem-plain">{problem}</Pre>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="preview-problem-phased">
      {phases.map((text, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono">Phase {i + 1}</Badge>
            <span className="text-[10px] text-muted-foreground">
              {text.length} char{text.length === 1 ? '' : 's'}
            </span>
          </div>
          <Pre testid={`preview-problem-phase-${i}`}>{text}</Pre>
        </div>
      ))}
    </div>
  );
}

function TestsTab({ dataset }) {
  const tests = dataset?.natural_language_tests || '';
  const byPhase = parseTestsPhases(tests);

  if (!tests) {
    return <p className="text-xs text-muted-foreground italic py-8 text-center">No test cases</p>;
  }

  // Fallback: no <phase> wrapping, just dump the raw text.
  if (byPhase.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Test Cases</p>
        <Pre testid="preview-tests-plain">{tests}</Pre>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="preview-tests-phased">
      {byPhase.map((phaseTests, phaseIdx) => (
        <div key={phaseIdx} className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono">Phase {phaseIdx + 1}</Badge>
            <span className="text-[10px] text-muted-foreground">
              {phaseTests.length} test case{phaseTests.length === 1 ? '' : 's'}
            </span>
          </div>
          {phaseTests.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic pl-1">No test cases for this phase</p>
          ) : (
            <ol className="space-y-2 list-none">
              {phaseTests.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground mt-1 flex-shrink-0 w-6 text-right">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <Pre testid={`preview-tests-phase-${phaseIdx}-case-${i}`}>{t}</Pre>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

export function DatasetPreviewModal({ open, onClose, dataset, loading }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] p-0 overflow-hidden flex flex-col"
        data-testid="dataset-preview-modal"
      >
        <DialogHeader className="px-6 pt-6 pb-3 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-mono truncate" data-testid="preview-modal-title">
                {dataset?.name || (dataset ? `${dataset.dataset_type}/${dataset.instance_id}` : 'Dataset')}
              </DialogTitle>
              {dataset?.description && (
                <DialogDescription className="text-xs mt-1 line-clamp-2">
                  {dataset.description}
                </DialogDescription>
              )}
            </div>
            {dataset?.dataset_type && (
              <Badge
                variant="outline"
                className={`text-[10px] font-mono flex-shrink-0 ${TYPE_BADGE_COLORS[dataset.dataset_type] || ''}`}
              >
                {dataset.dataset_type}
              </Badge>
            )}
          </div>
          {dataset?.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {dataset.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        <Separator />

        {loading || !dataset ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="problem" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-6 mt-3 grid grid-cols-2 w-[280px]" data-testid="preview-tabs">
              <TabsTrigger value="problem" className="text-xs gap-1.5" data-testid="preview-tab-problem">
                <FileText className="w-3.5 h-3.5" />
                Problem & Phases
              </TabsTrigger>
              <TabsTrigger value="tests" className="text-xs gap-1.5" data-testid="preview-tab-tests">
                <ListChecks className="w-3.5 h-3.5" />
                Test Cases
              </TabsTrigger>
            </TabsList>

            <TabsContent value="problem" className="flex-1 min-h-0 mt-3 px-6 pb-6">
              <ScrollArea className="h-[55vh] pr-3">
                <ProblemTab dataset={dataset} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="tests" className="flex-1 min-h-0 mt-3 px-6 pb-6">
              <ScrollArea className="h-[55vh] pr-3">
                <TestsTab dataset={dataset} />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DatasetPreviewModal;
