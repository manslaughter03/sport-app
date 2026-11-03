/**
 * History — one row per past period (issue #14).
 *
 * This is the screen where a goal-versioning regression would show first, so it
 * is built on the same rule as Progress: **nothing is recomputed from current
 * goals**. Each row is `evaluate()` on that period's range, and `goalInForce`
 * selects the row that applied *then*. Raising a target today must leave last
 * week's percentage exactly where it was.
 *
 * Two further rules the issue asks for:
 *
 * - A week with no entries renders `0 %`, not a blank. Blank and zero are
 *   different claims, and only one of them is true.
 * - A period *before tracking began* is marked, so `0 %` of nothing is not read
 *   as a missed week. Tracking start is the earliest stored `day` — a fact, not
 *   a heuristic.
 *
 * Performance: `evaluate` is pure, so the list is one query and a loop, never N
 * queries. A year of data (~2k entries) stays well under the 50 ms budget; the
 * test asserts it rather than assuming it.
 */

import { useMemo, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import { PeriodSwitcher } from "../components/PeriodSwitcher.tsx";
import { evaluatePeriods } from "../../domain/progress.ts";
import { previousRanges, prevDay } from "../../domain/period.ts";
import { formatAmountCompact, formatPercentRounded } from "../../domain/format.ts";
import type {
  Entry,
  Exercise,
  Goal,
  IsoDate,
  Period,
  ProgressReport,
  Settings,
  WeekStartsOn,
} from "../../domain/types.ts";

/** How many periods the list shows. Eight weeks is two months of context. */
export const HISTORY_LENGTH = 8;

export interface HistoryProps {
  ctx: AppContext;
}

interface HistoryData {
  exercises: Exercise[];
  entries: Entry[];
  goals: Goal[];
  settings: Settings;
  today: IsoDate;
  weekStartsOn: WeekStartsOn;
  /** Earliest stored day, or undefined when nothing has ever been logged. */
  firstDay: IsoDate | undefined;
}

export function History({ ctx }: HistoryProps) {
  const [period, setPeriod] = useState<Period>("week");
  const [expanded, setExpanded] = useState<IsoDate | undefined>(undefined);

  const { data, error } = useLiveQuery<HistoryData>(
    async () => {
      const settingsRow = await ctx.settings.get();
      const now = ctx.clock.now();
      // `all()` rather than per-range queries: one read, then a pure loop.
      const [exercises, entries, goals] = await Promise.all([
        ctx.exercises.all(),
        ctx.entries.all(),
        ctx.goals.all(),
      ]);
      const firstDay = entries.reduce<IsoDate | undefined>(
        (earliest, entry) => (earliest === undefined || entry.day < earliest ? entry.day : earliest),
        undefined,
      );
      return {
        exercises,
        entries,
        goals,
        settings: settingsRow,
        today: now.day,
        weekStartsOn: settingsRow.weekStartsOn,
        firstDay,
      };
    },
    [ctx],
  );

  const reports = useMemo(() => {
    if (data === undefined) return [];
    const ranges = previousRanges(period, data.today, HISTORY_LENGTH, data.weekStartsOn);
    return evaluatePeriods(
      ranges,
      data.entries,
      data.exercises,
      data.goals,
      data.settings,
      data.today,
      period,
    );
  }, [data, period]);

  if (error !== undefined) {
    return (
      <section class="history">
        <h1>History</h1>
        <p class="error" role="alert">
          Could not load your history: {error.message}
        </p>
      </section>
    );
  }

  if (data === undefined) {
    return (
      <section class="history">
        <h1>History</h1>
        <p class="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section class="history">
      <header class="progress__head">
        <h1>History</h1>
        <span class="muted" data-testid="history-count">
          last {reports.length} {period === "week" ? "weeks" : "months"}
        </span>
      </header>

      <PeriodSwitcher period={period} onChange={setPeriod} monthEnabled />

      <ul class="history-list" data-testid="history-list">
        {reports.map((report) => {
          const key = report.range.start;
          // A period that has not finished yet is the one being lived in.
          const isCurrent = report.elapsedDays < report.totalDays;
          // Everything ending before the first stored entry is before tracking.
          const beforeTracking =
            data.firstDay === undefined || report.range.end <= data.firstDay;
          const isOpen = expanded === key;

          return (
            <li
              key={key}
              class="history-row"
              data-testid={`history-row-${key}`}
              data-current={String(isCurrent)}
              data-untracked={String(beforeTracking)}
            >
              <button
                type="button"
                class="history-row__head"
                aria-expanded={isOpen}
                data-testid={`history-toggle-${key}`}
                onClick={() => setExpanded(isOpen ? undefined : key)}
              >
                <span class="history-row__label">
                  {formatRangeLabel(report.range)}
                  {isCurrent ? <span class="muted"> · now</span> : null}
                </span>
                <span class="history-row__pct" data-testid={`history-regularity-${key}`}>
                  {beforeTracking
                    ? "—"
                    : report.regularity.regularityPct === null
                      ? "no goal"
                      : formatPercentRounded(report.regularity.regularityPct)}
                </span>
              </button>

              <p class="history-row__volumes" data-testid={`history-volumes-${key}`}>
                {beforeTracking ? (
                  <span class="muted">Before tracking began</span>
                ) : (
                  <Volumes report={report} />
                )}
              </p>

              {isOpen ? <Breakdown report={report} /> : null}
            </li>
          );
        })}
      </ul>

      {reports.length === 0 ? <p class="muted">Nothing to show yet.</p> : null}
    </section>
  );
}

/**
 * The compressed one-line view: `Push-up 71 % · Core 40 %`.
 *
 * An exercise with no goal shows a dash rather than `0 %`: `0 %` would claim it
 * missed a target it does not have.
 */
function Volumes({ report }: { report: ProgressReport }) {
  if (report.exercises.length === 0) return <span class="muted">No exercises</span>;

  return (
    <span class="history-row__summary">
      {report.exercises.map((row, index) => (
        <span key={row.exerciseId}>
          <span>{row.name} </span>
          <span
            class="history-row__value"
            data-testid={`history-volume-${report.range.start}-${row.exerciseId}`}
          >
            {row.volumePct === null ? "—" : formatPercentRounded(row.volumePct)}
          </span>
          {index < report.exercises.length - 1 ? <span class="muted"> · </span> : null}
        </span>
      ))}
    </span>
  );
}

function Breakdown({ report }: { report: ProgressReport }) {
  return (
    <div class="history-row__details" data-testid={`history-details-${report.range.start}`}>
      <dl class="history-breakdown">
        <div>
          <dt>Active days</dt>
          <dd>
            {report.regularity.activeDays}
            {report.regularity.activeDaysTarget === null
              ? ""
              : ` of ${report.regularity.activeDaysTarget}`}
          </dd>
        </div>
        {report.exercises.map((row) => (
          <div key={row.exerciseId}>
            <dt>{row.name}</dt>
            <dd>
              {formatAmountCompact(row.achieved, row.kind)}
              {row.target === null ? "" : ` of ${formatAmountCompact(row.target, row.kind)}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * `2–8 Mar`, or `23 Feb – 1 Mar` when the period straddles two months.
 *
 * `range.end` is exclusive, so the last day shown is `end - 1`. Printing the
 * exclusive end would claim a day the period does not contain — the classic
 * off-by-one in a range label.
 *
 * Month periods span one calendar month, so they collapse to `1–31 Mar` rather
 * than repeating the month name for no information gain.
 */
export function formatRangeLabel(range: { start: IsoDate; end: IsoDate }): string {
  const startMonth = Number(range.start.slice(5, 7));
  const startDay = Number(range.start.slice(8, 10));

  const lastInclusive = prevDay(range.end);
  const endMonth = Number(lastInclusive.slice(5, 7));
  const endDay = Number(lastInclusive.slice(8, 10));

  const startLabel = `${startDay} ${MONTHS_SHORT[startMonth - 1] ?? ""}`;
  const endLabel = `${endDay} ${MONTHS_SHORT[endMonth - 1] ?? ""}`;

  return startMonth === endMonth ? `${startDay}–${endLabel}` : `${startLabel} – ${endLabel}`;
}
