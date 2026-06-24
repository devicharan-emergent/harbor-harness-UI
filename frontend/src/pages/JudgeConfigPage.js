import { useState } from 'react';
import { Scale } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JudgeConfigForm } from '@/components/evals/JudgeConfigDialog';

/**
 * Standalone page for editing the singleton LLM-judge config used by
 * testing_agent_bench evals. Same form as the in-modal editor, but with
 * page-level chrome so reviewers can land here directly from the sidebar
 * without opening Run Eval first.
 */
export default function JudgeConfigPage() {
  // Re-mount the form on a "save broadcast" so the page header stale
  // state (badge / timestamp) refreshes without a manual reload.
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="space-y-6" data-testid="judge-config-page">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center flex-shrink-0">
          <Scale className="w-4 h-4 text-primary" />
        </div>
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold leading-tight">LLM Test Judge</h1>
          <p className="text-xs text-muted-foreground max-w-xl">
            The prompt and model used to score every <span className="font-mono">testing_agent_bench</span> eval.
            Both <code className="font-mono">{'{golden}'}</code> and{' '}
            <code className="font-mono">{'{candidate}'}</code> tokens are required —
            the harness substitutes them with the dataset&apos;s golden output and the
            testing agent&apos;s actual reply before calling the model.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <JudgeConfigForm
            key={formKey}
            onSaved={() => setFormKey((k) => k + 1)}
            showHeader
            showSaveFooter
          />
        </CardContent>
      </Card>
    </div>
  );
}
