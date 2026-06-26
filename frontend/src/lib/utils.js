import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Absolute timestamp formatter — used by eval-run lists and the job
// detail metadata block. We deliberately favour absolute datetimes over
// `formatDistanceToNow` here: relative strings ("3 days ago") force
// users to mentally translate back to a clock time when reproducing
// failed runs or correlating with logs.
//
// Returns "—" for falsy / unparseable input so the caller can render
// without an extra ternary.
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
