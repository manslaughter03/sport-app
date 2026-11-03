// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render as renderInto,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/preact";
import { createApp, type AppContext } from "../app.ts";
import { Progress } from "./Progress.tsx";
import { createDatabase } from "../../data/db.ts";
import { createClock } from "../../data/clock.ts";
import { createExercisesRepo } from "../../data/repos/exercises.ts";
import { createEntriesRepo } from "../../data/repos/entries.ts";
import { createGoalsRepo } from "../../data/repos/goals.ts";
import { createSettingsRepo } from "../../data/repos/settings.ts";
import { seedIfEmpty } from "../../data/seed.ts";

let counter = 0;
let ctx: AppContext;

function clockAt(day: string, hour = 12) {
  return createClock(() => ({
    day,
    hour,
    instant: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  }));
}

const mounted: RenderResult[] = [];

function renderProgress(): RenderResult {
  const result = renderInto(<Progress ctx={ctx} />);
  mounted.push(result);
  return result;
}

beforeEach(async () => {
  counter += 1;
  const db = createDatabase(`progress-test-${counter}`);
  // 2026-03-04 is a Wednesday: day 3 of the week starting Monday 03-02.
  const clock = clockAt("2026-03-04");
  const settings = createSettingsRepo(db);
  ctx = createApp({
    db,
    clock,
    settings,
    exercises: createExercisesRepo(db, clock),
    entries: createEntriesRepo(db, clock, settings),
    goals: createGoalsRepo(db, clock),
  });
  await seedIfEmpty(db, clock);
});

afterEach(async () => {
  for (const result of mounted.splice(0)) result.unmount();
  cleanup();
  // See Today.test.tsx: pending liveQuery writes must settle before close.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await ctx.db.close();
  await ctx.db.delete();
});

describe("Progress — volume per exercise", () => {
  it("lists every exercise with its percentage", async () => {
    // 70 / 700 = 10 %, 600 / 3000 = 20 %.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 70 });
    await ctx.entries.addSet({ exerciseId: "ex-core", amount: 600 });

    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("10 %"),
    );
    expect(screen.getByTestId("volume-ex-core").textContent).toContain("20 %");
    expect(screen.getByTestId("volume-ex-toe-touch").textContent).toContain("0 %");
  });

  it("shows achieved against target", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 70 });

    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("achieved-ex-pushup").textContent).toContain("70"),
    );
    expect(screen.getByTestId("target-ex-pushup").textContent).toContain("700");
  });

  it("renders zeros, not NaN, for an empty week", async () => {
    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("0 %"),
    );
    expect(screen.getByTestId("volume-ex-pushup").textContent).not.toContain("NaN");
    expect(screen.getByTestId("regularity").textContent).not.toContain("NaN");
  });

  it("prints an unclamped percentage above target", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 980 });

    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("140 %"),
    );
  });
});

describe("Progress — regularity", () => {
  it("shows active days against the target", async () => {
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-02", hour: 12 },
    });
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-03", hour: 12 },
    });
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-04", hour: 12 },
    });

    renderProgress();
    await waitFor(() => {
      const text = screen.getByTestId("regularity").textContent ?? "";
      expect(text).toContain("3 of 4");
    });
  });

  it("shows 100 % once the active-day target is met", async () => {
    for (const day of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
      await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20, at: { day, hour: 12 } });
    }

    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("regularity-pct").textContent).toContain("100 %"),
    );
  });

  it("counts three sets in one day as one active day", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 15 });
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 12 });

    renderProgress();
    await waitFor(() => {
      const text = screen.getByTestId("regularity").textContent ?? "";
      expect(text).toContain("1 of 4");
    });
  });
});

describe("Progress — 7-day grid", () => {
  it("renders one cell per day of the week", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("day-grid")).toBeTruthy());
    expect(screen.getAllByTestId(/^day-cell-/).length).toBe(7);
  });

  it("marks active days", async () => {
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-02", hour: 12 },
    });
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-05", hour: 12 },
    });

    renderProgress();
    await waitFor(() => {
      expect(screen.getByTestId("day-cell-2026-03-02").getAttribute("data-active")).toBe("true");
    });
    expect(screen.getByTestId("day-cell-2026-03-05").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("day-cell-2026-03-03").getAttribute("data-active")).toBe("false");
  });

  it("marks today and future days distinctly", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("day-cell-2026-03-04")).toBeTruthy());
    expect(screen.getByTestId("day-cell-2026-03-04").getAttribute("data-today")).toBe("true");
    expect(screen.getByTestId("day-cell-2026-03-06").getAttribute("data-future")).toBe("true");
    expect(screen.getByTestId("day-cell-2026-03-02").getAttribute("data-future")).toBe("false");
  });

  it("shows the weekday initial", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("day-cell-2026-03-02").textContent).toContain("M"));
  });
});

