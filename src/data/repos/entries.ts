/**
 * Entry repository.
 *
 * The important rule (docs/architecture.md §2.2): `day` is computed **here**, on
 * write, from the injected clock and the user's cutoff hour — never by the
 * caller and never derived from a UTC instant at read time. That is what keeps
 * an 00:30 session on the correct local day.
 *
 * One row per set, never a per-day bucket: corrections are "add a row" or
 * "delete a row", so there is no read-modify-write on a daily total.
 */

import Dexie from "dexie";
import type { SportDatabase } from "../db.ts";
import type { Clock, Now } from "../clock.ts";
import type { Entry, IsoDate, PeriodRange } from "../../domain/types.ts";
import { resolveDay } from "../../domain/period.ts";
import type { SettingsRepo } from "./settings.ts";

export interface AddSetInput {
  exerciseId: string;
  amount: number;
  note?: string;
  /** Override the clock, for tests and for backfilling. */
  at?: { day: IsoDate; hour: number };
}

export interface EntryRepo {
  addSet(input: AddSetInput): Promise<Entry>;
  remove(id: string): Promise<void>;
  forDay(day: IsoDate): Promise<Entry[]>;
  forDayAndExercise(day: IsoDate, exerciseId: string): Promise<Entry[]>;
  /** All entries in a half-open range, ordered by day. */
  inRange(range: PeriodRange): Promise<Entry[]>;
  /** The most recent set for an exercise — the target of "undo last". */
  lastForExercise(exerciseId: string): Promise<Entry | undefined>;
  all(): Promise<Entry[]>;
  count(): Promise<number>;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createEntriesRepo(db: SportDatabase, clock: Clock, settings: SettingsRepo): EntryRepo {
  async function now(): Promise<Now> {
    return clock.now();
  }

  /**
   * Next insertion sequence. Derived from stored data rather than memory, so it
   * stays monotonic across reloads and tabs.
   */
  async function nextSeq(): Promise<number> {
    const last = await db.entries.orderBy("seq").last();
    return (last?.seq ?? 0) + 1;
  }

  return {
    async addSet(input) {
      const current = await now();
      const settingsRow = await settings.get();

      const logged = input.at ?? { day: current.day, hour: current.hour };
      const day = resolveDay(logged, settingsRow.dayCutoffHour);

      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new RangeError(`Entry amount must be a positive number, got ${input.amount}`);
      }

      const entry: Entry = {
        id: newId(),
        exerciseId: input.exerciseId,
        day,
        amount: input.amount,
        createdAt: current.instant,
        seq: await nextSeq(),
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      await db.entries.add(entry);
      return entry;
    },

    async remove(id) {
      await db.entries.delete(id);
    },

    async forDay(day) {
      // Uses the [day+exerciseId] compound index. Dexie's own sentinels are the
      // only valid bounds here: `maxKey` is "\uffff", not Infinity.
      return db.entries
        .where("[day+exerciseId]")
        .between([day, Dexie.minKey], [day, Dexie.maxKey])
        .toArray();
    },

    async forDayAndExercise(day, exerciseId) {
      // Uses the [exerciseId+day] compound index.
      return db.entries.where("[exerciseId+day]").equals([exerciseId, day]).toArray();
    },

    async inRange(range) {
      return db.entries.where("day").between(range.start, range.end, true, false).toArray();
    },

    async lastForExercise(exerciseId) {
      const rows = await db.entries.where("exerciseId").equals(exerciseId).toArray();
      if (rows.length === 0) return undefined;
      // `seq` breaks the tie when two sets share a millisecond, which is common
      // for fast tapping and would otherwise make undo delete an arbitrary row.
      return rows.reduce((latest, row) => (row.seq > latest.seq ? row : latest));
    },

    all() {
      return db.entries.orderBy("day").toArray();
    },

    count() {
      return db.entries.count();
    },
  };
}
