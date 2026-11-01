import { describe, expect, it } from "vitest";
import { evaluate, evaluatePeriods, paceState, remainingDays } from "./progress.ts";
import type { Entry, Exercise, Goal, Settings } from "./types.ts";

const PUSHUP = "ex-pushup";
const CORE = "ex-core";

const settings: Settings = {
  weekStartsOn: 1,
  dayCutoffHour: 0,
  activeDayMinAmount: 1,
  schemaVersion: 1,
};

const exercises: Exercise[] = [
  { id: PUSHUP, name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 },
  { id: CORE, name: "Core", kind: "duration", unit: "s", step: 30, order: 2 },
];

function pushupGoal(target: number, extra: Partial<Goal> = {}): Goal {
  return {
    id: "g-push",
    scope: { kind: "exercise", exerciseId: PUSHUP },
    period: "week",
    target,
    cap: false,
    effectiveFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function activeDaysGoal(target: number): Goal {
  return {
    id: "g-days",
    scope: { kind: "activeDays" },
    period: "week",
    target,
    cap: false,
    effectiveFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

let counter = 0;
function entry(exerciseId: string, day: string, amount: number): Entry {
  counter += 1;
  return {
    id: `e${counter}`,
    exerciseId,
    day,
    amount,
    createdAt: `${day}T12:00:00.000Z`,
  };
}

/** The week 2026-03-02 (Mon) .. 2026-03-08 (Sun), exclusive end 03-09. */
const WEEK = { start: "2026-03-02", end: "2026-03-09" };

describe("volume percentage", () => {
  it("reports 0 % with no entries and a behind pace", () => {
    const report = evaluate(WEEK, [], exercises, [pushupGoal(300)], settings, "2026-03-04");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.achieved).toBe(0);
    expect(push?.volumePct).toBe(0);
    expect(push?.pace).toBe("behind");
  });

  it("sums every set for an exercise", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 20), entry(PUSHUP, "2026-03-02", 15), entry(PUSHUP, "2026-03-04", 12)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-04");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.achieved).toBe(47);
  });

  it("ignores entries for other exercises and other periods", () => {
    const entries = [
      entry(PUSHUP, "2026-03-02", 20),
      entry(CORE, "2026-03-02", 60),
      entry(PUSHUP, "2026-02-25", 999), // previous week
      entry(PUSHUP, "2026-03-09", 999), // exclusive end — next week
    ];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-04");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.achieved).toBe(20);
  });

  it("reports exactly 100 % and done at the target", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 300)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-09");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.volumePct).toBe(100);
    expect(push?.clampedPct).toBe(100);
    expect(push?.pace).toBe("done");
  });

  it("prints 140 % unclamped while clamping the rendered value", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 420)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-09");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.volumePct).toBe(140);
    expect(push?.clampedPct).toBe(100);
  });

  it("treats an aspirational goal (cap: false) above target as achieved, not a warning", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 420)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300, { cap: false })], settings, "2026-03-09");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.pace).toBe("done");
    expect(push?.overCap).toBe(false);
  });

  it("flags over-cap when the goal is a ceiling", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 420)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300, { cap: true })], settings, "2026-03-09");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.overCap).toBe(true);
    expect(push?.pace).toBe("over-cap");
  });

  it("does not flag over-cap when a capped goal is exactly at target", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 300)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300, { cap: true })], settings, "2026-03-09");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    expect(push?.overCap).toBe(false);
    expect(push?.pace).toBe("done");
  });

  it("reports an exercise with no goal as untargeted rather than dividing by zero", () => {
    const entries = [entry(CORE, "2026-03-02", 60)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-04");
    const core = report.exercises.find((e) => e.exerciseId === CORE);
    expect(core?.achieved).toBe(60);
    expect(core?.target).toBeNull();
    expect(core?.volumePct).toBeNull();
    expect(core?.clampedPct).toBe(0);
    expect(core?.pace).toBe("untargeted");
  });
});

