import { Badge } from '@/components/ui/badge';

// Derive per-rule severity + count from a lint_report's raw file errors.
// Each error looks like:
//   { code: 'warn' | 'error' | 'EB003' | ..., line, column, message }
// The actual rule id is embedded at the start of the message in
// `[rule-id(...)]` form (e.g. `[emergent(no-setState-during-render)]`,
// `[emergent-jsx-a11y(label-has-associated-control)]`). We parse that out
// and treat `code === 'warn'` as a warning; everything else as an error.
//
// Returns { errors: [{ rule, count }], warnings: [{ rule, count }] }, each
// sorted by count descending. The summary's top-level `error_breakdown`
// (which aggregates by the useless `code` field: `error:27, warn:4, EB003:4`)
// is intentionally ignored.
function extractRuleFromMessage(message) {
  if (!message) return null;
  const m = String(message).match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

export function summarizeLintReport(lintReport) {
  const files = lintReport?.raw_output?.files || [];
  const errorCounts = new Map();
  const warningCounts = new Map();

  for (const file of files) {
    for (const err of (file.errors || [])) {
      const rule = extractRuleFromMessage(err.message) || err.code || '(unknown)';
      const bucket = err.code === 'warn' ? warningCounts : errorCounts;
      bucket.set(rule, (bucket.get(rule) || 0) + 1);
    }
  }

  const toSortedList = (map) =>
    [...map.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));

  return {
    errors: toSortedList(errorCounts),
    warnings: toSortedList(warningCounts),
  };
}

function RuleSection({ title, rules, tone = 'error', testid }) {
  if (!rules.length) return null;
  const toneClasses =
    tone === 'warn'
      ? 'border-amber-400/40 text-amber-600 dark:text-amber-400'
      : 'border-red-400/40 text-red-600 dark:text-red-400';
  const toneHeader = tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
  const total = rules.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-1.5" data-testid={testid}>
      <div className="flex items-baseline gap-2">
        <span className={`text-[11px] font-semibold ${toneHeader}`}>{title}</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {total} total · {rules.length} unique
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rules.map(({ rule, count }) => (
          <Badge
            key={rule}
            variant="outline"
            className={`text-[10px] font-mono py-0 ${toneClasses}`}
            data-testid={`${testid}-rule-${rule}`}
            title={rule}
          >
            [{rule}] &times; {count}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// Drop-in summary block: two sections (Errors, Warnings) with unique-rule counts.
// Renders nothing if the report has no files with errors.
export function LintRuleBreakdown({ lintReport, testid = 'lint-rule-breakdown' }) {
  const { errors, warnings } = summarizeLintReport(lintReport);
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="space-y-3" data-testid={testid}>
      <RuleSection title="Errors" rules={errors} tone="error" testid={`${testid}-errors`} />
      <RuleSection title="Warnings" rules={warnings} tone="warn" testid={`${testid}-warnings`} />
    </div>
  );
}

export default LintRuleBreakdown;
