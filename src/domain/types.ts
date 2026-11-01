/**
 * Core value types (docs/architecture.md §2.1).
 *
 * Deliberately narrow: only what the period math needs. Entity types land with
 * the repositories in S5.
 */

/**
 * A local calendar day, `"YYYY-MM-DD"`.
 *
 * Never a UTC instant. Deriving the day from a timestamp breaks every evening
 * session west of UTC, so the write path computes this once (see `resolveDay`).
 */
export type IsoDate = string;

/** A UTC instant, `"2026-11-01T18:42:03.123Z"`. Audit only — never used for grouping. */
export type IsoInstant = string;

/** Which week the user's week starts on: 1 = Monday, 7 = Sunday. */
export type WeekStartsOn = 1 | 7;

export type Period = "week" | "month";

/** A half-open local-day range, `[start, end)`. */
export interface PeriodRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}