describe("regularity — active days", () => {
  it("counts distinct days, not entries", () => {
    // Three sets on one day is one active day.
    const entries = [
      entry(PUSHUP, "2026-03-02", 20),
      entry(PUSHUP, "2026-03-02", 15),
      entry(PUSHUP, "2026-03-02", 12),
    ];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], settings, "2026-03-04");
    expect(report.regularity.activeDays).toBe(1);
    expect(report.regularity.regularityPct).toBe(25);
  });

  it("counts a day active across different exercises", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 20), entry(CORE, "2026-03-02", 60)];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], settings, "2026-03-04");
    expect(report.regularity.activeDays).toBe(1);
  });

  it("reports 100 % when the active-day target is met", () => {
    const entries = [
      entry(PUSHUP, "2026-03-02", 20),
      entry(PUSHUP, "2026-03-03", 20),
      entry(PUSHUP, "2026-03-04", 20),
      entry(PUSHUP, "2026-03-05", 20),
    ];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], settings, "2026-03-05");
    expect(report.regularity.activeDays).toBe(4);
    expect(report.regularity.regularityPct).toBe(100);
  });

  it("does not count a day below activeDayMinAmount", () => {
    const strict: Settings = { ...settings, activeDayMinAmount: 10 };
    const entries = [
      entry(PUSHUP, "2026-03-02", 5), // below threshold
      entry(PUSHUP, "2026-03-03", 10), // at threshold
    ];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], strict, "2026-03-04");
    expect(report.regularity.activeDays).toBe(1);
  });

  it("counts a duration exercise's seconds against the threshold", () => {
    const strict: Settings = { ...settings, activeDayMinAmount: 30 };
    const entries = [entry(CORE, "2026-03-02", 30)];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], strict, "2026-03-04");
    expect(report.regularity.activeDays).toBe(1);
  });

  it("returns null percentages when there is no active-days goal", () => {
    const report = evaluate(WEEK, [], exercises, [pushupGoal(300)], settings, "2026-03-04");
    expect(report.regularity.activeDaysTarget).toBeNull();
    expect(report.regularity.regularityPct).toBeNull();
  });

  it("reports 0 % rather than dividing by zero for a zero target", () => {
    const report = evaluate(WEEK, [], exercises, [activeDaysGoal(0)], settings, "2026-03-04");
    expect(report.regularity.regularityPct).toBeNull();
  });

  it("exposes the list of active days for the 7-day grid", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 20), entry(PUSHUP, "2026-03-05", 20)];
    const report = evaluate(WEEK, entries, exercises, [activeDaysGoal(4)], settings, "2026-03-05");
    expect(report.regularity.activeDayList).toEqual(["2026-03-02", "2026-03-05"]);
  });
});

describe("pace states", () => {
  it("is ahead when well past the linear expectation", () => {
    // Day 2 of 7: expected 300 * 2/7 ≈ 85.7; doing 150 is ahead.
    const entries = [entry(PUSHUP, "2026-03-02", 150)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-03");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.pace).toBe("ahead");
  });

  it("is on-track when close to the linear expectation", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 86)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-03");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.pace).toBe("on-track");
  });

  it("is behind when under the linear expectation", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 20)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-03");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.pace).toBe("behind");
  });

  it("is never ahead/behind once the period is finished and the target is met", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 300)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300)], settings, "2026-03-09");
    expect(report.exercises.find((e) => e.exerciseId === PUSHUP)?.pace).toBe("done");
  });

  it("exposes paceState as a pure helper", () => {
    expect(paceState(300, 300, 1, false)).toBe("done");
    expect(paceState(420, 300, 1, true)).toBe("over-cap");
    expect(paceState(420, 300, 1, false)).toBe("done");
    expect(paceState(0, 300, 0.5, false)).toBe("behind");
    expect(paceState(150, 300, 2 / 7, false)).toBe("ahead");
    expect(paceState(86, 300, 2 / 7, false)).toBe("on-track");
    expect(paceState(0, 0, 0.5, false)).toBe("untargeted");
  });
});

