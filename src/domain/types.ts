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
  /**
   * Monotonic insertion order.
   *
   * `createdAt` cannot order two sets logged in the same millisecond, which
   * would make "undo last" delete an arbitrary one. This is the tie-break.
   */
  readonly seq: number;
  readonly note?: string;
}

/** Persisted app settings. Single row, `id = "app"`. */
export interface Settings {
  /** 1 = Monday (default), 7 = Sunday. */
  readonly weekStartsOn: WeekStartsOn;
  /** 0..6 — entries logged before this hour count for the previous day. */
  readonly dayCutoffHour: number;
  /** A day counts as "active" if its total for one exercise is >= this. */
  readonly activeDayMinAmount: number;
  readonly schemaVersion: number;
  readonly lastExportAt?: IsoInstant;
  readonly lastBackupNudgeAt?: IsoInstant;
}

/**
 * Pace is a state, not a number (docs/architecture.md §3.2).
 *
 * `untargeted` covers an exercise with no goal in force: it still shows volume,
 * it just cannot be "behind" anything.
 */
export type PaceState = "on-track" | "behind" | "ahead" | "done" | "over-cap" | "untargeted";

/** Per-exercise progress within a period. */
export interface ExerciseProgress {
  readonly exerciseId: string;
  readonly name: string;
  readonly kind: ExerciseKind;
  readonly unit: string;
  /** Sum of amounts in the period. */
  readonly achieved: number;
  /** Goal target in force, or null when the exercise has no goal. */
  readonly target: number | null;
  /**
   * Unclamped percentage — 140 is information, not an error.
   * Null when there is no target.
   */
  readonly volumePct: number | null;
  /** Clamped 0..100 for ring/bar width. */
  readonly clampedPct: number;
  /** What linear progress would expect by now (target × elapsedFraction). */
  readonly expectedSoFar: number;
  readonly pace: PaceState;
  /** True only when a `cap: true` goal is exceeded. */
  readonly overCap: boolean;
  readonly goalId: string | null;
}

/** Global "did I show up?" progress. */
export interface RegularityProgress {
  readonly activeDays: number;
  /** Null when there is no active-days goal in force. */
  readonly activeDaysTarget: number | null;
  readonly regularityPct: number | null;
  /** The active days themselves, for the 7-day grid. */
  readonly activeDayList: readonly IsoDate[];
}

/** The full answer for one period. */
export interface ProgressReport {
  readonly range: PeriodRange;
  readonly today: IsoDate;
  readonly totalDays: number;
  readonly elapsedDays: number;
  readonly elapsedFraction: number;
  readonly exercises: readonly ExerciseProgress[];
  readonly regularity: RegularityProgress;
}
