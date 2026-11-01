/**
 * Progress — "did I do the work?" and "did I show up?" on one screen (S7).
 *
 * Reads through `liveQuery`, so logging a set on Today updates this screen too.
 * The `day X of 7` line is deliberate: a 10 % reading on day 3 is not failure,
 * and without the position it reads like one (plan §0, O4).
 */

import { useMemo } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { DayGrid } from "../components/DayGrid.tsx";
import { PeriodSwitcher } from "../components/PeriodSwitcher.tsx";
import { evaluate } from "../../domain/progress.ts";
import { daysIn, weekRange } from "../../domain/period.ts";
import { formatAmountCompact, formatPercentRounded } from "../../domain/format.ts";
import type { Entry, Exercise, Goal, IsoDate, Settings, WeekStartsOn } from "../../domain/types.ts";

export interface ProgressProps {
  ctx: AppContext;
}

interface ProgressData {
  exercises: Exercise[];
  entries: Entry[];
  goals: Goal[];
  settings: Settings;
  week: { start: IsoDate; end: IsoDate };
  today: IsoDate;
  weekStartsOn: WeekStartsOn;
}

export function Progress({ ctx }: ProgressProps) {
  const { data, error } = useLiveQuery<ProgressData>(
    async () => {
      const settingsRow = await ctx.settings.get();
      const now = ctx.clock.now();
      const week = weekRange(now.day, settingsRow.weekStartsOn);
      const [exercises, entries, goals] = await Promise.all([
        ctx.exercises.list(),
        ctx.entries.inRange(week),
        ctx.goals.all(),
      ]);
      return {
        exercises,
        entries,
        goals,
        settings: settingsRow,
        week,
        today: now.day,
        weekStartsOn: settingsRow.weekStartsOn,
      };
    },
    [ctx],
  );

  const report = useMemo(() => {
    if (data === undefined) return undefined;
    return evaluate(data.week, data.entries, data.exercises, data.goals, data.settings, data.today);
  }, [data]);

  if (error !== undefined) {
    return (
      <section class="progress">
        <h1>Progress</h1>
        <p class="error" role="alert">
          Could not load your data: {error.message}
        </p>
      </section>
    );
  }

  if (data === undefined || report === undefined) {
    return (
      <section class="progress">
        <h1>Progress</h1>
        <p class="muted">Loading…</p>
      </section>
    );
  }

  const days = daysIn(data.week);
  const regularity = report.regularity;

  return (
    <section class="progress">
      <header class="progress__head">
        <h1>Progress</h1>
        <span class="muted" data-testid="day-position">
          day {report.elapsedDays} of {report.totalDays}
        </span>
      </header>

      <PeriodSwitcher period="week" onChange={() => undefined} monthEnabled={false} />

      <div class="card" data-testid="regularity">
        <div class="card__head">
          <span class="card__title">Regularity</span>
          <span class="card__value" data-testid="regularity-pct">
            {regularity.regularityPct === null ? "—" : formatPercentRounded(regularity.regularityPct)}
          </span>
        </div>
        <p class="muted">
          {regularity.activeDaysTarget === null
            ? `${regularity.activeDays} active days`
            : `${regularity.activeDays} of ${regularity.activeDaysTarget} days`}
        </p>
        <DayGrid days={days} activeDays={regularity.activeDayList} today={data.today} />
      </div>

      <h2 class="section-title">Volume</h2>
      <ul class="volume-list">
        {report.exercises.map((row) => (
          <li key={row.exerciseId} class="volume-row" data-testid={`volume-row-${row.exerciseId}`}>
            <div class="volume-row__head">
              <span class="volume-row__name">{row.name}</span>
              <span class="volume-row__pct" data-testid={`volume-${row.exerciseId}`}>
                {row.volumePct === null ? "—" : formatPercentRounded(row.volumePct)}
              </span>
            </div>
            <div class="volume-row__bar" aria-hidden="true">
              <div class="volume-row__fill" style={{ width: `${row.clampedPct}%` }} />
            </div>
            <div class="volume-row__meta">
              <span data-testid={`achieved-${row.exerciseId}`}>
                {formatAmountCompact(row.achieved, row.kind)}
              </span>
              <span class="muted" data-testid={`target-${row.exerciseId}`}>
                {row.target === null ? "no goal" : `of ${formatAmountCompact(row.target, row.kind)}`}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {report.exercises.length === 0 ? <p class="muted">No exercises yet.</p> : null}
    </section>
  );
}
