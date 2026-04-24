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
  ReferenceLine,
  LabelList,
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
  const rows = payload
    .filter((p) => p.value !== null && p.value !== undefined)
    .sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover text-popover-foreground px-3 py-2 shadow-md text-xs max-w-[380px]">
      <div className="font-mono font-semibold mb-1.5 pb-1 border-b">{label}</div>
      <div className="space-y-1">
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
            <span className="flex-shrink-0 font-semibold">
              {typeof p.value === 'number' ? p.value.toFixed(3) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Render the value only at the last data point per series
function EndLabel({ rows }) {
  return function Inner(props) {
    const { x, y, value, index } = props;
    if (value === null || value === undefined) return null;
    // Only draw for the last non-null point of the series.
    // Recharts calls this for every point; we look ahead in `rows` to see
    // if there's a later non-null value for this series.
    const { dataKey } = props;
    for (let i = index + 1; i < rows.length; i++) {
      if (rows[i]?.[dataKey] !== null && rows[i]?.[dataKey] !== undefined) {
        return null;
      }
    }
    return (
      <text
        x={x + 6}
        y={y + 3}
        fontSize={10}
        fontFamily="monospace"
        fill="currentColor"
        className="fill-foreground"
      >
        {typeof value === 'number' ? value.toFixed(2) : ''}
      </text>
    );
  };
}

export default function ScoreTimeSeries({ timeSeries }) {
  const [metric, setMetric] = useState('combined_reward');
  const [hoveredProblem, setHoveredProblem] = useState(null);

  const rows = useMemo(
    () => timeSeries?.byMetric?.[metric] || [],
    [timeSeries, metric]
  );
  const problems = timeSeries?.problems || [];

  const noData =
    !timeSeries?.show || problems.length === 0 || rows.length === 0;

  const EndLabelComponent = useMemo(() => EndLabel({ rows }), [rows]);

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
          Hover a problem in the legend to isolate it · higher is better
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
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={rows} margin={{ top: 12, right: 48, bottom: 0, left: 0 }}>
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
              padding={{ left: 8, right: 8 }}
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
            <ReferenceLine
              y={0.5}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 4"
              strokeOpacity={0.4}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.25 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
              iconSize={8}
              onMouseEnter={(o) => setHoveredProblem(o.dataKey)}
              onMouseLeave={() => setHoveredProblem(null)}
              formatter={(value) => (
                <span
                  title={value}
                  className="font-mono"
                  style={{
                    opacity:
                      hoveredProblem && hoveredProblem !== value ? 0.35 : 1,
                  }}
                >
                  {truncateLabel(value)}
                </span>
              )}
            />
            {problems.map((problem, idx) => {
              const color = COLORS[idx % COLORS.length];
              const isDimmed =
                hoveredProblem && hoveredProblem !== problem;
              return (
                <Line
                  key={problem}
                  type="monotone"
                  dataKey={problem}
                  name={problem}
                  stroke={color}
                  strokeWidth={isDimmed ? 1 : 2.25}
                  strokeOpacity={isDimmed ? 0.3 : 1}
                  dot={{ r: isDimmed ? 2 : 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                >
                  <LabelList dataKey={problem} content={EndLabelComponent} />
                </Line>
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
