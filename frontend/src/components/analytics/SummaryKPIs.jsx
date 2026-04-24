import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Clock,
  DollarSign,
  Gauge,
  Target,
  Globe,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function formatPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function formatScore(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(3);
}

function formatDurationMs(ms) {
  if (!ms || Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function formatRelativeOrDash(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '—';
  }
}

function TrendArrow({ direction }) {
  if (!direction) return null;
  if (direction === 'up')
    return (
      <TrendingUp
        className="w-3 h-3 text-emerald-500"
        aria-label="trending up"
      />
    );
  if (direction === 'down')
    return (
      <TrendingDown
        className="w-3 h-3 text-rose-500"
        aria-label="trending down"
      />
    );
  return (
    <Minus className="w-3 h-3 text-muted-foreground" aria-label="flat" />
  );
}

function KpiTile({ label, value, sub, icon: Icon, testId, accent }) {
  return (
    <Card className="flex-1 min-w-[140px]" data-testid={testId}>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
            {label}
          </span>
          {Icon && (
            <Icon className={`w-3.5 h-3.5 ${accent || 'text-muted-foreground'}`} />
          )}
        </div>
        <div className="text-base font-mono font-semibold">{value}</div>
        {sub && (
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 flex items-center gap-1 truncate">
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SummaryKPIs({ summary }) {
  if (!summary || !summary.hasData) return null;

  const {
    totalRuns,
    totalJobs,
    successRate,
    successCount,
    meanCombined,
    meanLint,
    meanBrowser,
    avgDurationMs,
    lastRunAt,
    lastRunCombined,
    trendDirection,
    totalCostUsd,
    hasCostData,
  } = summary;

  return (
    <div
      className="flex flex-wrap gap-2"
      data-testid="analytics-kpis"
      role="list"
      aria-label="Schedule-wide metrics"
    >
      <KpiTile
        label="Total Runs"
        value={totalRuns}
        sub={`${totalJobs} job${totalJobs === 1 ? '' : 's'} total`}
        icon={Activity}
        testId="kpi-total-runs"
      />
      <KpiTile
        label="Success Rate"
        value={formatPct(successRate, 1)}
        sub={`${successCount} of ${totalJobs} completed`}
        icon={CheckCircle2}
        accent="text-emerald-500"
        testId="kpi-success-rate"
      />
      <KpiTile
        label="Mean Combined"
        value={formatScore(meanCombined)}
        sub={
          <>
            <TrendArrow direction={trendDirection} />
            <span>last: {formatScore(lastRunCombined)}</span>
          </>
        }
        icon={Target}
        testId="kpi-mean-combined"
      />
      <KpiTile
        label="Mean Lint"
        value={formatScore(meanLint)}
        icon={Gauge}
        testId="kpi-mean-lint"
      />
      <KpiTile
        label="Mean Browser"
        value={formatScore(meanBrowser)}
        icon={Globe}
        testId="kpi-mean-browser"
      />
      <KpiTile
        label="Avg Duration"
        value={formatDurationMs(avgDurationMs)}
        icon={Clock}
        testId="kpi-avg-duration"
      />
      <KpiTile
        label="Total Cost"
        value={
          hasCostData && totalCostUsd !== null
            ? `$${totalCostUsd.toFixed(4)}`
            : '—'
        }
        sub={
          hasCostData ? null : (
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 h-4"
              data-testid="kpi-cost-unavailable"
            >
              job detail only
            </Badge>
          )
        }
        icon={DollarSign}
        testId="kpi-total-cost"
      />
      <KpiTile
        label="Last Fire"
        value={formatRelativeOrDash(lastRunAt)}
        sub={
          lastRunAt ? (
            <span className="truncate">
              {new Date(lastRunAt).toLocaleString()}
            </span>
          ) : null
        }
        icon={Clock}
        testId="kpi-last-fire"
      />
    </div>
  );
}
