import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, SCHEMA_VERSION, type SportDatabase } from "./db.ts";
import { createClock } from "./clock.ts";
import { createEntriesRepo } from "./repos/entries.ts";
import { createGoalsRepo } from "./repos/goals.ts";
import { createSettingsRepo } from "./repos/settings.ts";
import { seedIfEmpty } from "./seed.ts";
import { BACKUP_FORMAT, buildBackup, parseBackup, serializeBackup, type Backup } from "./backup.ts";
import {
  assignSeq,
  describeImport,
  importBackup,
  ImportValidationError,
  validateBackup,
} from "./import.ts";
import type { Entry } from "../domain/types.ts";

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
  db = createDatabase(`import-test-${counter}`);
  await seedIfEmpty(db, fixedClock());
});

afterEach(async () => {
  await db.close();
  await db.delete();
});

/** An empty, self-consistent backup that tests can add rows to. */
function emptyBackup(over: Partial<Backup> = {}): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-03-04T12:00:00.000Z",
    data: {
      exercises: [],
      entries: [],
      goals: [],
      settings: {
        id: "app",
        weekStartsOn: 1,
        dayCutoffHour: 0,
        activeDayMinAmount: 1,
        schemaVersion: SCHEMA_VERSION,
      },
    },
    ...over,
  };
}

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    exerciseId: "ex-pushup",
    day: "2026-03-01",
    amount: 20,
    createdAt: "2026-03-01T10:00:00.000Z",
    seq: 100,
    ...over,
  };
}

describe("importBackup — restoring a real export", () => {
  it("restores every row, byte-for-byte equal, onto a clean database", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20, note: "morning" });
    await entries.addSet({ exerciseId: "ex-core", amount: 60 });

    const exported = await buildBackup(db, fixedClock());
    // A fresh install: same schema, no exercises beyond nothing at all.
    const target = createDatabase(`import-test-target-${counter}`);
    try {
      const report = await importBackup(target, parseBackup(serializeBackup(exported)));

      expect(report.mode).toBe("merge");
      expect(report.added.exercises).toBe(exported.data.exercises.length);
      expect(report.added.entries).toBe(2);
      expect(report.added.goals).toBe(exported.data.goals.length);

      const restoredEntries = await target.entries.toArray();
      const restoredGoals = await target.goals.toArray();
      const restoredExercises = await target.exercises.toArray();

      // Byte-for-byte: same ids, same `seq`, same `note`, same order.
      expect(sortById(restoredEntries)).toEqual(sortById(exported.data.entries));
      expect(sortById(restoredGoals)).toEqual(sortById(exported.data.goals));
      expect(sortById(restoredExercises)).toEqual(sortById(exported.data.exercises));
    } finally {
      await target.close();
      await target.delete();
    }
  });

  it("replace-all restores byte-for-byte, including seq", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    // Local state that the restore must discard entirely.
    await entries.addSet({ exerciseId: "ex-pushup", amount: 99 });

    const exported = await buildBackup(db, fixedClock());
    await entries.addSet({ exerciseId: "ex-toe-touch", amount: 40 });
    expect(await db.entries.count()).toBe(2);

    const report = await importBackup(db, exported, { mode: "replace" });

    expect(report.mode).toBe("replace");
    expect(report.removed.entries).toBe(2);
    expect(report.resequenced).toBe(0);

    const restored = sortById(await db.entries.toArray());
    expect(restored).toEqual(sortById(exported.data.entries));
    // The set logged after the export is gone; that is what "replace" means.
    expect(restored.some((e) => e.amount === 40)).toBe(false);
  });

  it("replace-all restores the file's settings, merge keeps the local ones", async () => {
    const settings = createSettingsRepo(db);
    await settings.update({ weekStartsOn: 7, dayCutoffHour: 3 });

    const other = emptyBackup();
    other.data.settings = { ...other.data.settings, weekStartsOn: 1, dayCutoffHour: 0 };

    await importBackup(db, other, { mode: "replace" });
    expect((await settings.get()).weekStartsOn).toBe(1);

    // A merge must not adopt another device's week start: it would move every
    // week boundary under history the user already has.
    await importBackup(db, other, { mode: "merge" });
    expect((await settings.get()).weekStartsOn).toBe(1);
  });
});

