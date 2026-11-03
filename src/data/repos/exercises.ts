/**
 * Exercise repository.
 *
 * Archiving is a soft delete: `archivedAt` is set and the row survives, because
 * entries referencing it must keep resolving to a name and a unit.
 */

import type { SportDatabase } from "../db.ts";
import type { Clock } from "../clock.ts";
import type { Exercise, ExerciseKind } from "../../domain/types.ts";

export interface NewExercise {
  name: string;
  kind: ExerciseKind;
  unit: string;
  step: number;
  order: number;
}

export interface ExerciseRepo {
  create(input: NewExercise): Promise<Exercise>;
  get(id: string): Promise<Exercise | undefined>;
  /** Non-archived exercises, in display order. */
  list(): Promise<Exercise[]>;
  /** Every exercise, archived included. */
  all(): Promise<Exercise[]>;
  update(id: string, patch: Partial<NewExercise>): Promise<Exercise>;
  /** The next free `order`, so a new exercise lands at the end of the list. */
  nextOrder(): Promise<number>;
  /**
   * Move one exercise to `toIndex` in the display order (0-based, among
   * non-archived exercises).
   *
   * Rewrites `order` for every listed exercise inside one transaction: a
   * half-applied move would leave two exercises sharing a slot, and `orderBy`
   * would then depend on the primary key.
   */
  move(id: string, toIndex: number): Promise<Exercise[]>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createExercisesRepo(db: SportDatabase, clock: Clock): ExerciseRepo {
  return {
    async create(input) {
      const exercise: Exercise = {
        id: newId(),
        name: input.name,
        kind: input.kind,
        unit: input.unit,
        step: input.step,
        order: input.order,
      };
      await db.exercises.add(exercise);
      return exercise;
    },

    get(id) {
      return db.exercises.get(id);
    },

    async list() {
      const rows = await db.exercises.orderBy("order").toArray();
      return rows.filter((e) => e.archivedAt === undefined);
    },

    all() {
      return db.exercises.orderBy("order").toArray();
    },

    async update(id, patch) {
      const existing = await db.exercises.get(id);
      if (existing === undefined) {
        throw new Error(`Exercise not found: ${id}`);
      }
      const next: Exercise = { ...existing, ...patch, id };
      await db.exercises.put(next);
      return next;
    },

    async nextOrder() {
      const rows = await db.exercises.toArray();
      return rows.reduce((max, row) => (row.order > max ? row.order : max), 0) + 1;
    },

    async move(id, toIndex) {
      // Only non-archived rows are ordered: an archived exercise keeps whatever
      // `order` it had, so unarchiving puts it back where it was.
      const visible = (await db.exercises.orderBy("order").toArray()).filter(
        (exercise) => exercise.archivedAt === undefined,
      );

      const from = visible.findIndex((exercise) => exercise.id === id);
      if (from === -1) {
        throw new Error(`Exercise not found or archived: ${id}`);
      }
      const to = Math.max(0, Math.min(visible.length - 1, Math.trunc(toIndex)));
      if (from === to) return visible;

      const reordered = [...visible];
      const [moved] = reordered.splice(from, 1);
      if (moved === undefined) return visible;
      reordered.splice(to, 0, moved);

      const updated = reordered.map((exercise, index) => ({ ...exercise, order: index + 1 }));

      await db.transaction("rw", db.exercises, async () => {
        await db.exercises.bulkPut(updated);
      });

      return updated;
    },

    async archive(id) {
      const existing = await db.exercises.get(id);
      if (existing === undefined) return;
      await db.exercises.put({ ...existing, archivedAt: clock.now().instant });
    },

    async unarchive(id) {
      const existing = await db.exercises.get(id);
      if (existing === undefined) return;
      const { archivedAt: _dropped, ...rest } = existing;
      await db.exercises.put(rest);
    },
  };
}
