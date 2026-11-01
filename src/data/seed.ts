/**
 * First-run seed.
 *
 * Idempotent: it only acts when there are no exercises yet, so reopening the app
 * (or a second tab) never duplicates rows and never overwrites a user's edits.
 *
 * The exercise ids are fixed rather than random so the seeded goals can reference
 * them without a round trip, and so tests can assert on them.
 */

import type { SportDatabase } from "./db.ts";
import type { Clock } from "./clock.ts";
import type { Entry, Exercise, Goal } from "../domain/types.ts";

/** Agreed defaults (v0). Editable from the targets editor in S8. */
export const SEED_EXERCISES: readonly Exercise[] = [
  { id: "ex-pushup", name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 },
  { id: "ex-core", name: "Core", kind: "duration", unit: "s", step: 30, order: 2 },
  { id: "ex-toe-touch", name: "Toe Touch", kind: "reps", unit: "reps", step: 5, order: 3 },
];

/** Weekly targets: 700 push-ups, 3000 s of core, 1000 toe touches, 4 active days. */
export const SEED_GOALS: readonly Goal[] = [
  {
    id: "goal-pushup-week",
    scope: { kind: "exercise", exerciseId: "ex-pushup" },
    period: "week",
    target: 700,
    cap: false,
    effectiveFrom: "2000-01-01",
    createdAt: "2000-01-01T00:00:00.000Z",
  },
  {
    id: "goal-core-week",
    scope: { kind: "exercise", exerciseId: "ex-core" },
    period: "week",
    target: 3000,
    cap: false,
    effectiveFrom: "2000-01-01",
    createdAt: "2000-01-01T00:00:00.000Z",
  },
  {
    id: "goal-toe-touch-week",
    scope: { kind: "exercise", exerciseId: "ex-toe-touch" },
    period: "week",
    target: 1000,
    cap: false,
    effectiveFrom: "2000-01-01",
    createdAt: "2000-01-01T00:00:00.000Z",
  },
  {
    id: "goal-active-days-week",
    scope: { kind: "activeDays" },
    period: "week",
    target: 4,
    cap: false,
    effectiveFrom: "2000-01-01",
    createdAt: "2000-01-01T00:00:00.000Z",
  },
];

/**
 * Seeds exercises and goals if the database has no exercises.
 *
 * Returns true when it wrote anything, so callers can log/announce first run.
 */
export async function seedIfEmpty(db: SportDatabase, _clock: Clock): Promise<boolean> {
  return db.transaction("rw", db.exercises, db.goals, async () => {
    const existing = await db.exercises.count();
    if (existing > 0) return false;

    await db.exercises.bulkAdd([...SEED_EXERCISES]);
    await db.goals.bulkAdd([...SEED_GOALS]);
    return true;
  });
}

/** Every entry, for the export in S9. Kept here so the shape lives in one place. */
export async function allEntries(db: SportDatabase): Promise<Entry[]> {
  return db.entries.toArray();
}
