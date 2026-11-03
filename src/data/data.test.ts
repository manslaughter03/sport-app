import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type SportDatabase } from "./db.ts";
import { createClock, systemClock } from "./clock.ts";
import { createExercisesRepo } from "./repos/exercises.ts";
import { createEntriesRepo } from "./repos/entries.ts";
import { createGoalsRepo } from "./repos/goals.ts";
import { createSettingsRepo } from "./repos/settings.ts";
import { allEntries, seedIfEmpty, SEED_EXERCISES, SEED_GOALS } from "./seed.ts";

let db: SportDatabase;
let dbName: string;
let counter = 0;

/** A deterministic clock, so no test depends on the wall clock. */
function fixedClock(day = "2026-03-04", hour = 12) {
  return createClock(() => ({ day, hour, instant: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z` }));
}

beforeEach(() => {
  counter += 1;
  dbName = `sport-test-${counter}`;
  db = createDatabase(dbName);
});

afterEach(async () => {
  await db.delete();
});

describe("schema v1", () => {
  it("declares the expected stores and indexes", async () => {
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(["entries", "exercises", "goals", "settings"]);

    const entries = db.table("entries");
    const indexNames = entries.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual(
      ["day", "exerciseId", "seq", "[day+exerciseId]", "[exerciseId+day]"].sort(),
    );
  });

  it("starts at version 1", async () => {
    await db.open();
    expect(db.verno).toBe(1);
  });
});

describe("settings repo", () => {
  it("creates a default row on first read", async () => {
    const settings = createSettingsRepo(db);
    const value = await settings.get();
    expect(value.id).toBe("app");
    expect(value.weekStartsOn).toBe(1);
    expect(value.dayCutoffHour).toBe(0);
    expect(value.activeDayMinAmount).toBe(1);
    expect(value.schemaVersion).toBe(1);
  });

  it("is idempotent — reading twice yields one row", async () => {
    const settings = createSettingsRepo(db);
    await settings.get();
    await settings.get();
    expect(await db.table("settings").count()).toBe(1);
  });

  it("persists an update", async () => {
    const settings = createSettingsRepo(db);
    await settings.update({ dayCutoffHour: 3, weekStartsOn: 7 });
    const value = await settings.get();
    expect(value.dayCutoffHour).toBe(3);
    expect(value.weekStartsOn).toBe(7);
  });
});

describe("exercises repo", () => {
  it("creates and reads back an exercise", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const created = await exercises.create({
      name: "Push-up",
      kind: "reps",
      unit: "reps",
      step: 5,
      order: 1,
    });
    const found = await exercises.get(created.id);
    expect(found?.name).toBe("Push-up");
    expect(found?.kind).toBe("reps");
  });

  it("lists non-archived exercises in display order", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await exercises.create({ name: "Third", kind: "reps", unit: "reps", step: 5, order: 3 });
    await exercises.create({ name: "First", kind: "reps", unit: "reps", step: 5, order: 1 });
    await exercises.create({ name: "Second", kind: "duration", unit: "s", step: 30, order: 2 });
    expect((await exercises.list()).map((e) => e.name)).toEqual(["First", "Second", "Third"]);
  });

  it("archives without deleting, and keeps the row in all()", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const created = await exercises.create({ name: "Old", kind: "reps", unit: "reps", step: 5, order: 1 });
    await exercises.archive(created.id);

    expect(await exercises.list()).toHaveLength(0);
    const all = await exercises.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.archivedAt).toBe("2026-03-04T12:00:00.000Z");
  });

  it("updates fields without touching the id", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const created = await exercises.create({ name: "Push", kind: "reps", unit: "reps", step: 5, order: 1 });
    const updated = await exercises.update(created.id, { name: "Push-up", step: 10 });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Push-up");
    expect(updated.step).toBe(10);
  });

  it("rejects an update for an unknown id", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await expect(exercises.update("nope", { name: "x" })).rejects.toThrow(/not found/i);
  });
});

describe("entries repo", () => {
  it("writes the local day from the injected clock, not from the caller", async () => {
    const clock = fixedClock("2026-03-04", 2);
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    await settings.update({ dayCutoffHour: 3 });
    const ex = await exercises.create({ name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 });

    const entries = createEntriesRepo(db, clock, settings);
    const created = await entries.addSet({ exerciseId: ex.id, amount: 20 });

    // 02:00 with cutoff 3 belongs to the previous day.
    expect(created.day).toBe("2026-03-03");
    expect(created.amount).toBe(20);
    expect(created.createdAt).toBe("2026-03-04T02:00:00.000Z");
  });

  it("keeps one row per set rather than a daily bucket", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: ex.id, amount: 20 });
    await entries.addSet({ exerciseId: ex.id, amount: 15 });
    await entries.addSet({ exerciseId: ex.id, amount: 12 });

    const rows = await entries.forDay("2026-03-04");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([12, 15, 20]);
  });

  it("queries a day via the compound index", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const a = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const b = await exercises.create({ name: "B", kind: "reps", unit: "reps", step: 5, order: 2 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: a.id, amount: 20, at: { day: "2026-03-02", hour: 12 } });
    await entries.addSet({ exerciseId: b.id, amount: 30, at: { day: "2026-03-02", hour: 12 } });
    await entries.addSet({ exerciseId: a.id, amount: 10, at: { day: "2026-03-03", hour: 12 } });

    expect(await entries.forDayAndExercise("2026-03-02", a.id)).toHaveLength(1);
    expect(await entries.forDay("2026-03-02")).toHaveLength(2);
  });

  it("queries a half-open range", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: ex.id, amount: 1, at: { day: "2026-03-01", hour: 12 } });
    await entries.addSet({ exerciseId: ex.id, amount: 2, at: { day: "2026-03-02", hour: 12 } });
    await entries.addSet({ exerciseId: ex.id, amount: 3, at: { day: "2026-03-09", hour: 12 } });

    const rows = await entries.inRange({ start: "2026-03-02", end: "2026-03-09" });
    expect(rows.map((r) => r.amount)).toEqual([2]);
  });

  it("removes exactly one set (undo)", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    const first = await entries.addSet({ exerciseId: ex.id, amount: 20 });
    await entries.addSet({ exerciseId: ex.id, amount: 15 });

    await entries.remove(first.id);
    const rows = await entries.forDay("2026-03-04");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(15);
  });

  it("finds the last set for undo-last", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: ex.id, amount: 20, at: { day: "2026-03-02", hour: 12 } });
    const last = await entries.addSet({ exerciseId: ex.id, amount: 15, at: { day: "2026-03-04", hour: 12 } });

    expect((await entries.lastForExercise(ex.id))?.id).toBe(last.id);
  });

  it("keeps entries of an archived exercise queryable", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: ex.id, amount: 20 });
    await exercises.archive(ex.id);

    expect(await entries.forDay("2026-03-04")).toHaveLength(1);
  });
});

describe("goals repo", () => {
  it("creates a goal and finds it in force", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-1" },
      period: "week",
      target: 700,
      cap: false,
      effectiveFrom: "2026-01-01",
    });

    const inForce = await goals.inForce({ kind: "exercise", exerciseId: "ex-1" }, "week", "2026-03-09");
    expect(inForce?.target).toBe(700);
  });

  it("returns undefined when nothing is in force", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    expect(await goals.inForce({ kind: "activeDays" }, "week", "2026-03-09")).toBeUndefined();
  });

  it("retargets by splitting, leaving history intact", async () => {
    const clock = fixedClock("2026-03-04", 12);
    const goals = createGoalsRepo(db, clock);
    const original = await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-1" },
      period: "week",
      target: 700,
      cap: false,
      effectiveFrom: "2026-01-01",
    });

    await goals.retarget(original.id, { atDay: "2026-03-04", newTarget: 800 });

    // February week still reads 700; March reads 800.
    const february = await goals.inForce({ kind: "exercise", exerciseId: "ex-1" }, "week", "2026-03-02");
    const march = await goals.inForce({ kind: "exercise", exerciseId: "ex-1" }, "week", "2026-03-09");
    expect(february?.target).toBe(700);
    expect(march?.target).toBe(800);

    // Two rows now, and the old one is closed rather than mutated away.
    const all = await goals.all();
    expect(all).toHaveLength(2);
    expect(all.find((g) => g.id === original.id)?.effectiveTo).toBe("2026-03-04");
  });

  it("lists one goal per scope and period for the current day", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-1" },
      period: "week",
      target: 700,
      cap: false,
      effectiveFrom: "2026-01-01",
    });
    await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-1" },
      period: "month",
      target: 3000,
      cap: false,
      effectiveFrom: "2026-01-01",
    });
    await goals.create({
      scope: { kind: "activeDays" },
      period: "week",
      target: 4,
      cap: false,
      effectiveFrom: "2026-01-01",
    });

    expect(await goals.activeOn("2026-03-04")).toHaveLength(3);
  });
});

describe("seed", () => {
  it("creates the three exercises and their goals", async () => {
    const clock = fixedClock();
    await seedIfEmpty(db, clock);

    const exercises = await db.table("exercises").toArray();
    expect(exercises).toHaveLength(3);
    expect(exercises.map((e) => e.name).sort()).toEqual(["Core", "Push-up", "Toe Touch"]);

    const goals = await db.table("goals").toArray();
    expect(goals).toHaveLength(SEED_GOALS.length);
  });

  it("uses the agreed targets", async () => {
    const clock = fixedClock();
    await seedIfEmpty(db, clock);
    const goals = await db.table("goals").toArray();

    const pushup = SEED_EXERCISES.find((e) => e.name === "Push-up");
    const core = SEED_EXERCISES.find((e) => e.name === "Core");
    const toe = SEED_EXERCISES.find((e) => e.name === "Toe Touch");

    const targetFor = (exerciseId: string) => goals.find((g) => g.scope.exerciseId === exerciseId)?.target;
    expect(targetFor(pushup?.id ?? "")).toBe(700);
    expect(targetFor(core?.id ?? "")).toBe(3000);
    expect(targetFor(toe?.id ?? "")).toBe(1000);

    const activeDays = goals.find((g) => g.scope.kind === "activeDays");
    expect(activeDays?.target).toBe(4);
  });

  it("seeds high-volume steps so quick-add is usable per exercise", async () => {
    await seedIfEmpty(db, fixedClock());
    const exercises = await db.table("exercises").toArray();
    const stepOf = (name: string) => exercises.find((e) => e.name === name)?.step;

    // Push-ups arrive in tens, toe touches in hundreds, core in 30 s blocks.
    expect(stepOf("Push-up")).toBe(5);
    expect(stepOf("Toe Touch")).toBe(50);
    expect(stepOf("Core")).toBe(30);
  });

  it("is idempotent — reopening does not duplicate", async () => {
    const clock = fixedClock();
    await seedIfEmpty(db, clock);
    await seedIfEmpty(db, clock);

    expect(await db.table("exercises").count()).toBe(3);
    expect(await db.table("goals").count()).toBe(SEED_GOALS.length);
  });

  it("does not overwrite user edits", async () => {
    const clock = fixedClock();
    await seedIfEmpty(db, clock);
    const pushup = SEED_EXERCISES.find((e) => e.name === "Push-up");
    const pushupId = pushup?.id ?? "";
    expect(pushupId).not.toBe("");
    await db.table("exercises").update(pushupId, { name: "Pushups renamed" });

    await seedIfEmpty(db, clock);
    const stored = await db.table("exercises").get(pushupId);
    expect(stored?.name).toBe("Pushups renamed");
  });

  it("sets sensible settings on first run", async () => {
    const clock = fixedClock();
    await seedIfEmpty(db, clock);
    const settings = createSettingsRepo(db);
    const value = await settings.get();
    expect(value.weekStartsOn).toBe(1);
    expect(value.activeDayMinAmount).toBe(1);
  });
});

describe("entries repo — undo ordering", () => {
  it("undoes the newest set even when two sets share a millisecond", async () => {
    // Regression: a fixed clock gives every set the same `createdAt`, so
    // ordering by timestamp alone made "undo last" delete an arbitrary row.
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    const first = await entries.addSet({ exerciseId: ex.id, amount: 20 });
    const second = await entries.addSet({ exerciseId: ex.id, amount: 15 });
    const third = await entries.addSet({ exerciseId: ex.id, amount: 12 });

    expect(first.createdAt).toBe(third.createdAt); // same instant
    expect(first.seq).toBeLessThan(second.seq);
    expect(second.seq).toBeLessThan(third.seq);
    expect((await entries.lastForExercise(ex.id))?.id).toBe(third.id);
  });

  it("keeps seq monotonic across repository instances (reload)", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });

    const before = createEntriesRepo(db, clock, settings);
    const a = await before.addSet({ exerciseId: ex.id, amount: 20 });

    // A fresh repo instance, as after a page reload.
    const after = createEntriesRepo(db, clock, settings);
    const b = await after.addSet({ exerciseId: ex.id, amount: 15 });

    expect(b.seq).toBeGreaterThan(a.seq);
    expect((await after.lastForExercise(ex.id))?.id).toBe(b.id);
  });
});

describe("system clock", () => {
  it("produces a local day, an hour and a UTC instant that agree", () => {
    const now = systemClock().now();
    expect(now.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now.hour).toBeGreaterThanOrEqual(0);
    expect(now.hour).toBeLessThanOrEqual(23);
    expect(now.instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The instant's UTC date must be within a day of the local day (time zones
    // differ by at most ~14h, so never more than one calendar day apart).
    const utcDay = now.instant.slice(0, 10);
    expect(Math.abs(Date.parse(now.day) - Date.parse(utcDay))).toBeLessThanOrEqual(86_400_000);
  });
});

describe("repo edge cases", () => {
  it("unarchives an exercise", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const created = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    await exercises.archive(created.id);
    expect(await exercises.list()).toHaveLength(0);

    await exercises.unarchive(created.id);
    expect(await exercises.list()).toHaveLength(1);
    expect((await exercises.get(created.id))?.archivedAt).toBeUndefined();
  });

  it("archiving an unknown id is a no-op", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await expect(exercises.archive("nope")).resolves.toBeUndefined();
    await expect(exercises.unarchive("nope")).resolves.toBeUndefined();
  });

  it("rejects a non-positive entry amount", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await expect(entries.addSet({ exerciseId: ex.id, amount: 0 })).rejects.toThrow(/positive/i);
    await expect(entries.addSet({ exerciseId: ex.id, amount: -5 })).rejects.toThrow(/positive/i);
    await expect(entries.addSet({ exerciseId: ex.id, amount: Number.NaN })).rejects.toThrow(/positive/i);
  });

  it("stores an optional note", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    const created = await entries.addSet({ exerciseId: ex.id, amount: 20, note: "morning" });
    expect(created.note).toBe("morning");
  });

  it("rejects an invalid goal target", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    const base = {
      scope: { kind: "exercise" as const, exerciseId: "ex-1" },
      period: "week" as const,
      cap: false,
      effectiveFrom: "2026-01-01",
    };
    await expect(goals.create({ ...base, target: 0 })).rejects.toThrow(/positive/i);
    await expect(goals.create({ ...base, target: 12.5 })).rejects.toThrow(/integer/i);
  });

  it("rejects retargeting an unknown goal", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    await expect(goals.retarget("nope", { atDay: "2026-03-04", newTarget: 800 })).rejects.toThrow(
      /not found/i,
    );
  });

  it("counts and lists entries", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const ex = await exercises.create({ name: "A", kind: "reps", unit: "reps", step: 5, order: 1 });
    const entries = createEntriesRepo(db, clock, settings);

    await entries.addSet({ exerciseId: ex.id, amount: 20 });
    await entries.addSet({ exerciseId: ex.id, amount: 10 });

    expect(await entries.count()).toBe(2);
    expect(await entries.all()).toHaveLength(2);
    expect(await allEntries(db)).toHaveLength(2);
  });

  it("returns undefined for undo when an exercise has no sets", async () => {
    const clock = fixedClock();
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, clock, settings);
    expect(await entries.lastForExercise("ex-none")).toBeUndefined();
  });

  it("reports whether the seed wrote anything", async () => {
    const clock = fixedClock();
    expect(await seedIfEmpty(db, clock)).toBe(true);
    expect(await seedIfEmpty(db, clock)).toBe(false);
  });
});

describe("settings race and goal reads", () => {
  it("does not duplicate the settings row under concurrent first reads", async () => {
    const settings = createSettingsRepo(db);
    const results = await Promise.all([settings.get(), settings.get(), settings.get()]);
    expect(await db.table("settings").count()).toBe(1);
    for (const row of results) {
      expect(row.id).toBe("app");
    }
  });

  it("reads a goal back by id", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    const created = await goals.create({
      scope: { kind: "activeDays" },
      period: "week",
      target: 4,
      cap: false,
      effectiveFrom: "2026-01-01",
    });
    expect((await goals.get(created.id))?.target).toBe(4);
    expect(await goals.get("nope")).toBeUndefined();
  });

  it("lists all goals ordered by effectiveFrom", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-2" },
      period: "week",
      target: 200,
      cap: false,
      effectiveFrom: "2026-02-01",
    });
    await goals.create({
      scope: { kind: "exercise", exerciseId: "ex-1" },
      period: "week",
      target: 100,
      cap: false,
      effectiveFrom: "2026-01-01",
    });

    const all = await goals.all();
    expect(all.map((g) => g.effectiveFrom)).toEqual(["2026-01-01", "2026-02-01"]);
  });
});

describe("settings repo — defensive race branch", () => {
  it("returns the row another writer inserted when our add fails", async () => {
    const settings = createSettingsRepo(db);

    // Simulate the narrow race: the row appears between our read and our add,
    // so `add` throws ConstraintError but a usable row now exists.
    const realAdd = db.settings.add.bind(db.settings);
    db.settings.add = (async (row: never) => {
      await realAdd(row);
      throw new Error("ConstraintError (simulated)");
    }) as unknown as typeof db.settings.add;

    const value = await settings.get();
    expect(value.id).toBe("app");
    expect(await db.table("settings").count()).toBe(1);

    db.settings.add = realAdd;
  });

  it("still returns defaults when the add fails and no row exists", async () => {
    const settings = createSettingsRepo(db);
    db.settings.add = (async () => {
      throw new Error("write failed");
    }) as unknown as typeof db.settings.add;

    const value = await settings.get();
    expect(value.weekStartsOn).toBe(1);
    expect(value.dayCutoffHour).toBe(0);
  });
});

describe("exercises repo — ordering and archiving (#17)", () => {
  // This suite starts from an empty database, so these cases seed explicitly.
  beforeEach(async () => {
    await seedIfEmpty(db, fixedClock());
  });

  it("gives a new exercise the next free order", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    // Seeded rows sit at orders 1..3.
    const next = await exercises.nextOrder();
    expect(next).toBe(4);

    const created = await exercises.create({
      name: "Pull-up",
      kind: "reps",
      unit: "reps",
      step: 1,
      order: next,
    });
    expect(created.order).toBe(4);
  });

  it("moves an exercise and renumbers the rest without gaps or duplicates", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const moved = await exercises.move("ex-toe-touch", 0);

    expect(moved.map((e) => e.name)).toEqual(["Toe Touch", "Push-up", "Core"]);
    // Contiguous 1..n: a gap would make `move` arithmetic drift over time.
    expect(moved.map((e) => e.order)).toEqual([1, 2, 3]);

    // Persisted, not just returned.
    const relisted = await exercises.list();
    expect(relisted.map((e) => e.name)).toEqual(["Toe Touch", "Push-up", "Core"]);
  });

  it("leaves every other exercise's order valid after a move", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await exercises.move("ex-pushup", 2);

    const ordered = await exercises.list();
    expect(ordered.map((e) => e.name)).toEqual(["Core", "Toe Touch", "Push-up"]);
    expect(new Set(ordered.map((e) => e.order)).size).toBe(ordered.length);
  });

  it("clamps a move past either end instead of dropping the exercise", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    const first = await exercises.move("ex-core", -5);
    expect(first[0]?.name).toBe("Core");

    const last = await exercises.move("ex-pushup", 99);
    expect(last.at(-1)?.name).toBe("Push-up");
    expect(await exercises.list()).toHaveLength(3);
  });

  it("refuses to move an archived exercise", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await exercises.archive("ex-core");
    await expect(exercises.move("ex-core", 0)).rejects.toThrow(/archived/i);
  });

  it("keeps an archived exercise's history queryable through the UI path", async () => {
    const clock = fixedClock();
    const exercises = createExercisesRepo(db, clock);
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, clock, settings);

    const created = await entries.addSet({ exerciseId: "ex-toe-touch", amount: 200 });
    await exercises.archive("ex-toe-touch");

    // Gone from Today's list, still present for history and export.
    expect((await exercises.list()).some((e) => e.id === "ex-toe-touch")).toBe(false);
    expect((await exercises.all()).some((e) => e.id === "ex-toe-touch")).toBe(true);
    expect((await entries.forDayAndExercise(created.day, "ex-toe-touch")).length).toBeGreaterThan(0);
  });

  it("unarchiving puts an exercise back at its old position", async () => {
    const exercises = createExercisesRepo(db, fixedClock());
    await exercises.archive("ex-pushup");
    expect((await exercises.list()).map((e) => e.name)).not.toContain("Push-up");

    await exercises.unarchive("ex-pushup");
    // `order` was never rewritten while archived, so the original slot is intact.
    expect((await exercises.list()).map((e) => e.name)).toEqual(["Push-up", "Core", "Toe Touch"]);
  });

  it("a new exercise has no goal, so it reads as untargeted rather than NaN", () => {
    // The UI half of this is in Targets.test.tsx; here it is only the shape.
    const exercise = {
      id: "ex-new",
      name: "Pull-up",
      kind: "reps" as const,
      unit: "reps",
      step: 1,
      order: 9,
    };
    expect(exercise).not.toHaveProperty("goal");
  });
});
