/**
 * Goal repository.
 *
 * Goals are versioned rows (docs/architecture.md §2.2). `retarget` is the only
 * way to change a target: it splits the current row through the domain's
 * `splitGoal`, so past periods keep the values that actually applied.
 */

import type { SportDatabase } from "../db.ts";
import type { Clock } from "../clock.ts";
import type { Goal, GoalScope, IsoDate, Period } from "../../domain/types.ts";
import { activeGoals, goalInForce, splitGoal } from "../../domain/goals.ts";

export interface NewGoal {
  scope: GoalScope;
  period: Period;
  target: number;
  cap: boolean;
  effectiveFrom: IsoDate;
}

export interface RetargetInput {
  atDay: IsoDate;
  newTarget: number;
}

export interface GoalRepo {
  create(input: NewGoal): Promise<Goal>;
  get(id: string): Promise<Goal | undefined>;
  all(): Promise<Goal[]>;
  /** The goal in force for a scope+period, selected at `rangeEnd - 1`. */
  inForce(scope: GoalScope, period: Period, rangeEnd: IsoDate): Promise<Goal | undefined>;
  /** One goal per scope+period, in force on `day`. */
  activeOn(day: IsoDate): Promise<Goal[]>;
  /**
   * Change a target by splitting the row: the old row is closed the day before
   * `atDay`, a new row opens at `atDay`. Returns `[closed, opened]`.
   */
  retarget(id: string, input: RetargetInput): Promise<readonly [Goal, Goal]>;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createGoalsRepo(db: SportDatabase, clock: Clock): GoalRepo {
  return {
    async create(input) {
      if (!Number.isInteger(input.target) || input.target <= 0) {
        throw new RangeError(`Goal target must be a positive integer, got ${input.target}`);
      }
      const goal: Goal = {
        id: newId(),
        scope: input.scope,
        period: input.period,
        target: input.target,
        cap: input.cap,
        effectiveFrom: input.effectiveFrom,
        createdAt: clock.now().instant,
      };
      await db.goals.add(goal);
      return goal;
    },

    get(id) {
      return db.goals.get(id);
    },

    async all() {
      return db.goals.orderBy("effectiveFrom").toArray();
    },

    async inForce(scope, period, rangeEnd) {
      const goals = await db.goals.toArray();
      return goalInForce(goals, scope, period, rangeEnd);
    },

    async activeOn(day) {
      const goals = await db.goals.toArray();
      return activeGoals(goals, day);
    },

    async retarget(id, input) {
      const goal = await db.goals.get(id);
      if (goal === undefined) {
        throw new Error(`Goal not found: ${id}`);
      }

      const [closed, opened] = splitGoal(goal, {
        atDay: input.atDay,
        newTarget: input.newTarget,
        newId: newId(),
        now: clock.now().instant,
      });

      // One transaction: a half-applied retarget would leave the scope with no
      // goal in force, which reads as "untargeted" everywhere.
      await db.transaction("rw", db.goals, async () => {
        await db.goals.put(closed);
        await db.goals.add(opened);
      });

      return [closed, opened];
    },
  };
}
