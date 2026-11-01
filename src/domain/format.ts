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

/**
 * Round for display without lying: 99.99 % must not print as "100 %" and
 * 100.01 % must not print as "100 %" either (that would hide a missed target).
 */
export function formatPercentRounded(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded} %`;
}

/** "1 250 reps" — thin space grouping, no locale dependence. */
export function formatReps(value: number): string {
  const rounded = Math.round(value);
  return `${groupThousands(rounded)} ${rounded === 1 ? "rep" : "reps"}`;
}

/** "2 m 30 s", "45 s", "1 m" — seconds only when under a minute. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} m` : `${minutes} m ${rest} s`;
}

/** Amount in the exercise's own unit: reps or a duration. */
export function formatAmount(value: number, kind: "reps" | "duration"): string {
  return kind === "duration" ? formatDuration(value) : formatReps(value);
}

/** Compact amount for tight spots: "1 250" or "2:30". */
export function formatAmountCompact(value: number, kind: "reps" | "duration"): string {
  if (kind === "reps") return groupThousands(Math.round(value));
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function groupThousands(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(value));
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return negative ? `-${out}` : out;
}