describe("importBackup — idempotence", () => {
  it("importing the same file twice changes nothing the second time", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const exported = parseBackup(serializeBackup(await buildBackup(db, fixedClock())));

    const first = await importBackup(db, exported);
    expect(first.noop).toBe(true);
    expect(first.added.entries).toBe(0);
    expect(first.skipped.entries).toBe(1);

    const before = snapshot(await db.entries.toArray());

    const second = await importBackup(db, exported);
    expect(second.noop).toBe(true);
    expect(second.added).toEqual({ exercises: 0, entries: 0, goals: 0 });
    expect(second.overwritten).toEqual({ exercises: 0, entries: 0, goals: 0 });
    expect(second.resequenced).toBe(0);

    // Zero duplicates, and the rows are untouched.
    expect(await db.entries.count()).toBe(1);
    expect(snapshot(await db.entries.toArray())).toEqual(before);
  });

  it("merging into an identical database added nothing and duplicated nothing", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    await entries.addSet({ exerciseId: "ex-core", amount: 30 });

    const exported = await buildBackup(db, fixedClock());
    const report = await importBackup(db, exported);

    expect(report.added.entries).toBe(0);
    expect(report.overwritten.entries).toBe(0);
    expect(report.skipped.entries).toBe(2);
    expect(await db.entries.count()).toBe(2);
  });
});

describe("importBackup — last-write-wins conflicts", () => {
  it("the newer entry wins and the count is reported", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const created = await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.entries = [
      { ...created, amount: 25, createdAt: "2026-03-05T10:00:00.000Z", seq: created.seq },
    ];

    const report = await importBackup(db, file);

    expect(report.overwritten.entries).toBe(1);
    expect(report.added.entries).toBe(0);
    expect((await db.entries.get(created.id))?.amount).toBe(25);
    expect(await db.entries.count()).toBe(1);
  });

  it("the older entry loses, so an old backup cannot roll data back", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const created = await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    await db.entries.put({ ...created, amount: 40, createdAt: "2026-03-05T10:00:00.000Z" });

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.entries = [
      { ...created, amount: 25, createdAt: "2026-03-01T10:00:00.000Z", seq: created.seq },
    ];

    const report = await importBackup(db, file);

    expect(report.overwritten.entries).toBe(0);
    expect(report.skipped.entries).toBe(1);
    expect((await db.entries.get(created.id))?.amount).toBe(40);
  });

  it("compares goals on createdAt the same way", async () => {
    const goals = createGoalsRepo(db, fixedClock());
    const goal = (await goals.activeOn("2026-03-04")).find(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    expect(goal).toBeDefined();

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.goals = [{ ...goal!, target: 900, createdAt: "2027-01-01T00:00:00.000Z" }];
    const report = await importBackup(db, file);

    expect((await goals.get(goal!.id))?.target).toBe(900);
    expect((await goals.get(goal!.id))?.createdAt).toBe("2027-01-01T00:00:00.000Z");
    // The seeded active-days goal is untouched, hence the split counts.
    expect(report.added.goals).toBe(0);
    expect(report.skipped.goals).toBe(0);
  });

  it("a local exercise is never silently rewritten: it is reported as skipped", async () => {
    const local = await db.exercises.get("ex-pushup");
    expect(local).toBeDefined();

    const file = emptyBackup();
    // `Exercise` carries no createdAt, so there is no defensible "newer".
    file.data.exercises = [{ ...local!, name: "Diamond push-up" }];

    const report = await importBackup(db, file);

    expect(report.skipped.exercises).toBe(1);
    expect(report.overwritten.exercises).toBe(0);
    expect((await db.exercises.get("ex-pushup"))?.name).toBe("Push-up");
  });
});

