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
