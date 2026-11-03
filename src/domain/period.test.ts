import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  daysIn,
  diffDays,
  elapsedFraction,
  isInRange,
  monthRange,
  nextDay,
  prevDay,
  periodDays,
  periodRange,
  previousRanges,
  resolveDay,
  weekRange,
} from "./period.ts";

/**
 * Every case here passes an explicit local day/hour. Nothing reads a clock —
 * that is the whole point of the domain layer (docs/architecture.md §4).
 */

describe("resolveDay — cutoff hour", () => {
  it("assigns a session logged before the cutoff to the previous day", () => {
    // 00:30 with cutoff 3 is still "yesterday's" training.
    expect(resolveDay({ day: "2026-11-01", hour: 0 }, 3)).toBe("2026-10-31");
    expect(resolveDay({ day: "2026-11-01", hour: 2 }, 3)).toBe("2026-10-31");
  });

  it("keeps a session at or after the cutoff on the same day", () => {
    expect(resolveDay({ day: "2026-11-01", hour: 3 }, 3)).toBe("2026-11-01");
    expect(resolveDay({ day: "2026-11-01", hour: 18 }, 3)).toBe("2026-11-01");
  });

  it("never shifts when the cutoff is 0", () => {
    expect(resolveDay({ day: "2026-11-01", hour: 0 }, 0)).toBe("2026-11-01");
    expect(resolveDay({ day: "2026-11-01", hour: 23 }, 0)).toBe("2026-11-01");
  });

  it("crosses a month boundary correctly", () => {
    expect(resolveDay({ day: "2026-11-01", hour: 1 }, 3)).toBe("2026-10-31");
    expect(resolveDay({ day: "2026-03-01", hour: 2 }, 4)).toBe("2026-02-28");
  });

  it("crosses a year boundary correctly", () => {
    expect(resolveDay({ day: "2027-01-01", hour: 1 }, 3)).toBe("2026-12-31");
  });

  it("crosses a leap day correctly", () => {
    expect(resolveDay({ day: "2028-03-01", hour: 0 }, 3)).toBe("2028-02-29");
  });
});

describe("weekRange — weekStartsOn", () => {
  it("starts the week on Monday when weekStartsOn is 1", () => {
    // 2026-11-04 is a Wednesday.
    expect(weekRange("2026-11-04", 1)).toEqual({
      start: "2026-11-02",
      end: "2026-11-09",
    });
  });

  it("returns the anchor day itself when the anchor is the week start", () => {
    expect(weekRange("2026-11-02", 1)).toEqual({
      start: "2026-11-02",
      end: "2026-11-09",
    });
  });

  it("starts the week on Sunday when weekStartsOn is 7", () => {
    expect(weekRange("2026-11-04", 7)).toEqual({
      start: "2026-11-01",
      end: "2026-11-08",
    });
  });

  it("treats Sunday as the week start, not the week end, when weekStartsOn is 7", () => {
    expect(weekRange("2026-11-01", 7)).toEqual({
      start: "2026-11-01",
      end: "2026-11-08",
    });
  });

  it("puts Sunday at the end of the week when weekStartsOn is 1", () => {
    expect(weekRange("2026-11-08", 1)).toEqual({
      start: "2026-11-02",
      end: "2026-11-09",
    });
  });

  it("spans a month boundary", () => {
    expect(weekRange("2026-10-31", 1)).toEqual({
      start: "2026-10-26",
      end: "2026-11-02",
    });
  });

  it("spans a year boundary", () => {
    expect(weekRange("2027-01-01", 1)).toEqual({
      start: "2026-12-28",
      end: "2027-01-04",
    });
  });

  it("always covers exactly 7 days", () => {
    for (const anchor of [
      "2026-01-01",
      "2026-02-28",
      "2028-02-29",
      "2026-12-31",
      "2027-06-15",
    ]) {
      for (const ws of [1, 7] as const) {
        expect(periodDays(weekRange(anchor, ws))).toBe(7);
      }
    }
  });
});

describe("monthRange", () => {
  it("covers a calendar month with an exclusive end", () => {
    expect(monthRange("2026-11-15")).toEqual({
      start: "2026-11-01",
      end: "2026-12-01",
    });
  });

  it("rolls over from December to January of the next year", () => {
    expect(monthRange("2026-12-31")).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });

  it("handles February in a common year", () => {
    expect(monthRange("2026-02-10")).toEqual({
      start: "2026-02-01",
      end: "2026-03-01",
    });
    expect(periodDays(monthRange("2026-02-10"))).toBe(28);
  });

  it("handles February in a leap year", () => {
    expect(periodDays(monthRange("2028-02-10"))).toBe(29);
    expect(periodDays(monthRange("2024-02-10"))).toBe(29);
  });

  it("handles 30- and 31-day months", () => {
    expect(periodDays(monthRange("2026-04-10"))).toBe(30);
    expect(periodDays(monthRange("2026-07-10"))).toBe(31);
  });

  it("treats a leap day as a valid anchor", () => {
    expect(monthRange("2028-02-29")).toEqual({
      start: "2028-02-01",
      end: "2028-03-01",
    });
  });
});

