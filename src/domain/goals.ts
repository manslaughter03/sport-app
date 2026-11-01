/**
 * Goal selection and versioning (docs/architecture.md §2.2).
 *
 * The rule that makes history honest: a period is judged by the goal **in force
 * at the end of that period**. Raising a target in March therefore cannot
 * rewrite January's percentage — the January row is still the one in force when
 * January ended.
 *
 * Editing a goal is never a mutation: it is `splitGoal`, which closes the old
 * row at the change day and opens a new one. Nothing is lost, and past periods
 * keep pointing at the values that actually applied.
 *
 * Pure functions: no clock (callers pass `now`), no storage, no framework.
 */

import { prevDay } from "./period.ts";
import type { Goal, GoalScope, IsoDate, IsoInstant, Period } from "./types.ts";

/** True when two scopes address the same target. */
export function scopesEqual(a: GoalScope, b: GoalScope): boolean {
  if (a.kind === "activeDays" || b.kind === "activeDays") {
    return a.kind === b.kind;
  }
  return a.exerciseId === b.exerciseId;
}

/**
 * A stable identity for "the goal slot" a row fills: scope + period.
 *
 * Week and month goals for the same exercise are separate slots (O2), so they
 * must not collide when we pick one row per slot.
 */
export function goalKey(scope: GoalScope, period: Period): string {
  return scope.kind === "activeDays"
    ? `activeDays:${period}`
    : `exercise:${scope.exerciseId}:${period}`;
}

/**
 * Half-open in-force test: `[effectiveFrom, effectiveTo)`.
 *
 * The `effectiveTo` day belongs to the *next* version, which is what keeps
 * split rows adjacent without overlapping.
 */
export function isInForce(goal: Goal, day: IsoDate): boolean {
  if (day < goal.effectiveFrom) return false;
  return goal.effectiveTo === undefined || day < goal.effectiveTo;
}

/**
 * The goal in force for a scope+period at the end of the evaluated period.
 *
 * `rangeEnd` is the **exclusive** end of the range, so the day that decides is
 * `rangeEnd - 1`. Accepting the exclusive end (rather than the last day) means
 * callers pass `PeriodRange.end` straight through and cannot be off by one.
 *
 * Overlapping rows should not exist in well-formed data, but the tie-break is
 * defined anyway: the most recent `effectiveFrom` wins.
 */
export function goalInForce(
  goals: readonly Goal[],
  scope: GoalScope,
  period: Period,
  rangeEnd: IsoDate,
): Goal | undefined {
  // The day that decides is the last day inside the range, i.e. rangeEnd - 1.
  const selectedDay = prevDay(rangeEnd);

  let best: Goal | undefined;
  for (const goal of goals) {
    if (goal.period !== period) continue;
    if (!scopesEqual(goal.scope, scope)) continue;
    if (!isInForce(goal, selectedDay)) continue;

    if (best === undefined || goal.effectiveFrom > best.effectiveFrom) {
      best = goal;
    }
  }
  return best;
}

export interface SplitGoalOptions {
  /** First day the new target applies. Must be strictly after the old start. */
  readonly atDay: IsoDate;
  readonly newTarget: number;
  readonly newId: string;
  /** Injected so the domain never reads a clock. */
  readonly now: IsoInstant;
}

/**
 * Version a goal: close the old row the day before `atDay`, open a new row at
 * `atDay` with the new target.
 *
 * Returns `[closed, opened]`. The original target survives in `closed`, so past
 * periods keep their percentage.
 */
export function splitGoal(goal: Goal, options: SplitGoalOptions): readonly [Goal, Goal] {
  const { atDay, newTarget, newId, now } = options;

  if (!Number.isInteger(newTarget) || Number.isNaN(newTarget)) {
    throw new RangeError(`Goal target must be an integer, got ${newTarget}`);
  }
  if (newTarget <= 0) {
    throw new RangeError(`Goal target must be positive, got ${newTarget}`);
  }
  if (atDay <= goal.effectiveFrom) {
    throw new RangeError(
      `Cannot split a goal at or before its start: atDay ${atDay} must be after ${goal.effectiveFrom}`,
    );
  }
  if (goal.effectiveTo !== undefined && atDay >= goal.effectiveTo) {
    throw new RangeError(
      `Cannot split a retired goal: atDay ${atDay} is at or after effectiveTo ${goal.effectiveTo}`,
    );
  }

  const closed: Goal = { ...goal, effectiveTo: atDay };
  const opened: Goal = {
    ...goal,
    id: newId,
    target: newTarget,
    effectiveFrom: atDay,
    createdAt: now,
  };
  // `effectiveTo` must be absent, not undefined, for exactOptionalPropertyTypes.
  const { effectiveTo: _dropped, ...openedWithoutEnd } = opened;

  return [closed, openedWithoutEnd];
}

/**
 * One goal per scope+period, in force on `day`.
 *
 * This is what the UI reads: with a weekly *and* a monthly push-up goal (O2),
 * both come back; with a version history, only the current row does.
 */
export function activeGoals(goals: readonly Goal[], day: IsoDate): Goal[] {
  const bySlot = new Map<string, Goal>();

  for (const goal of goals) {
    if (!isInForce(goal, day)) continue;
    const key = goalKey(goal.scope, goal.period);
    const existing = bySlot.get(key);
    // Newest wins, so a scope never reports two "current" targets.
    if (existing === undefined || goal.effectiveFrom > existing.effectiveFrom) {
      bySlot.set(key, goal);
    }
  }

  return [...bySlot.values()];
}