describe("report shape", () => {
  it("includes an exercise row for every exercise, goal or not", () => {
    const report = evaluate(WEEK, [], exercises, [pushupGoal(300)], settings, "2026-03-04");
    expect(report.exercises.map((e) => e.exerciseId)).toEqual([PUSHUP, CORE]);
  });

  it("keeps exercise display order", () => {
    const shuffled: Exercise[] = [
      { id: CORE, name: "Core", kind: "duration", unit: "s", step: 30, order: 2 },
      { id: PUSHUP, name: "Push-up", kind: "reps", unit: "reps", step: 5, order: 1 },
    ];
    const report = evaluate(WEEK, [], shuffled, [], settings, "2026-03-04");
    expect(report.exercises.map((e) => e.exerciseId)).toEqual([PUSHUP, CORE]);
  });

  it("skips archived exercises", () => {
    const withArchived: Exercise[] = [
      ...exercises,
      {
        id: "ex-old",
        name: "Old",
        kind: "reps",
        unit: "reps",
        step: 5,
        order: 3,
        archivedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const report = evaluate(WEEK, [], withArchived, [], settings, "2026-03-04");
    expect(report.exercises.map((e) => e.exerciseId)).toEqual([PUSHUP, CORE]);
  });

  it("carries the range, elapsed fraction and day count", () => {
    const report = evaluate(WEEK, [], exercises, [], settings, "2026-03-04");
    expect(report.range).toEqual(WEEK);
    expect(report.totalDays).toBe(7);
    expect(report.elapsedDays).toBe(3);
    expect(report.elapsedFraction).toBeCloseTo(3 / 7);
    expect(report.today).toBe("2026-03-04");
  });

  it("never emits NaN or Infinity anywhere in the report", () => {
    const entries = [entry(PUSHUP, "2026-03-02", 20)];
    const report = evaluate(WEEK, entries, exercises, [pushupGoal(300), activeDaysGoal(4)], settings, "2026-03-04");
    const numbers = [
      report.elapsedFraction,
      ...report.exercises.flatMap((e) => [e.achieved, e.volumePct ?? 0, e.clampedPct, e.expectedSoFar]),
      report.regularity.activeDays,
      report.regularity.regularityPct ?? 0,
    ];
    for (const n of numbers) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe("period series and remaining days", () => {
  it("evaluates one report per range", () => {
    const ranges = [
      { start: "2026-02-23", end: "2026-03-02" },
      { start: "2026-03-02", end: "2026-03-09" },
    ];
    const entries = [entry(PUSHUP, "2026-02-24", 100), entry(PUSHUP, "2026-03-03", 50)];
    const reports = evaluatePeriods(ranges, entries, exercises, [pushupGoal(300)], settings, "2026-03-04");
    expect(reports).toHaveLength(2);
    expect(reports[0]?.exercises.find((e) => e.exerciseId === PUSHUP)?.achieved).toBe(100);
    expect(reports[1]?.exercises.find((e) => e.exerciseId === PUSHUP)?.achieved).toBe(50);
  });

  it("returns no reports for no ranges", () => {
    expect(evaluatePeriods([], [], exercises, [], settings, "2026-03-04")).toEqual([]);
  });

  it("lists the days still ahead", () => {
    expect(remainingDays(WEEK, "2026-03-04")).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
  });

  it("has no remaining days once the period is over", () => {
    expect(remainingDays(WEEK, "2026-03-09")).toEqual([]);
    expect(remainingDays(WEEK, "2026-04-01")).toEqual([]);
  });
});

describe("defensive guards", () => {
  it("treats a non-finite elapsed fraction as behind, never NaN", () => {
    expect(paceState(0, 300, Number.NaN, false)).toBe("behind");
    expect(paceState(0, 300, Number.POSITIVE_INFINITY, false)).toBe("behind");
  });

  it("clamps a non-finite percentage to 0 instead of emitting NaN", () => {
    const report = evaluate(WEEK, [], exercises, [pushupGoal(300)], settings, "2026-03-04");
    const push = report.exercises.find((e) => e.exerciseId === PUSHUP);
    // The public surface must never leak NaN into a ring width.
    expect(Number.isFinite(push?.clampedPct ?? Number.NaN)).toBe(true);
    expect(push?.clampedPct).toBe(0);
  });
});
