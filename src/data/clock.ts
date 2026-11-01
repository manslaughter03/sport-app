/**
 * The one place that is allowed to read the wall clock.
 *
 * `domain/` is forbidden from touching `Date` (ESLint enforces it), so time is
 * injected from here. Every repo and screen takes a `Clock`, which is also what
 * makes the whole data layer testable with a fixed day and hour.
 */

import type { IsoDate, IsoInstant } from "../domain/types.ts";

/** A local day, hour and UTC instant, captured together so they cannot disagree. */
export interface Now {
  readonly day: IsoDate;
  readonly hour: number;
  readonly instant: IsoInstant;
}

export interface Clock {
  now(): Now;
}

/** Production clock: reads the device's local calendar. */
export function systemClock(): Clock {
  return {
    now(): Now {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return {
        day: `${year}-${month}-${day}`,
        hour: date.getHours(),
        instant: date.toISOString(),
      };
    },
  };
}

/** Test clock: returns a fixed value, so no test depends on when it runs. */
export function createClock(provider: () => Now): Clock {
  return { now: provider };
}