describe("daysIn", () => {
  it("lists every day of a week in order", () => {
    expect(daysIn(weekRange("2026-11-04", 1))).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("lists every day of a leap February", () => {
    const days = daysIn(monthRange("2028-02-10"));
    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2028-02-01");
    expect(days[28]).toBe("2028-02-29");
  });

  it("returns an empty list for an empty range", () => {
    expect(daysIn({ start: "2026-11-01", end: "2026-11-01" })).toEqual([]);
  });
});

describe("isInRange — half-open [start, end)", () => {
  const week = { start: "2026-11-02", end: "2026-11-09" };

  it("includes the start day", () => {
    expect(isInRange("2026-11-02", week)).toBe(true);
  });

  it("excludes the end day", () => {
    expect(isInRange("2026-11-09", week)).toBe(false);
  });

  it("includes the last real day", () => {
    expect(isInRange("2026-11-08", week)).toBe(true);
  });

  it("excludes days outside the range", () => {
    expect(isInRange("2026-11-01", week)).toBe(false);
    expect(isInRange("2026-12-01", week)).toBe(false);
  });
});

describe("elapsedFraction", () => {
  const week = { start: "2026-11-02", end: "2026-11-09" };

  it("counts the current day as elapsed", () => {
    expect(elapsedFraction(week, "2026-11-02")).toBeCloseTo(1 / 7);
  });

  it("is mid-period in the middle of the week", () => {
    expect(elapsedFraction(week, "2026-11-04")).toBeCloseTo(3 / 7);
  });

  it("is exactly 1 for a finished period", () => {
    expect(elapsedFraction(week, "2026-11-09")).toBe(1);
    expect(elapsedFraction(week, "2026-12-01")).toBe(1);
  });

  it("is 0 for a period that has not started", () => {
    expect(elapsedFraction(week, "2026-11-01")).toBe(0);
  });

  it("never exceeds 1 and is never negative", () => {
    for (const today of [
      "2026-10-01",
      "2026-11-02",
      "2026-11-05",
      "2026-11-09",
      "2027-01-01",
    ]) {
      const f = elapsedFraction(week, today);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("handles a 31-day month", () => {
    const month = monthRange("2026-07-10");
    expect(elapsedFraction(month, "2026-07-31")).toBeCloseTo(31 / 31);
    expect(elapsedFraction(month, "2026-07-01")).toBeCloseTo(1 / 31);
  });
});

describe("calendar arithmetic", () => {
  it("round-trips a day across a DST transition", () => {
    // 2026-03-29 is a spring-forward day in Europe/Paris: 23 hours long.
    // A local calendar day is still exactly one day.
    expect(nextDay("2026-03-29")).toBe("2026-03-30");
    expect(prevDay("2026-03-30")).toBe("2026-03-29");
    expect(periodDays(weekRange("2026-03-29", 1))).toBe(7);
  });

  it("round-trips a day across an autumn DST transition", () => {
    // 2026-10-25 is a fall-back day: 25 hours long.
    expect(nextDay("2026-10-25")).toBe("2026-10-26");
    expect(prevDay("2026-10-26")).toBe("2026-10-25");
  });

  it("moves across month and year boundaries", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(prevDay("2027-01-01")).toBe("2026-12-31");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2028-02-29")).toBe("2028-03-01");
    expect(prevDay("2026-03-01")).toBe("2026-02-28");
  });

  it("adds and subtracts days", () => {
    expect(addDays("2026-11-01", 0)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 30)).toBe("2026-12-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("measures the distance between days", () => {
    expect(diffDays("2026-11-09", "2026-11-02")).toBe(7);
    expect(diffDays("2026-11-02", "2026-11-09")).toBe(-7);
    expect(diffDays("2026-11-02", "2026-11-02")).toBe(0);
  });

  it("numbers weekdays 1..7 with Monday as 1", () => {
    expect(dayOfWeek("2026-11-02")).toBe(1); // Monday
    expect(dayOfWeek("2026-11-04")).toBe(3); // Wednesday
    expect(dayOfWeek("2026-11-07")).toBe(6); // Saturday
    expect(dayOfWeek("2026-11-08")).toBe(7); // Sunday
  });

  it("is stable across a century boundary", () => {
    expect(dayOfWeek("2000-01-01")).toBe(6); // Saturday
    expect(dayOfWeek("2026-11-02")).toBe(1);
    // 2000 is a leap year (divisible by 400), so 2000..2099 holds 25 leap years.
    expect(diffDays("2100-01-01", "2000-01-01")).toBe(36525);
  });

  it("rejects days that do not exist", () => {
    expect(() => addDays("2026-02-29", 0)).toThrow(/not a real calendar day/i);
    expect(() => addDays("2026-04-31", 0)).toThrow(/not a real calendar day/i);
    expect(() => addDays("2026-13-01", 0)).toThrow();
    expect(() => addDays("not-a-date", 0)).toThrow();
    // ...but the real leap day is fine.
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("range invariants", () => {
  it("always produces start < end", () => {
    for (const anchor of ["2026-01-01", "2026-02-28", "2026-12-31", "2028-02-29"]) {
      for (const range of [weekRange(anchor, 1), weekRange(anchor, 7), monthRange(anchor)]) {
        expect(range.start < range.end).toBe(true);
        expect(periodDays(range)).toBeGreaterThan(0);
      }
    }
  });

  it("agrees between daysIn and periodDays", () => {
    for (const anchor of ["2026-01-15", "2026-02-15", "2026-12-15"]) {
      const month = monthRange(anchor);
      expect(daysIn(month)).toHaveLength(periodDays(month));
    }
  });
});

describe("input validation — the guards that protect stored data", () => {
  it("rejects a non-integer day count", () => {
    expect(() => addDays("2026-11-01", 1.5)).toThrow(/integer/i);
    expect(() => addDays("2026-11-01", Number.NaN)).toThrow(/integer/i);
  });

  it("rejects an inverted range", () => {
    expect(() => periodDays({ start: "2026-11-09", end: "2026-11-02" })).toThrow(/precedes/i);
  });

  it("rejects an out-of-range cutoff hour", () => {
    expect(() => resolveDay({ day: "2026-11-01", hour: 12 }, -1)).toThrow(/0\.\.23/);
    expect(() => resolveDay({ day: "2026-11-01", hour: 12 }, 24)).toThrow(/0\.\.23/);
    expect(() => resolveDay({ day: "2026-11-01", hour: 12 }, 2.5)).toThrow(/0\.\.23/);
  });

  it("rejects an out-of-range hour even when the cutoff makes it moot", () => {
    expect(() => resolveDay({ day: "2026-11-01", hour: 24 }, 0)).toThrow(/0\.\.23/);
    expect(() => resolveDay({ day: "2026-11-01", hour: -1 }, 0)).toThrow(/0\.\.23/);
  });

  it("validates the day in resolveDay", () => {
    expect(() => resolveDay({ day: "2026-02-30", hour: 12 }, 3)).toThrow(/real calendar day/i);
  });

  it("rejects an unsupported weekStartsOn", () => {
    expect(() => weekRange("2026-11-04", 3 as unknown as 1)).toThrow(/Monday/i);
  });

  it("routes periodRange to the right range", () => {
    expect(periodRange("week", "2026-11-04", 1)).toEqual(weekRange("2026-11-04", 1));
    expect(periodRange("month", "2026-11-04")).toEqual(monthRange("2026-11-04"));
    // Default weekStartsOn is Monday.
    expect(periodRange("week", "2026-11-04")).toEqual(weekRange("2026-11-04", 1));
  });

  it("returns 1 for an empty range's elapsed fraction", () => {
    expect(elapsedFraction({ start: "2026-11-01", end: "2026-11-01" }, "2026-11-01")).toBe(1);
  });
});

describe("previousRanges (#14)", () => {
  it("starts with the period containing the anchor", () => {
    const ranges = previousRanges("week", "2026-03-04", 3);
    expect(ranges[0]).toEqual({ start: "2026-03-02", end: "2026-03-09" });
  });

  it("walks backwards one week at a time, newest first", () => {
    const ranges = previousRanges("week", "2026-03-04", 3);
    expect(ranges).toEqual([
      { start: "2026-03-02", end: "2026-03-09" },
      { start: "2026-02-23", end: "2026-03-02" },
      { start: "2026-02-16", end: "2026-02-23" },
    ]);
  });

  it("honours the week start", () => {
    const ranges = previousRanges("week", "2026-03-04", 2, 7);
    expect(ranges[0]).toEqual({ start: "2026-03-01", end: "2026-03-08" });
    expect(ranges[1]).toEqual({ start: "2026-02-22", end: "2026-03-01" });
  });

  it("walks calendar months without drifting", () => {
    const ranges = previousRanges("month", "2026-03-04", 4);
    expect(ranges).toEqual([
      { start: "2026-03-01", end: "2026-04-01" },
      { start: "2026-02-01", end: "2026-03-01" },
      { start: "2026-01-01", end: "2026-02-01" },
      { start: "2025-12-01", end: "2026-01-01" },
    ]);
  });

  it("crosses a year boundary", () => {
    const ranges = previousRanges("week", "2026-01-01", 2);
    expect(ranges[0]).toEqual({ start: "2025-12-29", end: "2026-01-05" });
    expect(ranges[1]).toEqual({ start: "2025-12-22", end: "2025-12-29" });
  });

  it("returns one range for a count of one", () => {
    expect(previousRanges("week", "2026-03-04", 1)).toHaveLength(1);
  });

  it("rejects a nonsense count", () => {
    expect(() => previousRanges("week", "2026-03-04", 0)).toThrow(RangeError);
    expect(() => previousRanges("week", "2026-03-04", -2)).toThrow(RangeError);
    expect(() => previousRanges("week", "2026-03-04", 1.5)).toThrow(RangeError);
  });
});
