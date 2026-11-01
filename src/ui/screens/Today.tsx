/**
 * Today — the screen you actually open (S6).
 *
 * Reads through `liveQuery`, so logging a set updates the total and the weekly
 * ring with no manual refresh. All time comes from the injected clock; nothing
 * here reads `Date`.
 */

import { useCallback, useMemo } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { QuickAdd } from "../components/QuickAdd.tsx";
import { ProgressRing } from "../components/ProgressRing.tsx";
import { evaluate } from "../../domain/progress.ts";
import { weekRange } from "../../domain/period.ts";
import type { Entry, Exercise, Goal, IsoDate } from "../../domain/types.ts";

export interface TodayProps {
  ctx: AppContext;
}

interface TodayData {
  exercises: Exercise[];
  entries: Entry[];
  goals: Goal[];
  week: { start: IsoDate; end: IsoDate };
  today: IsoDate;
}

export function Today({ ctx }: TodayProps) {
  const { data, error } = useLiveQuery<TodayData>(
    async () => {
      const settings = await ctx.settings.get();
      const now = ctx.clock.now();
      const week = weekRange(now.day, settings.weekStartsOn);
      const [exercises, entries, goals] = await Promise.all([
        ctx.exercises.list(),
        ctx.entries.inRange(week),
        ctx.goals.all(),
      ]);
      return { exercises, entries, goals, week, today: now.day };
    },
    [ctx],
  );

  const handleAdd = useCallback(
    async (exerciseId: string, amount: number) => {
      await ctx.entries.addSet({ exerciseId, amount });
    },
    [ctx],
  );

  const handleUndo = useCallback(
    async (exerciseId: string) => {
      const last = await ctx.entries.lastForExercise(exerciseId);
      if (last !== undefined) await ctx.entries.remove(last.id);
    },
    [ctx],
  );

  const report = useMemo(() => {
    if (data === undefined) return undefined;
    return evaluate(data.week, data.entries, data.exercises, data.goals, DEFAULT_SETTINGS, data.today);
  }, [data]);

  if (error !== undefined) {
    return (
      <section class="today">
        <h1>Sport</h1>
        <p class="error" role="alert">
          Could not load your data: {error.message}
        </p>
      </section>
    );
  }

  if (data === undefined) {
    return (
      <section class="today">
        <h1>Sport</h1>
        <p class="muted">Loading…</p>
      </section>
    );
  }

  const todayTotals = totalsForDay(data.entries, data.today);

  return (
    <section class="today">
      <header class="today__head">
        <h1>Today</h1>
        <span class="muted" data-testid="day-position">
          day {report?.elapsedDays ?? 1} of {report?.totalDays ?? 7}
        </span>
      </header>

      {data.exercises.length === 0 ? (
        <p class="muted">No exercises yet.</p>
      ) : (
        <ul class="exercise-list">
          {data.exercises.map((exercise) => {
            const row = report?.exercises.find((r) => r.exerciseId === exercise.id);
            const total = todayTotals.get(exercise.id) ?? 0;
            return (
              <div key={exercise.id} class="exercise-row">
                <ProgressRing
                  exerciseId={exercise.id}
                  volumePct={row?.volumePct ?? null}
                  pace={row?.pace ?? "untargeted"}
                  label={`${exercise.name} weekly progress`}
                />
                <QuickAdd
                  exercise={exercise}
                  todayTotal={total}
                  canUndo={total > 0}
                  onAdd={(amount) => {
                    void handleAdd(exercise.id, amount);
                  }}
                  onUndo={() => {
                    void handleUndo(exercise.id);
                  }}
                />
              </div>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Settings the engine needs that do not affect a volume calculation. */
const DEFAULT_SETTINGS = {
  weekStartsOn: 1 as const,
  dayCutoffHour: 0,
  activeDayMinAmount: 1,
  schemaVersion: 1,
};

function totalsForDay(entries: readonly Entry[], today: IsoDate): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.day !== today) continue;
    totals.set(entry.exerciseId, (totals.get(entry.exerciseId) ?? 0) + entry.amount);
  }
  return totals;
}
