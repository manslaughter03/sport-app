/**
 * The 7-day grid: one cell per day of the period.
 *
 * Three states matter visually — active, today, and still to come. Marking the
 * future distinctly is what stops an empty Wednesday from looking like a
 * failure on Tuesday.
 */

import type { IsoDate } from "../../domain/types.ts";

export interface DayGridProps {
  days: readonly IsoDate[];
  activeDays: readonly IsoDate[];
  today: IsoDate;
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/** 0 = Sunday … 6 = Saturday, from the ISO day string alone. */
function weekdayIndex(day: IsoDate): number {
  // 1970-01-01 was a Thursday (index 4).
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const utc = Date.UTC(year, month - 1, date);
  return new Date(utc).getUTCDay();
}

export function DayGrid({ days, activeDays, today }: DayGridProps) {
  const active = new Set(activeDays);

  return (
    <ol class="day-grid" data-testid="day-grid">
      {days.map((day) => {
        const isActive = active.has(day);
        const isToday = day === today;
        const isFuture = day > today;
        return (
          <li
            key={day}
            class="day-cell"
            data-testid={`day-cell-${day}`}
            data-active={String(isActive)}
            data-today={String(isToday)}
            data-future={String(isFuture)}
            title={day}
          >
            <span class="day-cell__initial" aria-hidden="true">
              {WEEKDAY_INITIALS[weekdayIndex(day)]}
            </span>
            <span class="day-cell__dot" aria-hidden="true" />
            <span class="visually-hidden">
              {day}
              {isActive ? " active" : ""}
              {isToday ? " today" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
