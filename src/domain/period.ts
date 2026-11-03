/**
 * Calendar and period math (docs/architecture.md §3.1).
 *
 * Pure functions only: no `Date`, no `Date.now()`, no time zone lookups. Every
 * input is an explicit local calendar day, so results cannot depend on where the
 * phone is or what hour it is there. ESLint enforces the no-clock rule.
 *
 * Internally a day is converted to a "civil day number" — days since
 * 1970-01-01 in the proleptic Gregorian calendar — which makes week/month
 * arithmetic plain integer math and immune to DST.
 */

import type { IsoDate, PeriodRange, WeekStartsOn } from "./types.ts";

/** Days from 1970-01-01 to 0000-03-01, the epoch of the civil-date algorithm. */
const CIVIL_EPOCH_OFFSET = 719_468;

interface Civil {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseIsoDate(iso: IsoDate): Civil {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) {
    throw new RangeError(`Not an ISO local day (expected YYYY-MM-DD): ${iso}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not a real calendar day: ${iso}`);
  }
  return { year, month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatIsoDate({ year, month, day }: Civil): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Days since 1970-01-01 for a civil date (proleptic Gregorian, no `Date`). */
function toDayNumber({ year, month, day }: Civil): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400; // 0..399
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - CIVIL_EPOCH_OFFSET;
}

/** Inverse of {@link toDayNumber}. */
function fromDayNumber(dayNumber: number): Civil {
  const z = dayNumber + CIVIL_EPOCH_OFFSET;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097; // 0..146096
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153); // 0..11, March-based
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: month <= 2 ? year + 1 : year, month, day };
}

/** Add `count` days to a local day. `count` may be negative. */
export function addDays(iso: IsoDate, count: number): IsoDate {
  if (!Number.isInteger(count)) {
    throw new RangeError(`addDays expects an integer day count, got ${count}`);
  }
  return formatIsoDate(fromDayNumber(toDayNumber(parseIsoDate(iso)) + count));
}

export function nextDay(iso: IsoDate): IsoDate {
  return addDays(iso, 1);
}

export function prevDay(iso: IsoDate): IsoDate {
  return addDays(iso, -1);
}

/** Signed day distance `a - b`. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toDayNumber(parseIsoDate(a)) - toDayNumber(parseIsoDate(b));
}

/** The calendar month (1..12) an ISO day falls in. */
export function monthOf(iso: IsoDate): number {
  return parseIsoDate(iso).month;
}

/** ISO weekday number: 1 = Monday … 7 = Sunday. */
export function dayOfWeek(iso: IsoDate): number {
  // Day 0 (1970-01-01) was a Thursday, which is 4 in ISO numbering.
  const dayNumber = toDayNumber(parseIsoDate(iso));
  return ((((dayNumber + 3) % 7) + 7) % 7) + 1;
}

/** Number of local days in a half-open range. */
export function periodDays(range: PeriodRange): number {
  const count = diffDays(range.end, range.start);
  if (count < 0) {
    throw new RangeError(`Range end precedes start: ${range.start} → ${range.end}`);
  }
  return count;
}

/** Every local day in a half-open range, in order. */
export function daysIn(range: PeriodRange): IsoDate[] {
  const count = periodDays(range);
  const start = toDayNumber(parseIsoDate(range.start));
  const days: IsoDate[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    days.push(formatIsoDate(fromDayNumber(start + offset)));
  }
  return days;
}

/** Half-open containment: `[start, end)`. */
export function isInRange(day: IsoDate, range: PeriodRange): boolean {
  return day >= range.start && day < range.end;
}

/**
 * Which local day a session belongs to, given the hour it was logged and the
 * user's cutoff hour (docs/architecture.md §2.2).
 *
 * A set logged at 00:30 with a cutoff of 3 counts for the previous day, so
 * evening training that runs past midnight stays in one bucket.
 */
export function resolveDay(
  loggedAt: { readonly day: IsoDate; readonly hour: number },
  cutoffHour: number,
): IsoDate {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new RangeError(`dayCutoffHour must be an integer 0..23, got ${cutoffHour}`);
  }
  const { day, hour } = loggedAt;
  // Validate the day even when the cutoff makes the branch moot.
  parseIsoDate(day);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`hour must be an integer 0..23, got ${hour}`);
  }
  return hour < cutoffHour ? prevDay(day) : day;
}

/** The week containing `anchor`, as `[start, start + 7)`. */
export function weekRange(anchor: IsoDate, weekStartsOn: WeekStartsOn = 1): PeriodRange {
  if (weekStartsOn !== 1 && weekStartsOn !== 7) {
    throw new RangeError(`weekStartsOn must be 1 (Monday) or 7 (Sunday), got ${weekStartsOn}`);
  }
  const weekday = dayOfWeek(anchor);
  // Distance back to the configured week start, in 0..6.
  const back = (weekday - weekStartsOn + 7) % 7;
  const start = addDays(anchor, -back);
  return { start, end: addDays(start, 7) };
}

/** The calendar month containing `anchor`, as `[1st, 1st of next month)`. */
export function monthRange(anchor: IsoDate): PeriodRange {
  const { year, month } = parseIsoDate(anchor);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: formatIsoDate({ year, month, day: 1 }),
    end: formatIsoDate({ year: nextYear, month: nextMonth, day: 1 }),
  };
}

/** The range for a period kind, anchored on `anchor`. */
export function periodRange(
  period: "week" | "month",
  anchor: IsoDate,
  weekStartsOn: WeekStartsOn = 1,
): PeriodRange {
  return period === "week" ? weekRange(anchor, weekStartsOn) : monthRange(anchor);
}

/**
 * How much of the period has elapsed by `today`, as `0..1`.
 *
 * The current day counts as elapsed: on day 1 of 7 the fraction is 1/7, not 0.
 * Used for pace ("am I on track before the period ends?").
 */
export function elapsedFraction(range: PeriodRange, today: IsoDate): number {
  const total = periodDays(range);
  if (total === 0) return 1;
  const elapsed = diffDays(today, range.start) + 1;
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 1;
  return elapsed / total;
}