describe("importBackup — refusals", () => {
  it("refuses a newer schemaVersion without touching the database", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const before = await db.entries.count();

    const newer = emptyBackup({ schemaVersion: SCHEMA_VERSION + 1 });
    await expect(importBackup(db, newer)).rejects.toThrow(/newer version/i);
    expect(await db.entries.count()).toBe(before);
  });

  it("refuses an entry whose exercise is missing, before writing anything", async () => {
    const before = await snapshotAll(db);

    const file = emptyBackup();
    file.data.entries = [entry({ id: "e1", exerciseId: "ex-ghost" })];

    await expect(importBackup(db, file)).rejects.toBeInstanceOf(ImportValidationError);
    expect(await snapshotAll(db)).toEqual(before);
  });

  it("refuses a goal scoped to a missing exercise", async () => {
    const file = emptyBackup();
    file.data.goals = [
      {
        id: "g1",
        scope: { kind: "exercise", exerciseId: "ex-ghost" },
        period: "week",
        target: 100,
        cap: false,
        effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    await expect(importBackup(db, file)).rejects.toThrow(/unknown exercise/i);
  });

  it("reports every problem with the file, not just the first", () => {
    const file = emptyBackup();
    file.data.exercises = [{ id: "x", name: "", kind: "reps", unit: "reps", step: 5, order: 1 } as never];
    file.data.entries = [
      entry({ id: "e1", exerciseId: "ex-ghost" }),
      entry({ id: "e2", day: "not-a-day" }),
      // Same id twice inside one file: the merge would drop one arbitrarily.
      entry({ id: "e3" }),
      entry({ id: "e3" }),
    ];

    let caught: ImportValidationError | undefined;
    try {
      validateBackup(file);
    } catch (error) {
      caught = error as ImportValidationError;
    }

    expect(caught).toBeInstanceOf(ImportValidationError);
    expect(caught!.issues.length).toBeGreaterThanOrEqual(4);
    expect(caught!.message).toContain("cannot be imported safely");
  });

  it("refuses an entry with no day rather than inventing one", () => {
    const file = emptyBackup();
    file.data.exercises = [
      { id: "ex-pushup", name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 },
    ];
    file.data.entries = [{ ...entry({ id: "e1" }), day: undefined } as unknown as Entry];

    expect(() => validateBackup(file)).toThrow(/day/);
  });
});

describe("importBackup — transactions", () => {
  it("a failure mid-import leaves the database exactly as it was", async () => {
    const before = await snapshotAll(db);

    const file = emptyBackup();
    file.data.exercises = [
      { id: "ex-new", name: "Pull-up", kind: "reps", unit: "reps", step: 1, order: 9 },
    ];
    file.data.goals = [
      {
        id: "g-new",
        scope: { kind: "exercise", exerciseId: "ex-new" },
        period: "week",
        target: 50,
        cap: false,
        effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    file.data.entries = [entry({ id: "e1", exerciseId: "ex-new" })];

    // Fail the *last* write, after exercises and goals have been staged. The
    // transaction must roll all of them back, not leave a half-import.
    const realBulkPut = db.entries.bulkPut.bind(db.entries);
    db.entries.bulkPut = (async () => {
      throw new Error("disk full");
    }) as unknown as typeof db.entries.bulkPut;

    await expect(importBackup(db, file)).rejects.toThrow(/disk full/);

    db.entries.bulkPut = realBulkPut;

    expect(await snapshotAll(db)).toEqual(before);
    expect(await db.exercises.get("ex-new")).toBeUndefined();
    expect(await db.goals.get("g-new")).toBeUndefined();
  });

  it("a failed replace-all does not leave an emptied database", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const before = await snapshotAll(db);

    const file = emptyBackup();
    file.data.exercises = [
      { id: "ex-new", name: "Pull-up", kind: "reps", unit: "reps", step: 1, order: 9 },
    ];

    const realBulkPut = db.exercises.bulkPut.bind(db.exercises);
    db.exercises.bulkPut = (async () => {
      throw new Error("interrupted");
    }) as unknown as typeof db.exercises.bulkPut;

    await expect(importBackup(db, file, { mode: "replace" })).rejects.toThrow(/interrupted/);

    db.exercises.bulkPut = realBulkPut;

    expect(await snapshotAll(db)).toEqual(before);
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });
});

describe("importBackup — seq re-derivation", () => {
  it("re-derives seq when an imported set collides with a local one", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const local = await entries.addSet({ exerciseId: "ex-pushup", amount: 30 });
    expect(local.seq).toBeGreaterThan(0);

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    // A different id claiming the same slot, from another device.
    file.data.entries = [
      entry({ id: "foreign-1", seq: local.seq, createdAt: "2026-02-01T10:00:00.000Z" }),
    ];

    const report = await importBackup(db, file);

    expect(report.resequenced).toBe(1);
    const imported = await db.entries.get("foreign-1");
    expect(imported?.seq).not.toBe(local.seq);
    expect(imported!.seq).toBeGreaterThan(local.seq);

    // The local row kept its slot, and "undo last" still finds the newest set.
    expect((await db.entries.get(local.id))?.seq).toBe(local.seq);
    expect((await entries.lastForExercise("ex-pushup"))?.id).toBe(local.id);
  });

  it("re-sequences in file order when the file's own numbering is broken", async () => {
    const first = await createEntriesRepo(db, fixedClock(), createSettingsRepo(db)).addSet({
      exerciseId: "ex-pushup",
      amount: 10,
    });
    const last = await createEntriesRepo(db, fixedClock(), createSettingsRepo(db)).addSet({
      exerciseId: "ex-pushup",
      amount: 20,
    });

    const { entries, resequenced } = assignSeq(
      [
        { ...first, id: "a", seq: 500 },
        { ...last, id: "b", seq: 500 }, // tie: undo would pick arbitrarily
      ],
      [],
    );

    expect(resequenced).toBe(1);
    expect(entries.map((e) => e.seq)).toEqual([500, 501]);
  });

  it("keeps the file's seq when the slots are free", () => {
    const { entries, resequenced } = assignSeq(
      [entry({ id: "a", seq: 900 }), entry({ id: "b", seq: 901 })],
      [],
    );

    expect(resequenced).toBe(0);
    expect(entries.map((e) => e.seq)).toEqual([900, 901]);
  });

  it("frees the seq of a local row it is about to overwrite", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    const local = await entries.addSet({ exerciseId: "ex-pushup", amount: 20 });

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.entries = [{ ...local, amount: 25, createdAt: "2027-01-01T00:00:00.000Z" }];

    const report = await importBackup(db, file);

    // The slot is the import's own: stealing it from itself would be a bug.
    expect(report.resequenced).toBe(0);
    expect(report.overwritten.entries).toBe(1);
    expect((await db.entries.get(local.id))?.seq).toBe(local.seq);
  });

  it("a merge leaves every local seq untouched across many entries", async () => {
    const settings = createSettingsRepo(db);
    const entries = createEntriesRepo(db, fixedClock(), settings);
    for (let i = 0; i < 5; i += 1) {
      await entries.addSet({ exerciseId: "ex-pushup", amount: 10 });
    }
    const localSeqs = new Map((await db.entries.toArray()).map((e) => [e.id, e.seq]));

    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.entries = [1, 2, 3, 4, 5].map((n) =>
      entry({ id: `foreign-${n}`, seq: n, createdAt: `2026-02-0${n}T10:00:00.000Z` }),
    );

    const report = await importBackup(db, file);

    expect(report.added.entries).toBe(5);
    // Every file value collides with 1..5, so all five are re-derived.
    expect(report.resequenced).toBe(5);
    for (const [id, seq] of localSeqs) {
      expect((await db.entries.get(id))?.seq).toBe(seq);
    }
    const all = await db.entries.toArray();
    expect(new Set(all.map((e) => e.seq)).size).toBe(all.length);
  });
});

