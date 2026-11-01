import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, SCHEMA_VERSION, type SportDatabase } from "./db.ts";
import { createClock } from "./clock.ts";
import { createExercisesRepo } from "./repos/exercises.ts";
import { createEntriesRepo } from "./repos/entries.ts";
import { createGoalsRepo } from "./repos/goals.ts";
import { createSettingsRepo } from "./repos/settings.ts";
import { seedIfEmpty } from "./seed.ts";
import {
  BACKUP_FORMAT,
  buildBackup,
  needsBackupNudge,
  parseBackup,
  serializeBackup,
  stampExport,
} from "./backup.ts";

let counter = 0;
let db: SportDatabase;

function fixedClock(day = "2026-03-04", hour = 12) {
  return createClock(() => ({
    day,
    hour,
    instant: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  }));
}

beforeEach(async () => {
  counter += 1;
  db = createDatabase(`backup-test-${counter}`);
  await seedIfEmpty(db, fixedClock());
});

afterEach(async () => {
  await db.close();
  await db.delete();
});

describe("backup envelope", () => {
  it("carries the format, schema version and export instant", async () => {
    const backup = await buildBackup(db, fixedClock("2026-03-04", 9));
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.exportedAt).toBe("2026-03-04T09:00:00.000Z");
  });

  it("includes every table", async () => {
    const settings = createSettingsRepo(db);
    const exercises = createExercisesRepo(db, fixedClock());
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const ex = await exercises.create({ name: "Extra", kind: "reps", unit: "reps", step: 5, order: 9 });
    await entries.addSet({ exerciseId: ex.id, amount: 20 });
    await entries.addSet({ exerciseId: "ex-pushup", amount: 15 });

    const backup = await buildBackup(db, fixedClock());

    expect(backup.data.exercises).toHaveLength(4);
    expect(backup.data.entries).toHaveLength(2);
    expect(backup.data.goals.length).toBeGreaterThan(0);
    expect(backup.data.settings.id).toBe("app");
  });

  it("is JSON-serialisable and round-trips without loss", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20, note: "morning" });
    await entries.addSet({ exerciseId: "ex-core", amount: 60 });

    const before = await buildBackup(db, fixedClock());
    const text = serializeBackup(before);
    const after = parseBackup(text);

    expect(after.data.entries).toHaveLength(before.data.entries.length);
    expect(after.data.exercises).toHaveLength(before.data.exercises.length);
    expect(after.data.goals).toHaveLength(before.data.goals.length);
    expect(after.data.entries.map((e) => e.amount).sort((a, b) => a - b)).toEqual([20, 60]);
    expect(after.schemaVersion).toBe(before.schemaVersion);
    expect(after.format).toBe(before.format);
  });

  it("preserves entry fields exactly, including seq and note", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const created = await entries.addSet({ exerciseId: "ex-pushup", amount: 20, note: "morning" });

    const text = serializeBackup(await buildBackup(db, fixedClock()));
    const parsed = parseBackup(text);
    const found = parsed.data.entries.find((e) => e.id === created.id);

    expect(found).toEqual(created);
  });

  it("preserves goal versioning history", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    const activeDays = await goals.activeOn("2026-03-04");
    const pushupGoal = activeDays.find(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    await goals.retarget(pushupGoal?.id ?? "", { atDay: "2026-03-04", newTarget: 800 });

    const parsed = parseBackup(serializeBackup(await buildBackup(db, fixedClock())));
    const pushupGoals = parsed.data.goals.filter(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    expect(pushupGoals).toHaveLength(2);
    expect(pushupGoals.map((g) => g.target).sort((a, b) => a - b)).toEqual([700, 800]);
  });
});

describe("parseBackup — validation", () => {
  it("rejects non-JSON", () => {
    expect(() => parseBackup("not json")).toThrow(/not valid JSON/i);
  });

  it("rejects a wrong format marker", () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: "something-else", schemaVersion: 1, data: {} })),
    ).toThrow(/format/i);
  });

  it("rejects a newer schema version than this build supports", () => {
    // Forward-only: an older build must refuse rather than corrupt data.
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: BACKUP_FORMAT,
          schemaVersion: SCHEMA_VERSION + 1,
          exportedAt: "2026-03-04T00:00:00.000Z",
          data: { exercises: [], entries: [], goals: [], settings: {} },
        }),
      ),
    ).toThrow(/newer/i);
  });

  it("rejects missing data sections", () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: "x" })),
    ).toThrow(/data/i);
  });

  it("rejects non-array entries", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: BACKUP_FORMAT,
          schemaVersion: SCHEMA_VERSION,
          exportedAt: "2026-03-04T00:00:00.000Z",
          data: { exercises: [], entries: "nope", goals: [], settings: {} },
        }),
      ),
    ).toThrow(/entries/i);
  });
});

describe("stampExport", () => {
  it("records lastExportAt on the settings row", async () => {
    const settings = createSettingsRepo(db);
    await stampExport(db, fixedClock("2026-03-04", 9));

    const row = await settings.get();
    expect(row.lastExportAt).toBe("2026-03-04T09:00:00.000Z");
  });
});

describe("needsBackupNudge", () => {
  const settings = (over: Partial<{ lastExportAt: string; lastBackupNudgeAt: string }>) => ({
    id: "app",
    weekStartsOn: 1 as const,
    dayCutoffHour: 0,
    activeDayMinAmount: 1,
    schemaVersion: SCHEMA_VERSION,
    ...over,
  });

  it("nudges when there has never been an export and there is data", () => {
    expect(needsBackupNudge(settings({}), 10, "2026-03-04")).toBe(true);
  });

  it("does not nudge without enough days of data", () => {
    // Fewer than 7 days of entries: nothing worth backing up yet.
    expect(needsBackupNudge(settings({}), 3, "2026-03-04")).toBe(false);
  });

  it("does not nudge when the last export is recent", () => {
    expect(
      needsBackupNudge(settings({ lastExportAt: "2026-02-25T00:00:00.000Z" }), 30, "2026-03-04"),
    ).toBe(false);
  });

  it("nudges when the last export is 15 days old", () => {
    expect(
      needsBackupNudge(settings({ lastExportAt: "2026-02-17T00:00:00.000Z" }), 30, "2026-03-04"),
    ).toBe(true);
  });

  it("does not nudge at 13 days", () => {
    expect(
      needsBackupNudge(settings({ lastExportAt: "2026-02-19T00:00:00.000Z" }), 30, "2026-03-04"),
    ).toBe(false);
  });

  it("respects a recent dismissal", () => {
    expect(
      needsBackupNudge(
        settings({ lastExportAt: "2026-01-01T00:00:00.000Z", lastBackupNudgeAt: "2026-03-02T00:00:00.000Z" }),
        30,
        "2026-03-04",
      ),
    ).toBe(false);
  });

  it("nudges again once a dismissal is old enough", () => {
    expect(
      needsBackupNudge(
        settings({ lastExportAt: "2026-01-01T00:00:00.000Z", lastBackupNudgeAt: "2026-02-01T00:00:00.000Z" }),
        30,
        "2026-03-04",
      ),
    ).toBe(true);
  });
});
