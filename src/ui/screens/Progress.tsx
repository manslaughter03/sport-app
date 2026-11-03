/**
 * Progress — "did I do the work?" and "did I show up?" on one screen (S7, #12).
 *
 * Reads through `liveQuery`, so logging a set on Today updates this screen too.
 * The `day X of N` line is deliberate: a 10 % reading on day 3 is not failure,
 * and without the position it reads like one (plan §0, O4). It is why the month
 * view says `day 3 of 31` rather than a bare percentage.
 *
 * Week and month are two readings of the same stored data, so the selected
 * period is component state and the query depends on it. The period is in the
 * `liveQuery` dependency list on purpose: forgetting it is the classic way for a
 * screen to keep showing the old range after a toggle.
 */

import { useMemo, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { DayGrid } from "../components/DayGrid.tsx";
import { MonthGrid } from "../components/MonthGrid.tsx";
import { PeriodSwitcher } from "../components/PeriodSwitcher.tsx";
import { evaluate, rangeForPeriod } from "../../domain/progress.ts";
import { paceBadge } from "../../domain/pace.ts";
import { daysIn } from "../../domain/period.ts";
import { formatAmountCompact, formatPercentRounded } from "../../domain/format.ts";
import type {
  Entry,
  Exercise,
  Goal,
  IsoDate,
  Period,
  Settings,
  WeekStartsOn,
} from "../../domain/types.ts";

export interface ProgressProps {
  ctx: AppContext;
}

interface ProgressData {
  exercises: Exercise[];
  entries: Entry[];
  goals: Goal[];
  settings: Settings;
  range: { start: IsoDate; end: IsoDate };
  today: IsoDate;
  weekStartsOn: WeekStartsOn;
  period: Period;
}

export function Progress({ ctx }: ProgressProps) {
  const [period, setPeriod] = useState<Period>("week");

  const { data, error } = useLiveQuery<ProgressData>(
    async () => {
      const settingsRow = await ctx.settings.get();
      const now = ctx.clock.now();
      const range = rangeForPeriod(period, now.day, settingsRow.weekStartsOn);
      const [exercises, entries, goals] = await Promise.all([
        ctx.exercises.list(),
        ctx.entries.inRange(range),
        ctx.goals.all(),
      ]);
      return {
        exercises,
        entries,
        goals,
        settings: settingsRow,
        range,
        today: now.day,
        weekStartsOn: settingsRow.weekStartsOn,
        period,
      };
    },
    // `period` belongs here: without it the query never rebuilds and the screen
    // keeps reporting the old range after a toggle.
    [ctx, period],
  );

  const report = useMemo(() => {
    if (data === undefined) return undefined;
    return evaluate(
      data.range,
      data.entries,
      data.exercises,
      data.goals,
      data.settings,
      data.today,
      data.period,
    );
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

  const days = daysIn(data.range);
  const regularity = report.regularity;
  const isMonth = period === "month";

  return (
    <section class="progress">
      <header class="progress__head">
        <h1>Progress</h1>
        <span class="muted" data-testid="day-position">
          day {report.elapsedDays} of {report.totalDays}
        </span>
      </header>

      <PeriodSwitcher period={period} onChange={setPeriod} monthEnabled />

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
        {isMonth ? (
          <MonthGrid
            days={days}
            activeDays={regularity.activeDayList}
            today={data.today}
            weekStartsOn={data.weekStartsOn}
          />
        ) : (
          <DayGrid days={days} activeDays={regularity.activeDayList} today={data.today} />
        )}
      </div>

      <h2 class="section-title">Volume · {isMonth ? "this month" : "this week"}</h2>
      <ul class="volume-list">
        {report.exercises.map((row) => (
          <li key={row.exerciseId} class="volume-row" data-testid={`volume-row-${row.exerciseId}`}>
            <div class="volume-row__head">
              <span class="volume-row__name">{row.name}</span>
              {(() => {
                // The badge is deliberately next to the percentage, not instead
                // of it: the number is information, the badge is the reading.
                const badge = paceBadge(row.pace, {
                  elapsedDays: report.elapsedDays,
                  totalDays: report.totalDays,
                });
                if (badge === undefined) return null;
                return (
                  <span
                    class="pace-badge"
                    data-testid={`pace-${row.exerciseId}`}
                    data-state={badge.state}
                    data-tone={badge.tone}
                  >
                    {badge.label}
                  </span>
                );
              })()}
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
