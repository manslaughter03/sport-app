/**
 * JSON backup (docs/architecture.md §5.3).
 *
 * This is the only recovery path if Android clears site data, so it ships in v0.
 * The envelope carries `schemaVersion` so a future import can migrate instead of
 * guessing, and parsing is strict: an older build must refuse a newer file
 * rather than half-read it (forward-only, §5.2).
 */

import { SCHEMA_VERSION, type SettingsRow, type SportDatabase } from "./db.ts";
import { defaultSettings } from "./repos/settings.ts";
import type { Clock } from "./clock.ts";
import type { Entry, Exercise, Goal } from "../domain/types.ts";
import { diffDays } from "../domain/period.ts";

export const BACKUP_FORMAT = "sport-app-backup";

export interface BackupData {
  exercises: Exercise[];
  entries: Entry[];
  goals: Goal[];
  settings: SettingsRow;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

/** How stale an export may get before we nag, in days. */
export const EXPORT_STALE_DAYS = 14;

/** Minimum distinct days of data before a backup is worth nagging about. */
export const EXPORT_MIN_DAYS = 7;

/** How long a dismissal silences the nudge, in days. */
export const NUDGE_SNOOZE_DAYS = 14;

export async function buildBackup(db: SportDatabase, clock: Clock): Promise<Backup> {
  const [exercises, entries, goals, settings] = await Promise.all([
    db.exercises.toArray(),
    db.entries.toArray(),
    db.goals.toArray(),
    db.settings.get("app"),
  ]);

  // The settings row is created lazily on first read, so a fresh install that
  // has never opened a screen legitimately has none. Exporting defaults is
  // correct; throwing would make the very first export fail.

  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: clock.now().instant,
    data: { exercises, entries, goals, settings: settings ?? defaultSettings() },
  };
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates a backup file.
 *
 * Throws with a message a user could act on — the alternative is importing a
 * half-valid file over good data.
 */
export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("This file is not a sport-app backup.");
  }
  if (parsed["format"] !== BACKUP_FORMAT) {
    throw new Error(
      `This file is not a sport-app backup (format: ${String(parsed["format"] ?? "missing")}).`,
    );
  }

  const schemaVersion = parsed["schemaVersion"];
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new Error("This backup has no valid schemaVersion.");
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This backup was made by a newer version of the app (schema ${schemaVersion}, this build supports ${SCHEMA_VERSION}). Update the app first.`,
    );
  }

  const data = parsed["data"];
  if (!isRecord(data)) {
    throw new Error("This backup has no data section.");
  }
  for (const key of ["exercises", "entries", "goals"] as const) {
    if (!Array.isArray(data[key])) {
      throw new Error(`This backup's ${key} section is missing or not a list.`);
    }
  }
  const settings = data["settings"];
  if (!isRecord(settings) || typeof settings["id"] !== "string") {
    throw new Error("This backup's settings section is missing.");
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion,
    exportedAt: String(parsed["exportedAt"] ?? ""),
    data: {
      exercises: data["exercises"] as Exercise[],
      entries: data["entries"] as Entry[],
      goals: data["goals"] as Goal[],
      settings: settings as unknown as SettingsRow,
    },
  };
}

/** Records that an export just happened, so the nudge resets. */
export async function stampExport(db: SportDatabase, clock: Clock): Promise<void> {
  const existing = (await db.settings.get("app")) ?? defaultSettings();
  await db.settings.put({ ...existing, lastExportAt: clock.now().instant });
}

/** Records that the user dismissed the nudge, so it stays quiet for a while. */
export async function stampNudgeDismissed(db: SportDatabase, clock: Clock): Promise<void> {
  const existing = (await db.settings.get("app")) ?? defaultSettings();
  await db.settings.put({ ...existing, lastBackupNudgeAt: clock.now().instant });
}

/**
 * Whether to nag about exporting.
 *
 * Three conditions, all required: enough data to be worth losing, an export
 * older than `EXPORT_STALE_DAYS` (or none ever), and no recent dismissal.
 * `distinctDays` is passed in because counting it is the caller's query.
 */
export function needsBackupNudge(
  settings: SettingsRow,
  distinctDays: number,
  today: string,
): boolean {
  if (distinctDays < EXPORT_MIN_DAYS) return false;

  if (settings.lastBackupNudgeAt !== undefined) {
    const sinceDismissal = diffDays(today, settings.lastBackupNudgeAt.slice(0, 10));
    if (sinceDismissal < NUDGE_SNOOZE_DAYS) return false;
  }

  if (settings.lastExportAt === undefined) return true;

  const daysSinceExport = diffDays(today, settings.lastExportAt.slice(0, 10));
  return daysSinceExport >= EXPORT_STALE_DAYS;
}

/** `sport-app-backup-2026-03-04.json` — sorts chronologically in a downloads folder. */
export function backupFilename(exportedAt: string): string {
  return `sport-app-backup-${exportedAt.slice(0, 10)}.json`;
}
