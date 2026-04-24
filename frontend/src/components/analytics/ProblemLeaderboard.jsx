import { useMemo, useState } from 'react';
import { ArrowUpDown, ArrowDown, ArrowUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import Sparkline from './Sparkline';

function formatScore(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(3);
}

function scoreBg(v) {
  if (v === null || v === undefined) return '';
  if (v >= 0.8) return 'text-emerald-600 dark:text-emerald-400';
  if (v >= 0.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function TrendIcon({ dir }) {
  if (dir === 'up') return <TrendingUp className="w-3 h-3 text-emerald-500" />;
  if (dir === 'down') return <TrendingDown className="w-3 h-3 text-rose-500" />;
  if (dir === 'flat') return <Minus className="w-3 h-3 text-muted-foreground" />;
  return <span className="w-3 h-3 inline-block" />;
}

const COLUMNS = [
  { key: 'problem', label: 'Problem', align: 'left', sortable: true },
  { key: 'runs', label: 'Runs', align: 'right', sortable: true },
  { key: 'latestCombined', label: 'Latest', align: 'right', sortable: true, help: 'Latest combined reward' },
  { key: 'meanCombined', label: 'μ Combined', align: 'right', sortable: true },
  { key: 'meanLint', label: 'μ Lint', align: 'right', sortable: true },
  { key: 'meanBrowser', label: 'μ Browser', align: 'right', sortable: true },
  { key: 'trend', label: 'Trend', align: 'center', sortable: false },
  { key: 'sparkline', label: 'Combined trajectory', align: 'left', sortable: false },
];

export default function ProblemLeaderboard({ leaderboard }) {
  const [sortKey, setSortKey] = useState('latestCombined');
  const [sortDir, setSortDir] = useState('desc');

  const rows = leaderboard?.rows || [];

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls always sink to bottom regardless of direction
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return r;
  }, [rows, sortKey, sortDir]);

  if (!leaderboard || !leaderboard.show || rows.length === 0) {
    return null;
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className="space-y-2" data-testid="analytics-leaderboard">
      <p className="text-xs text-muted-foreground">
        Per-problem performance across all runs. Click a header to sort — use this to
        spot problems where the agent config consistently under-performs.
      </p>
      <div className="border rounded-md overflow-auto max-h-[420px]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted/30 backdrop-blur z-10">
            <tr>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const Icon = !col.sortable
                  ? null
                  : !active
                  ? ArrowUpDown
                  : sortDir === 'asc'
                  ? ArrowUp
                  : ArrowDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-3 py-2 text-[11px] font-semibold text-muted-foreground border-b text-${col.align} ${
                      col.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''
                    } ${active ? 'text-foreground' : ''}`}
                    onClick={() => col.sortable && handleSort(col.key)}
                    title={col.help || (col.sortable ? 'Click to sort' : undefined)}
                    data-testid={`leaderboard-col-${col.key}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      {col.label}
                      {Icon && <Icon className="w-3 h-3 opacity-70" />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.problem}
                className="hover:bg-accent/30 border-b last:border-b-0"
                data-testid={`leaderboard-row-${row.problem}`}
              >
                <td
                  className="px-3 py-2 font-mono text-[11px] truncate max-w-[280px]"
                  title={row.problem}
                >
                  {row.problem}
                </td>
                <td className="px-3 py-2 text-right font-mono">{row.runs}</td>
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold ${scoreBg(row.latestCombined)}`}
                >
                  {formatScore(row.latestCombined)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${scoreBg(row.meanCombined)}`}>
                  {formatScore(row.meanCombined)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${scoreBg(row.meanLint)}`}>
                  {formatScore(row.meanLint)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${scoreBg(row.meanBrowser)}`}>
                  {formatScore(row.meanBrowser)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center">
                    <TrendIcon dir={row.trend} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Sparkline
                    values={row.combinedSeries}
                    width={100}
                    height={22}
                    stroke="hsl(221 83% 53%)"
                    className="text-primary"
                    data-testid={`leaderboard-spark-${row.problem}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
