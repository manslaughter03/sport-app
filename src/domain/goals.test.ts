import { describe, expect, it } from "vitest";
import { activeGoals, goalInForce, goalKey, isInForce, scopesEqual, splitGoal } from "./goals.ts";
import type { Goal, GoalScope } from "./types.ts";

const pushup: GoalScope = { kind: "exercise", exerciseId: "ex-pushup" };
const core: GoalScope = { kind: "exercise", exerciseId: "ex-core" };
const activeDays: GoalScope = { kind: "activeDays" };

function makeGoal(partial: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    scope: pushup,
    period: "week",
    target: 300,
    cap: false,
    effectiveFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/**
 * A week range and the day the goal is selected on. `goalInForce` takes the
 * exclusive range end and selects at the period's last day, so these helpers
 * keep the tests readable.
 */
/** Exclusive end of the week 2026-03-02 .. 2026-03-08. */
const WEEK_END = "2026-03-09";

describe("scope helpers", () => {
  it("compares scopes by kind and exercise id", () => {
    expect(scopesEqual(pushup, { kind: "exercise", exerciseId: "ex-pushup" })).toBe(true);
    expect(scopesEqual(pushup, core)).toBe(false);
    expect(scopesEqual(activeDays, { kind: "activeDays" })).toBe(true);
    expect(scopesEqual(pushup, activeDays)).toBe(false);
  });

  it("keys a scope + period, so week and month goals never collide", () => {
    expect(goalKey(pushup, "week")).toBe("exercise:ex-pushup:week");
    expect(goalKey(pushup, "month")).toBe("exercise:ex-pushup:month");
    expect(goalKey(activeDays, "week")).toBe("activeDays:week");
    expect(goalKey(pushup, "week")).not.toBe(goalKey(pushup, "month"));
  });
});

describe("isInForce — half-open [effectiveFrom, effectiveTo)", () => {
  it("is in force from its start day onward when open-ended", () => {
    const g = makeGoal({ effectiveFrom: "2026-01-01" });
    expect(isInForce(g, "2026-01-01")).toBe(true);
    expect(isInForce(g, "2027-06-01")).toBe(true);
  });

  it("is not in force before it starts", () => {
    expect(isInForce(makeGoal({ effectiveFrom: "2026-01-01" }), "2025-12-31")).toBe(false);
  });

  it("excludes the effectiveTo day itself", () => {
    const g = makeGoal({ effectiveFrom: "2026-01-01", effectiveTo: "2026-03-04" });
    expect(isInForce(g, "2026-03-03")).toBe(true);
    expect(isInForce(g, "2026-03-04")).toBe(false);
  });
});

describe("goalInForce — selects at the end of the evaluated period", () => {
  it("returns undefined when there are no goals", () => {
    expect(goalInForce([], pushup, "week", WEEK_END)).toBeUndefined();
  });

  it("returns the single open-ended goal", () => {
    const g = makeGoal();
    expect(goalInForce([g], pushup, "week", WEEK_END)).toBe(g);
  });

  it("ignores a goal that was retired before the period ended", () => {
    const old = makeGoal({ id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01" });
    expect(goalInForce([old], pushup, "week", WEEK_END)).toBeUndefined();
  });

  it("ignores a goal that starts after the period ended", () => {
    const future = makeGoal({ effectiveFrom: "2026-06-01" });
    expect(goalInForce([future], pushup, "week", WEEK_END)).toBeUndefined();
  });

  it("ignores goals for a different exercise", () => {
    const coreGoal = makeGoal({ scope: core });
    expect(goalInForce([coreGoal], pushup, "week", WEEK_END)).toBeUndefined();
  });

  it("ignores goals for a different period", () => {
    const monthly = makeGoal({ period: "month", target: 1200 });
    expect(goalInForce([monthly], pushup, "week", WEEK_END)).toBeUndefined();
    expect(goalInForce([monthly], pushup, "month", "2026-04-01")).toBe(monthly);
  });

  it("picks the newer goal when a change lands mid-period", () => {
    // The whole week is judged by the goal in force at its END (architecture §2.2).
    const old = makeGoal({ id: "old", target: 300, effectiveTo: "2026-03-04" });
    const raised = makeGoal({
      id: "raised",
      target: 350,
      effectiveFrom: "2026-03-04",
      createdAt: "2026-03-04T00:00:00.000Z",
    });
    expect(goalInForce([old, raised], pushup, "week", WEEK_END)?.target).toBe(350);
  });

  it("does not let a later change rewrite an earlier period", () => {
    // The headline requirement: raising the target in March must leave
    // February's percentage untouched.
    const [january] = splitGoal(makeGoal({ target: 300 }), {
      atDay: "2026-03-04",
      newTarget: 350,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });
    const raised = makeGoal({
      id: "g2",
      target: 350,
      effectiveFrom: "2026-03-04",
      createdAt: "2026-03-04T10:00:00.000Z",
    });
    const history = [january, raised];

    // February week: 2026-02-23 .. 2026-03-02 (last day 03-01).
    expect(goalInForce(history, pushup, "week", "2026-03-02")?.target).toBe(300);
    // March week: 2026-03-02 .. 2026-03-09 (last day 03-08).
    expect(goalInForce(history, pushup, "week", WEEK_END)?.target).toBe(350);
  });

  it("treats effectiveFrom on the last day as in force", () => {
    const g = makeGoal({ effectiveFrom: "2026-03-08" });
    expect(goalInForce([g], pushup, "week", WEEK_END)).toBe(g);
  });

  it("treats effectiveTo on the last day as already retired", () => {
    const g = makeGoal({ effectiveFrom: "2026-01-01", effectiveTo: "2026-03-08" });
    expect(goalInForce([g], pushup, "week", WEEK_END)).toBeUndefined();
  });

  it("prefers the most recent effectiveFrom when rows overlap", () => {
    // Should never happen with well-formed data, but the tie-break must be defined.
    const older = makeGoal({ id: "older", target: 300, effectiveFrom: "2026-01-01" });
    const newer = makeGoal({
      id: "newer",
      target: 500,
      effectiveFrom: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    expect(goalInForce([older, newer], pushup, "week", WEEK_END)?.id).toBe("newer");
    expect(goalInForce([newer, older], pushup, "week", WEEK_END)?.id).toBe("newer");
  });

  it("selects activeDays goals independently of exercises", () => {
    const days = makeGoal({ scope: activeDays, target: 4 });
    const push = makeGoal({ target: 300 });
    expect(goalInForce([days, push], activeDays, "week", WEEK_END)?.target).toBe(4);
    expect(goalInForce([days, push], pushup, "week", WEEK_END)?.target).toBe(300);
  });
});

describe("splitGoal — versioning without data loss", () => {
  const original = makeGoal({ id: "g1", target: 300, effectiveFrom: "2026-01-01" });

  it("closes the old row at the split day and opens a new one", () => {
    const [closed, opened] = splitGoal(original, {
      atDay: "2026-03-04",
      newTarget: 350,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });

    expect(closed.id).toBe("g1");
    expect(closed.target).toBe(300);
    expect(closed.effectiveTo).toBe("2026-03-04");

    expect(opened.id).toBe("g2");
    expect(opened.target).toBe(350);
    expect(opened.effectiveFrom).toBe("2026-03-04");
    expect(opened.effectiveTo).toBeUndefined();
  });

  it("keeps the two rows adjacent and non-overlapping", () => {
    const [closed, opened] = splitGoal(original, {
      atDay: "2026-03-04",
      newTarget: 350,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });
    expect(closed.effectiveTo).toBe(opened.effectiveFrom);
    // No day is covered twice, none is skipped.
    for (const day of ["2026-02-28", "2026-03-03"]) {
      expect(isInForce(closed, day)).toBe(true);
      expect(isInForce(opened, day)).toBe(false);
    }
    for (const day of ["2026-03-04", "2026-04-01"]) {
      expect(isInForce(closed, day)).toBe(false);
      expect(isInForce(opened, day)).toBe(true);
    }
  });

  it("carries over scope, period and cap", () => {
    const capped = makeGoal({ cap: true, period: "month", scope: core });
    const [, opened] = splitGoal(capped, {
      atDay: "2026-03-04",
      newTarget: 40,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });
    expect(opened.scope).toEqual(core);
    expect(opened.period).toBe("month");
    expect(opened.cap).toBe(true);
  });

  it("preserves the original target losslessly", () => {
    const [closed] = splitGoal(original, {
      atDay: "2026-03-04",
      newTarget: 999,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });
    expect(closed.target).toBe(300);
  });

  it("can split the new row again", () => {
    const [, second] = splitGoal(original, {
      atDay: "2026-03-04",
      newTarget: 350,
      newId: "g2",
      now: "2026-03-04T10:00:00.000Z",
    });
    const [secondClosed, third] = splitGoal(second, {
      atDay: "2026-04-01",
      newTarget: 400,
      newId: "g3",
      now: "2026-04-01T10:00:00.000Z",
    });
    expect(secondClosed.effectiveTo).toBe("2026-04-01");
    expect(third.effectiveFrom).toBe("2026-04-01");
    expect(third.target).toBe(400);
  });

  it("rejects a split at or before the start (it would create an empty row)", () => {
    const options = { newTarget: 350, newId: "g2", now: "2026-03-04T10:00:00.000Z" };
    expect(() => splitGoal(original, { ...options, atDay: "2026-01-01" })).toThrow(/after/i);
    expect(() => splitGoal(original, { ...options, atDay: "2025-12-01" })).toThrow(/after/i);
  });

  it("rejects a split at or after an existing effectiveTo", () => {
    const retired = makeGoal({ effectiveFrom: "2026-01-01", effectiveTo: "2026-03-04" });
    const options = { newTarget: 350, newId: "g2", now: "2026-03-04T10:00:00.000Z" };
    expect(() => splitGoal(retired, { ...options, atDay: "2026-03-04" })).toThrow(/retired|before/i);
    expect(() => splitGoal(retired, { ...options, atDay: "2026-04-01" })).toThrow(/retired|before/i);
  });

  it("rejects a non-positive or non-integer target", () => {
    const base = { atDay: "2026-03-04", newId: "g2", now: "2026-03-04T10:00:00.000Z" };
    expect(() => splitGoal(original, { ...base, newTarget: 0 })).toThrow(/positive/i);
    expect(() => splitGoal(original, { ...base, newTarget: -5 })).toThrow(/positive/i);
    expect(() => splitGoal(original, { ...base, newTarget: 12.5 })).toThrow(/integer/i);
    expect(() => splitGoal(original, { ...base, newTarget: Number.NaN })).toThrow();
  });
});

describe("activeGoals — one goal per scope and period", () => {
  const pushWeek = makeGoal({ id: "pw", target: 300 });
  const pushMonth = makeGoal({
    id: "pm",
    period: "month",
    target: 1200,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const daysWeek = makeGoal({ id: "dw", scope: activeDays, target: 4 });

  it("returns nothing when no goal is in force", () => {
    expect(activeGoals([], "2026-03-04")).toEqual([]);
  });

  it("returns both the weekly and monthly goal for the same exercise (O2)", () => {
    const result = activeGoals([pushWeek, pushMonth], "2026-03-04");
    expect(result.map((g) => g.id).sort()).toEqual(["pm", "pw"]);
  });

  it("returns one goal per scope and period", () => {
    const result = activeGoals([pushWeek, pushMonth, daysWeek], "2026-03-04");
    expect(result).toHaveLength(3);
    const keys = result.map((g) => goalKey(g.scope, g.period));
    expect(new Set(keys).size).toBe(3);
  });

  it("excludes retired and not-yet-started goals", () => {
    const retired = makeGoal({ id: "r", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01" });
    const future = makeGoal({ id: "f", effectiveFrom: "2026-06-01" });
    expect(activeGoals([retired, future], "2026-03-04")).toEqual([]);
  });

  it("keeps the newest row when a scope has a version history", () => {
    const old = makeGoal({ id: "old", target: 300, effectiveFrom: "2026-01-01", effectiveTo: "2026-03-04" });
    const current = makeGoal({
      id: "current",
      target: 350,
      effectiveFrom: "2026-03-04",
      createdAt: "2026-03-04T10:00:00.000Z",
    });
    const result = activeGoals([old, current], "2026-03-04");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("current");
  });
});

describe("activeGoals — tie-break on overlapping rows", () => {
  it("prefers the newer effectiveFrom regardless of array order", () => {
    const older = makeGoal({ id: "older", target: 300, effectiveFrom: "2026-01-01" });
    const newer = makeGoal({
      id: "newer",
      target: 500,
      effectiveFrom: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    expect(activeGoals([older, newer], "2026-03-04").map((g) => g.id)).toEqual(["newer"]);
    expect(activeGoals([newer, older], "2026-03-04").map((g) => g.id)).toEqual(["newer"]);
  });
});
