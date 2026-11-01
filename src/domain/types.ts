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

/** How an exercise is measured. Extensible — `reps` and `duration` ship in v0. */
export type ExerciseKind = "reps" | "duration";

export interface Exercise {
  readonly id: string;
  readonly name: string;
  readonly kind: ExerciseKind;
  /** Display unit: "reps" or "s". */
  readonly unit: string;
  /** Quick-add increment: 5 or 10 reps, 30 seconds. */
  readonly step: number;
  /** Display order on Today. */
  readonly order: number;
  /** Soft delete — history must survive (docs/architecture.md §5.2). */
  readonly archivedAt?: IsoInstant;
}

/**
 * What a goal measures. `activeDays` is global on purpose: "N days per week" is
 * about the habit overall, not per exercise (docs/architecture.md §2.2).
 */
export type GoalScope = { readonly kind: "exercise"; readonly exerciseId: string } | { readonly kind: "activeDays" };

/**
 * A versioned goal row.
 *
 * Goals are rows, not a mutable field: `effectiveFrom`/`effectiveTo` means
 * "I raised push-ups in March" does not retroactively rewrite January's
 * percentage. Editing a goal retroactively = split the row in two.
 */
export interface Goal {
  readonly id: string;
  readonly scope: GoalScope;
  readonly period: Period;
  /** Reps/seconds per period, or active days per week. */
  readonly target: number;
  /** true = upper bound; over target renders as a warning, not an achievement. */
  readonly cap: boolean;
  /** In force from this local day onward. */
  readonly effectiveFrom: IsoDate;
  /** Exclusive; undefined = still in force. */
  readonly effectiveTo?: IsoDate;
  readonly createdAt: IsoInstant;
}

/** A recorded set. One row per set, never a per-day bucket. */
export interface Entry {
  readonly id: string;
  readonly exerciseId: string;
  /** Local day, assigned once at write time via `resolveDay`. */
  readonly day: IsoDate;
  /** Reps, or seconds for duration. */
  readonly amount: number;
  readonly createdAt: IsoInstant;
  readonly note?: string;
}
