import { useState } from 'react';
import { Scale } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  VerifierConfigForm,
  BENCH_META,
} from '@/components/evals/JudgeConfigDialog';

const BENCH_OPTIONS = [
  { value: 'testing_agent_bench', label: 'Testing Agent Bench' },
  { value: 'scratch_bench_phased', label: 'Scratch Bench' },
];

/**
 * Standalone page that lets reviewers manage the verifier prompt + model
 * for each bench independently. A bench dropdown at the top swaps the
 * config shown in the same form; saving on one bench does NOT touch the
 * other.
 */
export default function JudgeConfigPage() {
  const [benchType, setBenchType] = useState('testing_agent_bench');
  // formKey bumps on every save so the form refreshes its
  // is_default/updated_at chrome without forcing a manual reload.
  const [formKey, setFormKey] = useState(0);
  const meta = BENCH_META[benchType];

  return (
    <div className="space-y-6" data-testid="verifier-config-page">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center flex-shrink-0">
          <Scale className="w-4 h-4 text-primary" />
        </div>
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold leading-tight">Verifier Config</h1>
          <p className="text-xs text-muted-foreground max-w-2xl">
            {meta.helperHeading} {meta.helperBody}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Configuration</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">Bench</Label>
            <Select
              value={benchType}
              onValueChange={(v) => {
                setBenchType(v);
                setFormKey((k) => k + 1);
              }}
            >
              <SelectTrigger
                className="text-xs font-mono w-[220px] h-8"
                data-testid="verifier-bench-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BENCH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="font-mono text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <VerifierConfigForm
            key={`${benchType}-${formKey}`}
            benchType={benchType}
            onSaved={() => setFormKey((k) => k + 1)}
            showSaveFooter
          />
        </CardContent>
      </Card>
    </div>
  );
}
