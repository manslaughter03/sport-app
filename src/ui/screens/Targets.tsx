/**
 * Targets editor (S8).
 *
 * Changing a target never mutates a goal row: it calls `retarget`, which splits
 * the row through the domain's `splitGoal`. The old row is closed at today and
 * a new one opens at today, so past periods keep the targets that applied then
 * (docs/architecture.md §2.2).
 *
 * This is the reason goal versioning exists, so v0 exercises it for real.
 */

import { useCallback, useMemo, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { formatAmountCompact } from "../../domain/format.ts";
import type { Exercise, Goal, IsoDate } from "../../domain/types.ts";

export interface TargetsProps {
  ctx: AppContext;
}

interface TargetsData {
  exercises: Exercise[];
  goals: Goal[];
  today: IsoDate;
}

type Slot = string; // exerciseId, or "activeDays"

function parseTarget(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function unitLabel(exercise: Exercise): string {
  return exercise.kind === "duration" ? "seconds / week" : "reps / week";
}

export function Targets({ ctx }: TargetsProps) {
  const { data, error } = useLiveQuery<TargetsData>(
    async () => {
      const now = ctx.clock.now();
      const [exercises, goals] = await Promise.all([ctx.exercises.list(), ctx.goals.all()]);
      return { exercises, goals, today: now.day };
    },
    [ctx],
  );

  const [draft, setDraft] = useState<Record<Slot, string>>({});
  const [errors, setErrors] = useState<Record<Slot, string>>({});
  const [saved, setSaved] = useState<Record<Slot, boolean>>({});

  // Quick-add step, kept in separate maps so its messages never collide with a
  // target's: the two live on the same row but are different kinds of edit.
  const [stepDraft, setStepDraft] = useState<Record<Slot, string>>({});
  const [stepErrors, setStepErrors] = useState<Record<Slot, string>>({});
  const [stepSaved, setStepSaved] = useState<Record<Slot, boolean>>({});

  const current = useMemo(() => {
    if (data === undefined) return new Map<Slot, Goal>();
    const map = new Map<Slot, Goal>();
    for (const goal of data.goals) {
      if (goal.period !== "week") continue;
      if (goal.effectiveFrom > data.today) continue;
      if (goal.effectiveTo !== undefined && data.today >= goal.effectiveTo) continue;
      const slot = goal.scope.kind === "activeDays" ? "activeDays" : goal.scope.exerciseId;
      const existing = map.get(slot);
      if (existing === undefined || goal.effectiveFrom > existing.effectiveFrom) {
        map.set(slot, goal);
      }
    }
    return map;
  }, [data]);

  const save = useCallback(
    async (slot: Slot, goal: Goal | undefined, raw: string, today: IsoDate) => {
      const value = parseTarget(raw);
      if (value === undefined) {
        setErrors((prev) => ({ ...prev, [slot]: "Enter a whole number greater than zero." }));
        setSaved((prev) => ({ ...prev, [slot]: false }));
        return;
      }
      if (goal === undefined) {
        setErrors((prev) => ({ ...prev, [slot]: "No goal in force to update." }));
        return;
      }
      if (goal.target === value) {
        // Nothing to version: writing a split row for an unchanged target would
        // pollute the history for free.
        setErrors((prev) => ({ ...prev, [slot]: "" }));
        setSaved((prev) => ({ ...prev, [slot]: true }));
        return;
      }

      try {
        await ctx.goals.retarget(goal.id, { atDay: today, newTarget: value });
        setErrors((prev) => ({ ...prev, [slot]: "" }));
        setSaved((prev) => ({ ...prev, [slot]: true }));
      } catch (cause) {
        setErrors((prev) => ({
          ...prev,
          [slot]: cause instanceof Error ? cause.message : String(cause),
        }));
        setSaved((prev) => ({ ...prev, [slot]: false }));
      }
    },
    [ctx],
  );

  /**
   * Changing the quick-add step edits the exercise row, not a goal: a step is a
   * tap-size convenience, so versioning it would create pointless goal rows.
   */
  const saveStep = useCallback(
    async (exerciseId: string, raw: string) => {
      const value = parseTarget(raw);
      if (value === undefined) {
        setStepErrors((prev) => ({ ...prev, [exerciseId]: "Whole number greater than zero." }));
        setStepSaved((prev) => ({ ...prev, [exerciseId]: false }));
        return;
      }
      try {
        await ctx.exercises.update(exerciseId, { step: value });
        setStepErrors((prev) => ({ ...prev, [exerciseId]: "" }));
        setStepSaved((prev) => ({ ...prev, [exerciseId]: true }));
      } catch (cause) {
        setStepErrors((prev) => ({
          ...prev,
          [exerciseId]: cause instanceof Error ? cause.message : String(cause),
        }));
        setStepSaved((prev) => ({ ...prev, [exerciseId]: false }));
      }
    },
    [ctx],
  );

  if (error !== undefined) {
    return (
      <section class="targets">
        <h1>Targets</h1>
        <p class="error" role="alert">
          Could not load your goals: {error.message}
        </p>
      </section>
    );
  }

  if (data === undefined) {
    return (
      <section class="targets">
        <h1>Targets</h1>
        <p class="muted">Loading…</p>
      </section>
    );
  }

  const rows: Array<{ slot: Slot; label: string; unit: string; goal: Goal | undefined }> = [
    ...data.exercises.map((exercise) => ({
      slot: exercise.id as Slot,
      label: exercise.name,
      unit: unitLabel(exercise),
      goal: current.get(exercise.id),
    })),
    {
      slot: "activeDays" as Slot,
      label: "Active days",
      unit: "days / week",
      goal: current.get("activeDays"),
    },
  ];

  return (
    <section class="targets">
      <h1>Targets</h1>
      <p class="muted">
        Changing a target applies from today. Past weeks keep the target they were measured against.
      </p>

      <ul class="target-list">
        {rows.map(({ slot, label, unit, goal }) => {
          const value = draft[slot] ?? (goal === undefined ? "" : String(goal.target));
          const message = errors[slot];
          return (
            <li key={slot} class="target-row" data-testid={`target-row-${slot}`}>
              <label class="target-row__label" for={`target-input-${slot}`}>
                {label}
              </label>
              <div class="target-row__controls">
                <input
                  id={`target-input-${slot}`}
                  data-testid={`target-input-${slot}`}
                  class="target-row__input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  value={value}
                  onInput={(event) => {
                    const next = (event.currentTarget as HTMLInputElement).value;
                    setDraft((prev) => ({ ...prev, [slot]: next }));
                    setSaved((prev) => ({ ...prev, [slot]: false }));
                  }}
                />
                <span class="muted" data-testid={`unit-${slot}`}>
                  {unit}
                </span>
                <button
                  type="button"
                  class="btn btn--add"
                  data-testid={`save-${slot}`}
                  onClick={() => {
                    void save(slot, goal, value, data.today);
                  }}
                >
                  Save
                </button>
              </div>

              {goal === undefined ? null : (
                <p class="muted target-row__current">
                  Now: {formatAmountCompact(goal.target, slot === "activeDays" ? "reps" : kindOf(data.exercises, slot))}
                </p>
              )}

              {kindOfOptional(data.exercises, slot) === "reps" ? (
                <div class="target-row__step">
                  <label class="muted" for={`step-input-${slot}`}>
                    Quick-add buttons
                  </label>
                  <div class="target-row__controls">
                    <input
                      id={`step-input-${slot}`}
                      data-testid={`step-input-${slot}`}
                      class="target-row__input target-row__input--small"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      value={stepDraft[slot] ?? String(stepOf(data.exercises, slot))}
                      onInput={(event) => {
                        const next = (event.currentTarget as HTMLInputElement).value;
                        setStepDraft((prev) => ({ ...prev, [slot]: next }));
                        setStepSaved((prev) => ({ ...prev, [slot]: false }));
                      }}
                    />
                    <span class="muted" data-testid={`step-preview-${slot}`}>
                      {(() => {
                        const parsed = parseTarget(stepDraft[slot] ?? String(stepOf(data.exercises, slot)));
                        return parsed === undefined ? "" : `+${parsed} / +${parsed * 2}`;
                      })()}
                    </span>
                    <button
                      type="button"
                      class="btn btn--add"
                      data-testid={`save-step-${slot}`}
                      onClick={() => {
                        void saveStep(slot, stepDraft[slot] ?? String(stepOf(data.exercises, slot)));
                      }}
                    >
                      Save
                    </button>
                  </div>
                  {stepErrors[slot] === undefined || stepErrors[slot] === "" ? null : (
                    <p class="error" role="alert" data-testid={`step-error-${slot}`}>
                      {stepErrors[slot]}
                    </p>
                  )}
                  {stepSaved[slot] === true ? (
                    <p class="saved" data-testid={`step-saved-${slot}`}>
                      Saved
                    </p>
                  ) : null}
                </div>
              ) : null}

              {message === undefined || message === "" ? null : (
                <p class="error" role="alert" data-testid={`error-${slot}`}>
                  {message}
                </p>
              )}

              {saved[slot] === true ? (
                <p class="saved" data-testid={`saved-${slot}`}>
                  Saved
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function kindOf(exercises: readonly Exercise[], exerciseId: string): "reps" | "duration" {
  return exercises.find((e) => e.id === exerciseId)?.kind ?? "reps";
}

/** Like `kindOf`, but undefined for slots that are not exercises (active days). */
function kindOfOptional(
  exercises: readonly Exercise[],
  slot: string,
): "reps" | "duration" | undefined {
  return exercises.find((e) => e.id === slot)?.kind;
}

function stepOf(exercises: readonly Exercise[], exerciseId: string): number {
  return exercises.find((e) => e.id === exerciseId)?.step ?? 5;
}
