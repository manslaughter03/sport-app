/**
 * Month grid: the calendar month, one cell per day, weekday columns.
 *
 * The weekly `DayGrid` is a fixed row of seven cells; a month is 28–31 cells and
 * needs real columns or the weekdays stop lining up, which is the only reason
 * anyone can read it at a glance. Rather than teach `DayGrid` about week starts
 * and leading blanks, this is its own component — it shares the day-cell
 * vocabulary (`data-active` / `data-today` / `data-future`) so the two read as
 * one design.
 *
 * Leading blanks come from the user's own `weekStartsOn`, so a Sunday-start user
 * gets Sunday-first columns.
 */

import type { IsoDate, WeekStartsOn } from "../../domain/types.ts";
import { dayOfWeek, monthOf } from "../../domain/period.ts";

export interface MonthGridProps {
  days: readonly IsoDate[];
  activeDays: readonly IsoDate[];
  today: IsoDate;
  weekStartsOn: WeekStartsOn;
}

/** 0 = Sunday … 6 = Saturday, shifted so the user's week start is column 0. */
function columnOf(day: IsoDate, weekStartsOn: WeekStartsOn): number {
  // `dayOfWeek` is 1 = Monday … 7 = Sunday.
  const fromMonday = dayOfWeek(day) - 1;
  const start = weekStartsOn === 1 ? 0 : 6;
  return (fromMonday - start + 7) % 7;
}

export function MonthGrid({ days, activeDays, today, weekStartsOn }: MonthGridProps) {
  const active = new Set(activeDays);
  const first = days[0];
  if (first === undefined) return null;

  const leading = columnOf(first, weekStartsOn);
  const month = monthOf(first);

  return (
    <div class="month-grid" data-testid="month-grid">
      <div class="month-grid__head" aria-hidden="true">
        {weekdayHeaders(weekStartsOn).map((label, index) => (
          <span key={`${label}-${index}`} class="month-grid__weekday">
            {label}
          </span>
        ))}
      </div>
      <ol class="month-grid__cells">
        {Array.from({ length: leading }, (_, index) => (
          <li key={`blank-${index}`} class="day-cell day-cell--blank" aria-hidden="true" />
        ))}
        {days.map((day) => {
          const isActive = active.has(day);
          const isToday = day === today;
          const isFuture = day > today;
          return (
            <li
              key={day}
              class="day-cell day-cell--date"
              data-testid={`month-cell-${day}`}
              data-active={String(isActive)}
              data-today={String(isToday)}
              data-future={String(isFuture)}
              title={day}
            >
              <span class="day-cell__date" aria-hidden="true">
                {Number(day.slice(8, 10))}
              </span>
              <span class="day-cell__dot" aria-hidden="true" />
              <span class="visually-hidden">
                {`${day}${isActive ? " active" : ""}${isToday ? " today" : ""}`}
              </span>
            </li>
          );
        })}
      </ol>
      <p class="visually-hidden" data-testid="month-grid-label">
        {monthName(month)} — {activeDays.length} active days
      </p>
    </div>
  );
}

const WEEKDAY_ORDER = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayHeaders(weekStartsOn: WeekStartsOn): string[] {
  const start = weekStartsOn === 1 ? 1 : 0;
  return Array.from({ length: 7 }, (_, index) => WEEKDAY_ORDER[(start + index) % 7] ?? "S");
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}