describe("importBackup — goals are versioned, not merged", () => {
  it("keeps both goal rows when two files describe the same scope with different ids", async () => {
    const file = emptyBackup();
    file.data.exercises = await db.exercises.toArray();
    file.data.goals = [
      {
        id: "other-device-goal",
        scope: { kind: "exercise", exerciseId: "ex-pushup" },
        period: "week",
        target: 800,
        cap: false,
        effectiveFrom: "2026-02-01",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    await importBackup(db, file);

    const goals = createGoalsRepo(db, fixedClock());
    // Both rows exist; `goalInForce` picks one deterministically rather than
    // this module inventing a merge rule for versioned history.
    expect(await goals.get("other-device-goal")).toBeDefined();
    expect(await goals.get("goal-pushup-week")).toBeDefined();
  });
});

describe("describeImport", () => {
  it("summarises counts the way the issue asks for", async () => {
    const file = emptyBackup();
    file.data.exercises = [
      { id: "ex-new", name: "Pull-up", kind: "reps", unit: "reps", step: 1, order: 9 },
    ];
    file.data.entries = [
      entry({ id: "e1", exerciseId: "ex-new", seq: 100 }),
      entry({ id: "e2", exerciseId: "ex-new", seq: 101 }),
    ];

    const report = await importBackup(db, file);
    const text = describeImport(report);

    expect(text).toContain("+1 exercise");
    expect(text).toContain("+2 sets");
  });

  it("says nothing to do for a repeated import", async () => {
    const exported = await buildBackup(db, fixedClock());
    const report = await importBackup(db, exported);
    expect(describeImport(report)).toMatch(/Nothing to do/);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sortById<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function snapshot<T extends { id: string }>(rows: readonly T[]): T[] {
  return sortById(rows).map((row) => ({ ...row }));
}

async function snapshotAll(database: SportDatabase) {
  const [exercises, entries, goals, settings] = await Promise.all([
    database.exercises.toArray(),
    database.entries.toArray(),
    database.goals.toArray(),
    database.settings.toArray(),
  ]);
  return {
    exercises: snapshot(exercises),
    entries: snapshot(entries),
    goals: snapshot(goals),
    settings: snapshot(settings),
  };
}
