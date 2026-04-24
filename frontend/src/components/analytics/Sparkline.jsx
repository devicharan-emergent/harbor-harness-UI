/**
 * Lightweight inline SVG sparkline. Null-aware: skips null points, still
 * renders a line through adjacent valid points.
 */
export default function Sparkline({
  values,
  width = 64,
  height = 20,
  stroke = 'currentColor',
  strokeWidth = 1.5,
  fill = 'none',
  domain = [0, 1],
  className = '',
  showLastDot = true,
  dotColor,
  'data-testid': dataTestId,
}) {
  const arr = Array.isArray(values) ? values : [];
  const valid = arr.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (valid.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={`max-w-full h-auto block ${className}`}
        data-testid={dataTestId}
        aria-hidden
      />
    );
  }
  const [dMin, dMax] = domain;
  const span = dMax - dMin || 1;
  const n = arr.length;
  const step = n > 1 ? width / (n - 1) : width;
  const points = arr.map((v, i) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    const x = i * step;
    const clamped = Math.max(dMin, Math.min(dMax, v));
    const y = height - ((clamped - dMin) / span) * height;
    return { x, y };
  });

  // Build path skipping nulls
  let d = '';
  let penUp = true;
  for (const p of points) {
    if (!p) {
      penUp = true;
      continue;
    }
    d += `${penUp ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    penUp = false;
  }

  const lastValid = [...points].reverse().find((p) => p !== null);

  return (
    <svg
      width={width}
      height={height}
      className={`max-w-full h-auto block ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      data-testid={dataTestId}
      aria-hidden
    >
      <path
        d={d.trim()}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLastDot && lastValid && (
        <circle
          cx={lastValid.x}
          cy={lastValid.y}
          r={2}
          fill={dotColor || stroke}
        />
      )}
    </svg>
  );
}
