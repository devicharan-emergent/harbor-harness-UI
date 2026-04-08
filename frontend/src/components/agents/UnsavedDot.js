export function UnsavedDot({ show }) {
  if (!show) return null;
  return (
    <span
      className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-slate-900 shadow-[0_0_0_2px_hsl(var(--background))] unsaved-dot"
      aria-hidden="true"
    />
  );
}
