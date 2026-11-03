/**
 * Exercise management: add, rename, reorder, archive (issue #17).
 *
 * Until now the shape of the exercise list was only editable by changing
 * `seed.ts`. This is the UI half of what the repositories already do.
 *
 * Two rules are non-negotiable and enforced here rather than by convention:
 *
 * 1. **There is no delete.** Archiving is a soft delete (`archivedAt`), because
 *    entries reference exercises by id: a hard delete would orphan history and
 *    silently change past periods. The UI never offers the button.
 * 2. **A new exercise has no goal.** It appears as "no goal" / "—" rather than
 *    `0 %` or `NaN`, and creating one never invents a target the user did not
 *    ask for.
 *
 * Reordering uses up/down buttons rather than drag: it is a phone-first app, and
 * reordering is a rare action where a 44 px tap target beats a gesture that
 * fights the scroll.
 */

import { useCallback, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import type { Exercise, ExerciseKind } from "../../domain/types.ts";

export interface ExerciseManagerProps {
  ctx: AppContext;
  /** Non-archived exercises, in display order. */
  exercises: readonly Exercise[];
  /** Every exercise including archived ones, so they can be restored. */
  archived: readonly Exercise[];
}

interface Draft {
  name: string;
  kind: ExerciseKind;
}

const EMPTY_DRAFT: Draft = { name: "", kind: "reps" };

export function ExerciseManager({ ctx, exercises, archived }: ExerciseManagerProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const run = useCallback(
    async (action: () => Promise<string | undefined>) => {
      setError(undefined);
      setNotice(undefined);
      try {
        const message = await action();
        setNotice(message);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [],
  );

  const add = useCallback(() => {
    const name = draft.name.trim();
    if (name.length === 0) {
      setError("Give the exercise a name.");
      return;
    }
    if (name.length > 40) {
      setError("Keep the name under 40 characters — it has to fit on one row.");
      return;
    }

    void run(async () => {
      await ctx.exercises.create({
        name,
        kind: draft.kind,
        // A duration exercise is measured in seconds; a rep exercise in reps.
        unit: draft.kind === "duration" ? "s" : "reps",
        step: draft.kind === "duration" ? 30 : 10,
        order: await ctx.exercises.nextOrder(),
      });
      setDraft(EMPTY_DRAFT);
      // Deliberately no goal: a target is a decision the user makes on the row
      // above, not something to guess at creation time.
      return `Added ${name}. Set a target for it above when you want one.`;
    });
  }, [ctx, draft, run]);

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = exercises.findIndex((exercise) => exercise.id === id);
      if (index === -1) return;
      void run(async () => {
        await ctx.exercises.move(id, index + direction);
        return undefined;
      });
    },
    [ctx, exercises, run],
  );

  const archive = useCallback(
    (exercise: Exercise) => {
      void run(async () => {
        await ctx.exercises.archive(exercise.id);
        // Say what survives, because "archive" could reasonably be read as
        // "delete" by anyone who has used an app that does that.
        return `Archived ${exercise.name}. Its history is kept and still counts towards your periods.`;
      });
    },
    [ctx, run],
  );

  const unarchive = useCallback(
    (exercise: Exercise) => {
      void run(async () => {
        await ctx.exercises.unarchive(exercise.id);
        return `${exercise.name} is back on Today.`;
      });
    },
    [ctx, run],
  );

  return (
    <section class="exercise-manager" aria-labelledby="exercises-heading">
      <h2 class="section-title" id="exercises-heading">
        Exercises
      </h2>
      <p class="muted">
        Archiving hides an exercise from Today and Progress but keeps everything you have already
        logged. Nothing is ever deleted.
      </p>

      <ul class="exercise-list-manage" data-testid="exercise-manager-list">
        {exercises.map((exercise, index) => (
          <li key={exercise.id} class="exercise-manage-row" data-testid={`manage-${exercise.id}`}>
            <span class="exercise-manage-row__name">{exercise.name}</span>
            <span class="muted exercise-manage-row__unit">
              {exercise.kind === "duration" ? "seconds" : "reps"}
            </span>
            <div class="exercise-manage-row__actions">
              <button
                type="button"
                class="btn btn--icon"
                aria-label={`Move ${exercise.name} up`}
                data-testid={`move-up-${exercise.id}`}
                disabled={index === 0}
                onClick={() => move(exercise.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                class="btn btn--icon"
                aria-label={`Move ${exercise.name} down`}
                data-testid={`move-down-${exercise.id}`}
                disabled={index === exercises.length - 1}
                onClick={() => move(exercise.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                class="btn btn--undo"
                data-testid={`archive-${exercise.id}`}
                onClick={() => archive(exercise)}
              >
                Archive
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ul class="target-list" data-testid="add-exercise">
        <li class="target-row">
          <label class="target-row__label" for="new-exercise-name">
            Add an exercise
          </label>
          <div class="target-row__controls">
            <input
              id="new-exercise-name"
              data-testid="new-exercise-name"
              class="target-row__input"
              type="text"
              autocomplete="off"
              placeholder="Pull-up"
              value={draft.name}
              onInput={(event) => {
                const name = (event.currentTarget as HTMLInputElement).value;
                setDraft((prev) => ({ ...prev, name }));
                setNotice(undefined);
              }}
            />
            <select
              class="target-row__input target-row__input--small"
              data-testid="new-exercise-kind"
              aria-label="Measured in"
              value={draft.kind}
              onChange={(event) => {
                const kind = (event.currentTarget as HTMLSelectElement).value as ExerciseKind;
                setDraft((prev) => ({ ...prev, kind }));
              }}
            >
              <option value="reps">reps</option>
              <option value="duration">seconds</option>
            </select>
            <button type="button" class="btn btn--add" data-testid="add-exercise-save" onClick={add}>
              Add
            </button>
          </div>
          <p class="muted target-row__current">
            {draft.kind === "duration"
              ? "Quick-add buttons start at 30 s. No target until you set one."
              : "Quick-add buttons start at +10. No target until you set one."}
          </p>
        </li>
      </ul>

      {archived.length === 0 ? null : (
        <>
          <h2 class="section-title">Archived</h2>
          <ul class="exercise-list-manage" data-testid="archived-list">
            {archived.map((exercise) => (
              <li key={exercise.id} class="exercise-manage-row" data-testid={`archived-${exercise.id}`}>
                <span class="exercise-manage-row__name">{exercise.name}</span>
                <span class="muted exercise-manage-row__unit">history kept</span>
                <div class="exercise-manage-row__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid={`unarchive-${exercise.id}`}
                    onClick={() => unarchive(exercise)}
                  >
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {error === undefined ? null : (
        <p class="error" role="alert" data-testid="exercise-error">
          {error}
        </p>
      )}
      {notice === undefined ? null : (
        <p class="saved" role="status" data-testid="exercise-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
