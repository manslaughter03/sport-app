/**
 * The progress engine (docs/architecture.md §3).
 *
 * Two percentages, two questions:
 *   volume %    — "did I do the work this period?"   (per exercise)
 *   regularity % — "did I show up consistently?"      (global active days)
 *
 * Plus pace: "am I on track before the period ends?" — a *state*, not a number,
 * with linear expectation and no penalty for planned rest days.
 *
 * Pure: no clock, no storage. `today` is always injected.
 */

import { clampPct } from "./format.ts";
import { activeGoals, goalInForce } from "./goals.ts";
import { elapsedFraction as fractionElapsed, isInRange, periodDays, daysIn } from "./period.ts";
import type {
  Entry,
  Exercise,
  ExerciseProgress,
  Goal,
  IsoDate,
  PaceState,
  PeriodRange,
  ProgressReport,
  RegularityProgress,
  Settings,
} from "./types.ts";

/** How far from the linear expectation still counts as "on track". */
const ON_TRACK_TOLERANCE = 0.1;

/**
 * Classify pace.
 *
 * Linear expectation, no penalty for rest days: being at 100 % of the expected
 * value by now is `on-track`; a 10 % band either side keeps the badge from
 * flickering on rounding noise.
 *
 * Order matters: a met target is `done` regardless of how early it happened,
 * and a ceiling goal that is exceeded is `over-cap` rather than `done`.
 */
export function paceState(
  achieved: number,
  target: number,
  elapsedFraction: number,
  cap: boolean,
): PaceState {
  if (target <= 0) return "untargeted";

  const reached = achieved >= target;
  if (reached) {
    return cap && achieved > target ? "over-cap" : "done";
  }

  // Not yet at target. Before the period starts, nothing is "behind" yet.
  if (!Number.isFinite(elapsedFraction) || elapsedFraction <= 0) return "behind";

  const expected = target * elapsedFraction;
  const ratio = achieved / expected;
  if (ratio >= 1 + ON_TRACK_TOLERANCE) return "ahead";
  if (ratio >= 1 - ON_TRACK_TOLERANCE) return "on-track";
  return "behind";
}

function roundPct(value: number): number {
  // Two decimals keeps 1/3 from printing as 33.33333333333333 %.
  return Math.round(value * 100) / 100;
}

/** Sum of amounts per exercise across the entries inside the range. */
function totalsByExercise(
  entries: readonly Entry[],
  range: PeriodRange,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!isInRange(e.day, range)) continue;
    totals.set(e.exerciseId, (totals.get(e.exerciseId) ?? 0) + e.amount);
  }
  return totals;
}

/**
 * Which days count as "active".
 *
 * A day is active if the total for *some* exercise on that day reaches
 * `activeDayMinAmount`. Distinct days, not entries: three sets in one evening is
 * one active day (O3 default: any entry counts).
 */
function activeDaysOf(
  entries: readonly Entry[],
  range: PeriodRange,
  settings: Settings,
): IsoDate[] {
  const totalsByDay = new Map<IsoDate, Map<string, number>>();
  for (const e of entries) {
    if (!isInRange(e.day, range)) continue;
    let byExercise = totalsByDay.get(e.day);
    if (byExercise === undefined) {
      byExercise = new Map<string, number>();
      totalsByDay.set(e.day, byExercise);
    }
    byExercise.set(e.exerciseId, (byExercise.get(e.exerciseId) ?? 0) + e.amount);
  }

  const active: IsoDate[] = [];
  for (const [day, byExercise] of totalsByDay) {
    for (const total of byExercise.values()) {
      if (total >= settings.activeDayMinAmount) {
        active.push(day);
        break;
      }
    }
  }
  return active.sort();
}

function exerciseProgress(
  exercise: Exercise,
  achieved: number,
  goal: Goal | undefined,
  elapsedFraction: number,
): ExerciseProgress {
  const target = goal?.target ?? null;
  const cap = goal?.cap ?? false;
  const volumePct = target === null ? null : roundPct((achieved / target) * 100);
  const expectedSoFar = target === null ? 0 : target * elapsedFraction;

  const pace: PaceState =
    target === null ? "untargeted" : paceState(achieved, target, elapsedFraction, cap);

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    kind: exercise.kind,
    unit: exercise.unit,
    achieved,
    target,
    volumePct,
    clampedPct: volumePct === null ? 0 : clampPct(volumePct),
    expectedSoFar,
    pace,
    overCap: cap && target !== null && achieved > target,
    goalId: goal?.id ?? null,
  };
}

function regularityProgress(
  entries: readonly Entry[],
  range: PeriodRange,
  goals: readonly Goal[],
  settings: Settings,
  day: IsoDate,
): RegularityProgress {
  const activeDayList = activeDaysOf(entries, range, settings);
  const activeDays = activeDayList.length;

  const goal = goalInForce(goals, { kind: "activeDays" }, "week", range.end);
  const activeDaysTarget = goal?.target ?? null;
  const regularityPct =
    activeDaysTarget === null || activeDaysTarget <= 0
      ? null
      : roundPct((activeDays / activeDaysTarget) * 100);

  // `day` is unused here but kept for symmetry with the rest of the engine; the
  // active-days goal is selected at the period end like every other goal.
  void day;

  return { activeDays, activeDaysTarget, regularityPct, activeDayList };
}

/**
 * Evaluate one period.
 *
 * `exercises` is the display list (archived ones are skipped here, not by the
 * caller, so every surface agrees). Every non-archived exercise gets a row,
 * whether or not it has a goal — volume without a target is still information.
 */
export function evaluate(
  range: PeriodRange,
  entries: readonly Entry[],
  exercises: readonly Exercise[],
  goals: readonly Goal[],
  settings: Settings,
  today: IsoDate,
): ProgressReport {
  const totals = totalsByExercise(entries, range);
  const elapsed = fractionElapsed(range, today);
  const totalDays = periodDays(range);
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round(elapsed * totalDays)));

  const visible = exercises
    .filter((exercise) => exercise.archivedAt === undefined)
    .slice()
    .sort((a, b) => a.order - b.order);

  const rows = visible.map((exercise) =>
    exerciseProgress(
      exercise,
      totals.get(exercise.id) ?? 0,
      goalInForce(goals, { kind: "exercise", exerciseId: exercise.id }, "week", range.end),
      elapsed,
    ),
  );

  return {
    range,
    today,
    totalDays,
    elapsedDays,
    elapsedFraction: elapsed,
    exercises: rows,
    regularity: regularityProgress(entries, range, goals, settings, today),
  };
}

/**
 * One report per past period — cheap to recompute (a year is ~2k entries).
 * Used by the history view in Phase 2; exported here so the shape is settled.
 */
export function evaluatePeriods(
  ranges: readonly PeriodRange[],
  entries: readonly Entry[],
  exercises: readonly Exercise[],
  goals: readonly Goal[],
  settings: Settings,
  today: IsoDate,
): ProgressReport[] {
  return ranges.map((range) => evaluate(range, entries, exercises, goals, settings, today));
}

/** The days of the period that are still ahead, for the 7-day grid. */
export function remainingDays(range: PeriodRange, today: IsoDate): IsoDate[] {
  return daysIn(range).filter((day) => day > today);
}

/** Re-exported so UI code has one import for "what is currently in force". */
export { activeGoals };
