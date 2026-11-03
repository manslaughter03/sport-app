import { describe, expect, it } from "vitest";
import { paceBadge, paceLabel, type PaceBadge } from "./pace.ts";
import type { PaceState } from "./types.ts";

const ALL_STATES: PaceState[] = [
  "on-track",
  "ahead",
  "behind",
  "done",
  "over-cap",
  "untargeted",
];

/** Mid-period: day 3 of 7. Ahead / behind / on pace all still mean something. */
const midWeek = { elapsedDays: 3, totalDays: 7 };
/** The last day: there is no time left to act on a pace. */
const lastDay = { elapsedDays: 7, totalDays: 7 };

function badge(state: PaceState, options = midWeek): PaceBadge | undefined {
  return paceBadge(state, options);
}

describe("pace badge wording", () => {
  it("names every state", () => {
    for (const state of ALL_STATES) {
      expect(badge(state)?.label).toBeTruthy();
    }
  });

  it("says 'behind pace', not something that reads as failure", () => {
    // The issue's acceptance criterion, verbatim: the wording must not need the
    // number to be understood, and must not scold.
    const behind = badge("behind");
    expect(behind?.label).toBe("behind pace");
    expect(behind?.label).not.toMatch(/fail|missed|bad|off track|warning/i);
  });

  it("keeps 'behind' visually quiet rather than a warning", () => {
    expect(badge("behind")?.tone).toBe("quiet");
  });

  it("calls an aspirational goal past 100 % 'done', never a warning", () => {
    expect(badge("done")).toEqual({ state: "done", label: "done", tone: "good" });
  });

  it("reserves the warning tone for a capped goal", () => {
    expect(badge("over-cap")?.tone).toBe("warning");
    expect(badge("over-cap")?.label).toBe("over target");
    // Nothing else may use it: a warning on an aspirational goal would be a lie.
    const others = ALL_STATES.filter((s) => s !== "over-cap");
    for (const state of others) {
      expect(badge(state)?.tone).not.toBe("warning");
    }
  });

  it("labels a target-less exercise 'no goal' rather than leaving a hole", () => {
    expect(badge("untargeted")?.label).toBe("no goal");
    expect(badge("untargeted")?.tone).toBe("muted");
  });
});

describe("pace badge visibility", () => {
  it("is hidden on the final day where ahead/behind is meaningless", () => {
    expect(badge("ahead", lastDay)).toBeUndefined();
    expect(badge("behind", lastDay)).toBeUndefined();
    expect(badge("on-track", lastDay)).toBeUndefined();
  });

  it("keeps the outcome states on the final day", () => {
    // "done" and "over target" are verdicts, not forecasts.
    expect(badge("done", lastDay)?.label).toBe("done");
    expect(badge("over-cap", lastDay)?.label).toBe("over target");
    expect(badge("untargeted", lastDay)?.label).toBe("no goal");
  });

  it("shows the forecast states through the middle of the period", () => {
    expect(badge("ahead", midWeek)?.label).toBe("ahead of pace");
    expect(badge("behind", { elapsedDays: 1, totalDays: 31 })?.label).toBe("behind pace");
    expect(badge("on-track", { elapsedDays: 30, totalDays: 31 })?.label).toBe("on pace");
  });

  it("never divides by a zero-length period", () => {
    expect(badge("ahead", { elapsedDays: 0, totalDays: 0 })).toBeUndefined();
    expect(badge("done", { elapsedDays: 0, totalDays: 0 })).toBeUndefined();
  });
});

describe("paceLabel", () => {
  it("matches the badge text, so a legend cannot drift from the row", () => {
    for (const state of ALL_STATES) {
      expect(paceLabel(state)).toBe(badge(state)?.label);
    }
  });
});
