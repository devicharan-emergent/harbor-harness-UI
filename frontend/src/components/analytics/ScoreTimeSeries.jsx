import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const METRIC_OPTIONS = [
  { key: 'combined_reward', label: 'Combined reward' },
  { key: 'lint_score', label: 'Lint score' },
  { key: 'browser_reward', label: 'Browser reward' },
  { key: 'lintiq_score', label: 'LintIQ score' },
];

// Palette for up to ~12 problems. Lines recycle colors past that.
const COLORS = [
  'hsl(221 83% 53%)', // blue
  'hsl(142 71% 45%)', // green
  'hsl(262 83% 58%)', // violet
  'hsl(25 95% 53%)',  // orange
  'hsl(340 82% 52%)', // pink
  'hsl(178 60% 42%)', // teal
  'hsl(45 93% 47%)',  // yellow-gold
  'hsl(0 72% 51%)',   // red
  'hsl(280 65% 60%)', // purple
  'hsl(200 80% 50%)', // sky
  'hsl(95 55% 45%)',  // olive
  'hsl(15 75% 55%)',  // coral
];

function truncateLabel(s, n = 28) {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  // Filter out problems with null values at this date so tooltip is clean
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover text-popover-foreground px-3 py-2 shadow-md text-xs max-w-[360px]">
      <div className="font-mono font-semibold mb-1">{label}</div>
      {rows.map((p) => (
        <div
          key={p.dataKey}
          className="flex items-center justify-between gap-4 font-mono"
        >
          <span className="flex items-center gap-1.5 truncate">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: p.color }}
            />
            <span className="truncate" title={p.name}>
              {p.name}
            </span>
          </span>
          <span className="flex-shrink-0">
            {typeof p.value === 'number' ? p.value.toFixed(3) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ScoreTimeSeries({ timeSeries }) {
  const [metric, setMetric] = useState('combined_reward');

  const rows = useMemo(
    () => timeSeries?.byMetric?.[metric] || [],
    [timeSeries, metric]
  );
  const problems = timeSeries?.problems || [];

  const noData =
    !timeSeries?.show || problems.length === 0 || rows.length === 0;

  return (
    <div className="space-y-3" data-testid="analytics-time-series">
      <div className="flex items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="metric-select" className="text-xs text-muted-foreground">
            Metric
          </Label>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger
              id="metric-select"
              className="w-[220px] h-8 text-xs"
              data-testid="timeseries-metric-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-muted-foreground ml-auto">
          One line per problem · higher is better · judge agent config quality
        </p>
      </div>

      {noData ? (
        <div
          className="flex items-center justify-center h-[200px] rounded-md border border-dashed text-xs text-muted-foreground"
          data-testid="timeseries-empty"
        >
          No data for this metric
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1.0]}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconSize={8}
              formatter={(value) => (
                <span title={value} className="font-mono">
                  {truncateLabel(value)}
                </span>
              )}
            />
            {problems.map((problem, idx) => (
              <Line
                key={problem}
                type="monotone"
                dataKey={problem}
                name={problem}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
