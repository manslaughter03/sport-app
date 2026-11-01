/**
 * Composition root.
 *
 * Everything the UI needs arrives through this context, so a screen can be
 * rendered in a test with a fixed clock and an isolated database — no globals,
 * no module-level singletons, no wall clock.
 */

import type { SportDatabase } from "../data/db.ts";
import type { Clock } from "../data/clock.ts";
import type { ExerciseRepo } from "../data/repos/exercises.ts";
import type { EntryRepo } from "../data/repos/entries.ts";
import type { GoalRepo } from "../data/repos/goals.ts";
import type { SettingsRepo } from "../data/repos/settings.ts";

export interface AppContext {
  readonly db: SportDatabase;
  readonly clock: Clock;
  readonly settings: SettingsRepo;
  readonly exercises: ExerciseRepo;
  readonly entries: EntryRepo;
  readonly goals: GoalRepo;
}

export function createApp(context: AppContext): AppContext {
  return context;
}
