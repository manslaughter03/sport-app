/**
 * Dexie schema (docs/architecture.md §5.1).
 *
 * v1 indexes carry the two hot queries: "today's entries per exercise"
 * (`[exerciseId+day]`) and "all entries in a period" (`[day+exerciseId]`).
 *
 * Schema bumps are forward-only and always ship with an upgrade function *and*
 * a fixture test — see the plan §5.2. v1 is the baseline, so there is no upgrade
 * yet.
 */

import Dexie, { type EntityTable } from "dexie";
import type { Entry, Exercise, Goal } from "../domain/types.ts";

/** The single settings row. Stored with `id: "app"`. */
export interface SettingsRow {
  id: string;
  weekStartsOn: 1 | 7;
  dayCutoffHour: number;
  activeDayMinAmount: number;
  schemaVersion: number;
  lastExportAt?: string;
  lastBackupNudgeAt?: string;
}

export const SCHEMA_VERSION = 1;

/** Builds the v1 indexes. Exported so upgrade fixtures can reproduce a v1 DB. */
export function v1Stores() {
  return {
    exercises: "id, order, archivedAt",
    entries: "id, exerciseId, day, seq, [exerciseId+day], [day+exerciseId]",
    goals: "id, effectiveFrom",
    settings: "id",
  };
}

export type SportDatabase = Dexie & {
  exercises: EntityTable<Exercise, "id">;
  entries: EntityTable<Entry, "id">;
  goals: EntityTable<Goal, "id">;
  settings: EntityTable<SettingsRow, "id">;
};

/**
 * Creates a database. The name is a parameter so tests get isolated databases
 * instead of sharing one global IndexedDB.
 */
export function createDatabase(name = "sport-app"): SportDatabase {
  const db = new Dexie(name) as SportDatabase;
  db.version(SCHEMA_VERSION).stores(v1Stores());
  return db;
}
