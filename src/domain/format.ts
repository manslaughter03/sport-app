/**
 * Display formatting (docs/architecture.md §4).
 *
 * Two rules that matter and are easy to get wrong:
 *  - Ring/bar *width* clamps to 0..100.
 *  - The *printed number* is unclamped — 140 % is information, not an error.
 */

/** Clamp a percentage for rendering (ring/bar width). Never returns NaN. */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/** The printed value is intentionally NOT clamped. */
export function formatPercent(pct: number, fractionDigits = 0): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(fractionDigits)} %`;
}
