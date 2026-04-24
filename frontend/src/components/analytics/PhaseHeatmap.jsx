import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function colorForScore(score) {
  if (score === null || score === undefined) return 'bg-slate-500/20';
  if (score < 0.5) return 'bg-red-500/40';
  if (score < 0.8) return 'bg-amber-500/40';
  return 'bg-emerald-500/40';
}

function formatScore(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(3);
}

export default function PhaseHeatmap({ heatmap }) {
  if (!heatmap || !heatmap.show) return null;

  const { problems, maxPhase, cells } = heatmap;
  const phaseIndices = Array.from({ length: maxPhase + 1 }, (_, i) => i);

  return (
    <div
      className="space-y-2"
      data-testid="analytics-heatmap"
    >
      <p className="text-xs text-muted-foreground">
        Average lint score per phase, across all runs. Hover a cell for details.
      </p>
      <div className="border rounded-md overflow-auto max-h-[400px] relative">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              <th className="text-left p-2 font-semibold text-[11px] text-muted-foreground sticky left-0 bg-background z-20 border-b border-r">
                Problem
              </th>
              {phaseIndices.map((i) => (
                <th
                  key={i}
                  className="p-2 font-semibold text-[11px] text-muted-foreground text-center border-b min-w-[72px]"
                  scope="col"
                >
                  Phase {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TooltipProvider delayDuration={150}>
              {problems.map((problem) => (
                <tr key={problem} className="hover:bg-accent/30">
                  <th
                    scope="row"
                    className="text-left p-2 font-mono text-[11px] sticky left-0 bg-background border-r truncate max-w-[260px]"
                    title={problem}
                  >
                    {problem}
                  </th>
                  {phaseIndices.map((i) => {
                    const key = `${problem}::${i}`;
                    const cell = cells[key] || {
                      mean: null,
                      sample: 0,
                    };
                    const bg = colorForScore(cell.mean);
                    return (
                      <td
                        key={i}
                        className="p-1 text-center border-t"
                        data-testid={`heatmap-cell-${problem}-${i}`}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`mx-auto rounded-md px-2 py-1.5 font-mono text-[11px] font-semibold cursor-default ${bg} ${
                                cell.mean === null
                                  ? 'text-muted-foreground'
                                  : ''
                              }`}
                            >
                              {formatScore(cell.mean)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs max-w-[280px]">
                            <div className="font-mono font-semibold mb-1 break-all">
                              {problem} · Phase {i}
                            </div>
                            <div className="flex items-center justify-between gap-4 font-mono">
                              <span>Mean lint</span>
                              <span>{formatScore(cell.mean)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 font-mono">
                              <span>Samples</span>
                              <span>{cell.sample}</span>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </TooltipProvider>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-red-500/40" />
          &lt; 0.5
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-amber-500/40" />
          0.5–0.8
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/40" />
          ≥ 0.8
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-slate-500/20" />
          no data
        </span>
      </div>
    </div>
  );
}
