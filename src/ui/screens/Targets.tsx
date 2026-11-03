/**
 * Targets editor (S8) and the settings that change what a "week" means (#16).
 *
 * Changing a target never mutates a goal row: it calls `retarget`, which splits
 * the row through the domain's `splitGoal`. The old row is closed at today and
 * a new one opens at today, so past periods keep the targets that applied then
 * (docs/architecture.md §2.2).
 *
 * This is the reason goal versioning exists, so v0 exercises it for real.
 *
 * The settings section is deliberately here rather than on its own screen: all
 * three change what the numbers above them mean, and each one carries a
 * different retroactivity — stated in the UI, because two of the three silently
 * rewrite history and the third silently does not.
 */

import { useCallback, useMemo, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { formatAmountCompact } from "../../domain/format.ts";
import type { Exercise, Goal, IsoDate, Settings, WeekStartsOn } from "../../domain/types.ts";

export interface TargetsProps {
  ctx: AppContext;
}

interface TargetsData {
  exercises: Exercise[];
  goals: Goal[];
  settings: Settings;
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
      const settingsRow = await ctx.settings.get();
      const [exercises, goals] = await Promise.all([ctx.exercises.list(), ctx.goals.all()]);
      return { exercises, goals, settings: settingsRow, today: now.day };
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

  // Settings have their own draft map: the cutoff and the active-day minimum are
  // numeric text fields like targets, but they are a different kind of edit.
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string | undefined>(undefined);
  const [settingsSaved, setSettingsSaved] = useState(false);

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

  /**
   * One handler for all three settings.
   *
   * These are plain row edits, not versioned goals: `Settings` is evaluated at
   * read time, so a change takes effect for every period the screens compute
   * from now on. That is exactly why the UI has to spell out the difference
   * between "re-buckets your history" and "only affects future writes".
   */
  const saveSettings = useCallback(
    async (patch: Partial<Pick<Settings, "weekStartsOn" | "dayCutoffHour" | "activeDayMinAmount">>) => {
      try {
        await ctx.settings.update(patch);
        setSettingsError(undefined);
        setSettingsSaved(true);
      } catch (cause) {
        setSettingsSaved(false);
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
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

      <h2 class="section-title" id="settings-heading">
        Settings
      </h2>
      <p class="muted">
        These change what the numbers above mean. Each says whether it reaches back into the past.
      </p>

      <ul class="target-list" aria-labelledby="settings-heading">
        <li class="target-row" data-testid="setting-week-start">
          <span class="target-row__label">Week starts on</span>
          <div class="period-switcher" role="group" aria-label="Week starts on">
            {([
              [1, "Monday"],
              [7, "Sunday"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                class="chip"
                data-testid={`week-start-${label.toLowerCase()}`}
                aria-pressed={data.settings.weekStartsOn === value}
                onClick={() => {
                  void saveSettings({ weekStartsOn: value as WeekStartsOn });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p class="muted target-row__current" data-testid="week-start-note">
            Re-buckets past weeks too: every percentage on Progress is recomputed against the new
            boundary. Weeks you already logged will appear to move.
          </p>
        </li>

        <li class="target-row" data-testid="setting-cutoff">
          <label class="target-row__label" for="setting-cutoff-input">
            Day cutoff (hour)
          </label>
          <div class="target-row__controls">
            <input
              id="setting-cutoff-input"
              data-testid="cutoff-input"
              class="target-row__input target-row__input--small"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={settingsDraft["cutoff"] ?? String(data.settings.dayCutoffHour)}
              onInput={(event) => {
                const next = (event.currentTarget as HTMLInputElement).value;
                setSettingsDraft((prev) => ({ ...prev, cutoff: next }));
                setSettingsSaved(false);
              }}
            />
            <span class="muted" data-testid="cutoff-preview">
              {describeCutoff(
                Number(settingsDraft["cutoff"] ?? data.settings.dayCutoffHour),
              )}
            </span>
            <button
              type="button"
              class="btn btn--add"
              data-testid="cutoff-save"
              onClick={() => {
                const raw = settingsDraft["cutoff"] ?? String(data.settings.dayCutoffHour);
                const value = parseCutoff(raw);
                if (value === undefined) {
                  setSettingsSaved(false);
                  setSettingsError("Cutoff must be a whole number of hours, 0 to 23.");
                  return;
                }
                void saveSettings({ dayCutoffHour: value });
              }}
            >
              Save
            </button>
          </div>
          <p class="muted target-row__current" data-testid="cutoff-note">
            Only affects sets you log from now on. Each set keeps the day it was given when it was
            recorded, so history is never rewritten.
          </p>
        </li>

        <li class="target-row" data-testid="setting-active-min">
          <label class="target-row__label" for="setting-active-min-input">
            Active-day minimum
          </label>
          <div class="target-row__controls">
            <input
              id="setting-active-min-input"
              data-testid="active-min-input"
              class="target-row__input target-row__input--small"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={settingsDraft["activeMin"] ?? String(data.settings.activeDayMinAmount)}
              onInput={(event) => {
                const next = (event.currentTarget as HTMLInputElement).value;
                setSettingsDraft((prev) => ({ ...prev, activeMin: next }));
                setSettingsSaved(false);
              }}
            />
            <span class="muted" data-testid="active-min-preview">
              {describeActiveMin(
                Number(settingsDraft["activeMin"] ?? data.settings.activeDayMinAmount),
              )}
            </span>
            <button
              type="button"
              class="btn btn--add"
              data-testid="active-min-save"
              onClick={() => {
                const raw =
                  settingsDraft["activeMin"] ?? String(data.settings.activeDayMinAmount);
                const value = parseTarget(raw);
                if (value === undefined) {
                  setSettingsSaved(false);
                  setSettingsError("The active-day minimum must be a whole number above zero.");
                  return;
                }
                void saveSettings({ activeDayMinAmount: value });
              }}
            >
              Save
            </button>
          </div>
          <p class="muted target-row__current" data-testid="active-min-note">
            A day counts as active when one exercise reaches this total that day — not the day's
            sum across exercises. Applies to past periods as well, so regularity is recomputed.
          </p>
        </li>
      </ul>

      {settingsError === undefined ? null : (
        <p class="error" role="alert" data-testid="settings-error">
          {settingsError}
        </p>
      )}
      {settingsSaved ? (
        <p class="saved" role="status" data-testid="settings-saved">
          Settings saved
        </p>
      ) : null}
    </section>
  );
}

/** A cutoff of 0..23 hours; 0 means "no cutoff". */
function parseCutoff(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : undefined;
}

/** What the cutoff does, in one clause, with the case that motivates it. */
function describeCutoff(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
  if (hour === 0) return "Midnight — a set always counts for the day it was logged.";
  const past = hour === 1 ? "1 am" : `${hour} am`;
  return `A set logged before ${past} counts for the previous day.`;
}

function describeActiveMin(amount: number): string {
  if (!Number.isInteger(amount) || amount <= 0) return "";
  return `${amount} counts as a day of training.`;
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