describe("Progress — partial period", () => {
  it("shows the day position so a small percentage is not misread", async () => {
    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("day-position").textContent).toContain("3 of 7"),
    );
  });
});

describe("Progress — navigation", () => {
  it("offers a working week/month switcher, defaulting to week", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("period-switcher")).toBeTruthy());
    const week = screen.getByRole("button", { name: "Week" }) as HTMLButtonElement;
    const month = screen.getByRole("button", { name: "Month" }) as HTMLButtonElement;
    expect(week.getAttribute("aria-pressed")).toBe("true");
    expect(month.disabled).toBe(false);
  });

  it("renders without crashing when there are no exercises", async () => {
    await ctx.db.exercises.clear();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("regularity")).toBeTruthy());
  });

  it("re-reads when a set is logged elsewhere (liveQuery)", async () => {
    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("0 %"),
    );

    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 350 });

    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("50 %"),
    );
  });
});

describe("Progress — month view (#12)", () => {
  it("evaluates monthRange and says which day of the month it is", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("period-switcher")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // 2026-03-04 → day 4 of 31, not `day 3 of 7` and not a bare percentage.
    await waitFor(() =>
      expect(screen.getByTestId("day-position").textContent).toContain("4 of 31"),
    );
    expect(screen.getByTestId("month-grid")).toBeTruthy();
    expect(screen.queryByTestId("day-grid")).toBeNull();
  });

  it("reports against the monthly goal, not the weekly one", async () => {
    // Both rows coexist for push-ups: 700/week AND 3000/month.
    await ctx.goals.create({
      scope: { kind: "exercise", exerciseId: "ex-pushup" },
      period: "month",
      target: 3000,
      cap: false,
      effectiveFrom: "2026-01-01",
    });
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 1500 });

    renderProgress();
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("214.3 %"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // 1500 / 3000 = 50 % on the month, versus a clamped weekly reading before.
    await waitFor(() =>
      expect(screen.getByTestId("volume-ex-pushup").textContent).toContain("50 %"),
    );
    // The month's target is what the row is measured against. `formatAmountCompact`
    // groups thousands with a thin space, so assert on the digits.
    expect(screen.getByTestId("target-ex-pushup").textContent).toMatch(/3\s000/);
  });

  it("toggles back to the week without losing the screen", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("period-switcher")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(screen.getByTestId("month-grid")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => expect(screen.getByTestId("day-grid")).toBeTruthy());
    expect(screen.getByTestId("day-position").textContent).toContain("3 of 7");
  });

  it("marks each day of the month and honours a Sunday week start", async () => {
    await ctx.settings.update({ weekStartsOn: 7 });
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20, at: { day: "2026-03-01", hour: 12 } });

    renderProgress();
    await waitFor(() => expect(screen.getByTestId("period-switcher")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    await waitFor(() => expect(screen.getByTestId("month-grid")).toBeTruthy());
    // 2026-03-01 is a Sunday and an active day; 03-02 is neither.
    expect(screen.getByTestId("month-cell-2026-03-01").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("month-cell-2026-03-02").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("month-cell-2026-03-04").getAttribute("data-today")).toBe("true");
  });

  it("shows every day of a 31-day month", async () => {
    renderProgress();
    await waitFor(() => expect(screen.getByTestId("period-switcher")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    await waitFor(() => expect(screen.getByTestId("month-cell-2026-03-31")).toBeTruthy());
    expect(screen.getByTestId("month-cell-2026-03-01")).toBeTruthy();
    // February ends at 28 in 2026, so no cell may leak across the boundary.
    expect(screen.queryByTestId("month-cell-2026-02-28")).toBeNull();
    expect(screen.queryByTestId("month-cell-2026-04-01")).toBeNull();
  });
});
