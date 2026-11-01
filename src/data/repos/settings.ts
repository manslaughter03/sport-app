/**
 * Settings repository. Single row, `id = "app"`.
 *
 * The row is created lazily on first read so a fresh install always has sane
 * defaults, and so no caller has to special-case "no settings yet".
 */

import type { SportDatabase, SettingsRow } from "../db.ts";
import { SCHEMA_VERSION } from "../db.ts";

export const SETTINGS_ID = "app";

export function defaultSettings(): SettingsRow {
  return {
    id: SETTINGS_ID,
    weekStartsOn: 1, // Monday
    dayCutoffHour: 0,
    activeDayMinAmount: 1, // O3 default: any entry counts
    schemaVersion: SCHEMA_VERSION,
  };
}

export interface SettingsRepo {
  get(): Promise<SettingsRow>;
  update(patch: Partial<Omit<SettingsRow, "id">>): Promise<SettingsRow>;
}

export function createSettingsRepo(db: SportDatabase): SettingsRepo {
  return {
    async get(): Promise<SettingsRow> {
      const existing = await db.settings.get(SETTINGS_ID);
      if (existing !== undefined) return existing;

      const created = defaultSettings();
      // `add` in a transaction: if two callers race, the loser gets a
      // ConstraintError rather than a duplicate row.
      try {
        await db.settings.add(created);
      } catch {
        const raced = await db.settings.get(SETTINGS_ID);
        if (raced !== undefined) return raced;
      }
      return created;
    },

    async update(patch): Promise<SettingsRow> {
      const current = await this.get();
      const next: SettingsRow = { ...current, ...patch, id: SETTINGS_ID };
      await db.settings.put(next);
      return next;
    },
  };
}
