import { Card, CardContent } from '@/components/ui/card';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Clock,
  Gauge,
  Target,
  Globe,
  DollarSign,
} from 'lucide-react';
import Sparkline from './Sparkline';

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

function valueColor(v) {
  if (v === null || v === undefined) return '';
  if (v >= 0.8) return 'text-emerald-600 dark:text-emerald-400';
  if (v >= 0.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function TrendArrow({ direction }) {
  if (!direction) return null;
  if (direction === 'up')
    return <TrendingUp className="w-3 h-3 text-emerald-500" aria-label="trending up" />;
  if (direction === 'down')
    return <TrendingDown className="w-3 h-3 text-rose-500" aria-label="trending down" />;
  return <Minus className="w-3 h-3 text-muted-foreground" aria-label="flat" />;
}

function KpiTile({ label, value, sub, icon: Icon, testId, accent, children, valueClass }) {
  return (
    <Card className="flex-1 min-w-[160px]" data-testid={testId}>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
            {label}
          </span>
          {Icon && <Icon className={`w-3.5 h-3.5 ${accent || 'text-muted-foreground'}`} />}
        </div>
        <div className={`text-base font-mono font-semibold ${valueClass || ''}`}>{value}</div>
        {sub && (
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 flex items-center gap-1 truncate">
            {sub}
          </div>
        )}
        {children}
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
    lastRunCombined,
    trendDirection,
    totalCostUsd,
    hasCostData,
    combinedSeries,
    lintSeries,
    browserSeries,
  } = summary;

  const hasMultiplePoints = Array.isArray(combinedSeries) && combinedSeries.filter((v) => v !== null).length >= 2;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2"
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
        valueClass={valueColor(meanCombined)}
        sub={
          <>
            <TrendArrow direction={trendDirection} />
            <span>last: {formatScore(lastRunCombined)}</span>
          </>
        }
        icon={Target}
        testId="kpi-mean-combined"
      >
        {hasMultiplePoints && (
          <div className="mt-1.5">
            <Sparkline
              values={combinedSeries}
              width={140}
              height={22}
              stroke="hsl(221 83% 53%)"
              className="w-full"
              data-testid="kpi-spark-combined"
            />
          </div>
        )}
      </KpiTile>
      <KpiTile
        label="Mean Lint"
        value={formatScore(meanLint)}
        valueClass={valueColor(meanLint)}
        icon={Gauge}
        testId="kpi-mean-lint"
      >
        {hasMultiplePoints && lintSeries && (
          <div className="mt-1.5">
            <Sparkline
              values={lintSeries}
              width={140}
              height={22}
              stroke="hsl(142 71% 45%)"
              className="w-full"
              data-testid="kpi-spark-lint"
            />
          </div>
        )}
      </KpiTile>
      <KpiTile
        label="Mean Browser"
        value={formatScore(meanBrowser)}
        valueClass={valueColor(meanBrowser)}
        icon={Globe}
        testId="kpi-mean-browser"
      >
        {hasMultiplePoints && browserSeries && (
          <div className="mt-1.5">
            <Sparkline
              values={browserSeries}
              width={140}
              height={22}
              stroke="hsl(262 83% 58%)"
              className="w-full"
              data-testid="kpi-spark-browser"
            />
          </div>
        )}
      </KpiTile>
      <KpiTile
        label="Avg Duration"
        value={formatDurationMs(avgDurationMs)}
        icon={Clock}
        testId="kpi-avg-duration"
      />
      {hasCostData && totalCostUsd !== null && (
        <KpiTile
          label="Total Cost"
          value={`$${totalCostUsd.toFixed(4)}`}
          icon={DollarSign}
          testId="kpi-total-cost"
        />
      )}
    </div>
  );
}
