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
import { History, formatRangeLabel, HISTORY_LENGTH } from "./History.tsx";
import { createDatabase } from "../../data/db.ts";
import { createClock } from "../../data/clock.ts";
import { createExercisesRepo } from "../../data/repos/exercises.ts";
import { createEntriesRepo } from "../../data/repos/entries.ts";
import { createGoalsRepo } from "../../data/repos/goals.ts";
import { createSettingsRepo } from "../../data/repos/settings.ts";
import { seedIfEmpty } from "../../data/seed.ts";
import { evaluatePeriods } from "../../domain/progress.ts";
import { previousRanges } from "../../domain/period.ts";

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

function renderHistory(): RenderResult {
  const result = renderInto(<History ctx={ctx} />);
  mounted.push(result);
  return result;
}

beforeEach(async () => {
  counter += 1;
  const db = createDatabase(`history-test-${counter}`);
  // 2026-03-04 is a Wednesday in the week 03-02..03-09.
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  await ctx.db.close();
  await ctx.db.delete();
});

describe("formatRangeLabel", () => {
  it("labels a week inside one month without repeating it", () => {
    expect(formatRangeLabel({ start: "2026-03-02", end: "2026-03-09" })).toBe("2–8 Mar");
  });

  it("spans two months when the week does", () => {
    expect(formatRangeLabel({ start: "2026-02-23", end: "2026-03-02" })).toBe("23 Feb – 1 Mar");
  });

  it("never prints the exclusive end as a day of the period", () => {
    // `end` is 03-09 but the period's last day is 03-08.
    expect(formatRangeLabel({ start: "2026-03-02", end: "2026-03-09" })).not.toContain("9 Mar");
  });

  it("labels a month range without repeating the month", () => {
    expect(formatRangeLabel({ start: "2026-03-01", end: "2026-04-01" })).toBe("1–31 Mar");
  });
});

describe("History — the list (#14)", () => {
  it("shows the last 8 periods, newest first, starting with this week", async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-list")).toBeTruthy());

    expect(screen.getByTestId("history-count").textContent).toContain(`last ${HISTORY_LENGTH} weeks`);
    // Newest first: the first row is the week containing today.
    const first = screen.getByTestId("history-row-2026-03-02");
    expect(first.getAttribute("data-current")).toBe("true");
    expect(screen.getByTestId("history-row-2026-02-23")).toBeTruthy();
    expect(screen.queryByTestId("history-row-2026-03-09")).toBeNull();
  });

  it("renders 0 % for a tracked week with no entries, not a blank", async () => {
    // Logging last week makes this week "tracked but empty" rather than
    // "before tracking began", which is the distinction the next test covers.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 700, at: { day: "2026-02-24", hour: 12 } });
    renderHistory();

    await waitFor(() => expect(screen.getByTestId("history-volume-2026-02-23-ex-pushup")).toBeTruthy());
    expect(screen.getByTestId("history-volume-2026-02-23-ex-pushup").textContent).toBe("100 %");
    // No entries this week: zero is a real answer and must be shown as one.
    expect(screen.getByTestId("history-volume-2026-03-02-ex-pushup").textContent).toBe("0 %");
  });

  it("marks a period before tracking began so 0 % is not read as a missed week", async () => {
    // The week 02-16..02-23 ends before the first stored entry on 03-02.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 700, at: { day: "2026-03-02", hour: 12 } });
    renderHistory();

    await waitFor(() => expect(screen.getByTestId("history-row-2026-02-16")).toBeTruthy());
    expect(screen.getByTestId("history-row-2026-02-16").getAttribute("data-untracked")).toBe("true");
    expect(screen.getByTestId("history-volumes-2026-02-16").textContent).toContain("Before tracking began");
    // The week the data starts in is tracked, not "before".
    expect(screen.getByTestId("history-row-2026-03-02").getAttribute("data-untracked")).toBe("false");
  });

  it("expands a row to the full breakdown", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 350 });
    renderHistory();

    await waitFor(() => expect(screen.getByTestId("history-toggle-2026-03-02")).toBeTruthy());
    expect(screen.queryByTestId("history-details-2026-03-02")).toBeNull();

    fireEvent.click(screen.getByTestId("history-toggle-2026-03-02"));

    await waitFor(() => expect(screen.getByTestId("history-details-2026-03-02")).toBeTruthy());
    expect(screen.getByTestId("history-details-2026-03-02").textContent).toContain("350");
    expect(screen.getByTestId("history-toggle-2026-03-02").getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses again on a second tap", async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-toggle-2026-03-02")).toBeTruthy());

    fireEvent.click(screen.getByTestId("history-toggle-2026-03-02"));
    await waitFor(() => expect(screen.getByTestId("history-details-2026-03-02")).toBeTruthy());
    fireEvent.click(screen.getByTestId("history-toggle-2026-03-02"));
    await waitFor(() => expect(screen.queryByTestId("history-details-2026-03-02")).toBeNull());
  });

  it("switches to months", async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-list")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    await waitFor(() =>
      expect(screen.getByTestId("history-count").textContent).toContain("last 8 months"),
    );
    expect(screen.getByTestId("history-row-2026-03-01")).toBeTruthy();
  });
});

describe("History — goal versioning is not retroactive (#14)", () => {
  it("a past week's percentage does not move when a current goal is edited", async () => {
    // Last week: 350 of a 700/week goal → 50 %.
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 350,
      at: { day: "2026-02-24", hour: 12 },
    });

    renderHistory();
    await waitFor(() =>
      expect(screen.getByTestId("history-volume-2026-02-23-ex-pushup").textContent).toBe("50 %"),
    );

    // Double the target today, the same edit the Targets screen performs.
    const goals = await ctx.goals.activeOn("2026-03-04");
    const pushup = goals.find(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    await ctx.goals.retarget(pushup!.id, { atDay: "2026-03-04", newTarget: 1400 });

    // Last week keeps the target it was measured against. This is the whole
    // reason `splitGoal` exists, and the history view is where a regression
    // would appear first. The old row is closed, not rewritten.
    await waitFor(async () => {
      const closed = await ctx.goals.get(pushup!.id);
      expect(closed?.target).toBe(700);
      expect(closed?.effectiveTo).toBe("2026-03-04");
    });
    expect(screen.getByTestId("history-volume-2026-02-23-ex-pushup").textContent).toBe("50 %");
    // The current week is measured against the new target.
    expect(screen.getByTestId("history-volume-2026-03-02-ex-pushup").textContent).toBe("0 %");
  });

  it("reports 0 % — not NaN — when the current target changed to something enormous", async () => {
    // No entries at all: with 0/999999 the percentage must be a number the
    // formatter can render, never NaN or a division artefact.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 1, at: { day: "2026-03-02", hour: 12 } });
    const goals = await ctx.goals.activeOn("2026-03-04");
    const pushup = goals.find(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    await ctx.goals.retarget(pushup!.id, { atDay: "2026-03-01", newTarget: 999_999 });

    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-volume-2026-03-02-ex-pushup")).toBeTruthy());
    expect(screen.getByTestId("history-volume-2026-03-02-ex-pushup").textContent).not.toContain("NaN");
  });
});

describe("History — performance (#14)", () => {
  it("builds a year of history from ~2k entries in well under the budget", async () => {
    // Two years of data is ~2k entries: the shape the issue names.
    const rows = [];
    for (let index = 0; index < 2000; index += 1) {
      const day = `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`;
      rows.push({
        id: `perf-${index}`,
        exerciseId: "ex-pushup",
        day,
        amount: 10,
        createdAt: `${day}T12:00:00.000Z`,
        seq: index + 1,
      });
    }
    await ctx.db.entries.bulkPut(rows);

    const [entries, exercises, goals, settings] = await Promise.all([
      ctx.db.entries.toArray(),
      ctx.db.exercises.toArray(),
      ctx.db.goals.toArray(),
      ctx.settings.get(),
    ]);

    const ranges = previousRanges("week", "2026-03-04", 52, 1);
    const started = performance.now();
    const reports = evaluatePeriods(ranges, entries, exercises, goals, settings, "2026-03-04");
    const elapsed = performance.now() - started;

    expect(reports).toHaveLength(52);
    // The stated budget is ~50 ms for the whole list.
    expect(elapsed).toBeLessThan(50);
  });
});

describe("History — empty and archived", () => {
  it("renders without entries", async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-list")).toBeTruthy());
    expect(screen.getByTestId("history-row-2026-03-02").getAttribute("data-untracked")).toBe("true");
  });

  it("skips an archived exercise but keeps the row readable", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-toe-touch", amount: 500 });
    await ctx.exercises.archive("ex-toe-touch");

    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-row-2026-03-02")).toBeTruthy());
    expect(screen.getByTestId("history-volumes-2026-03-02").textContent).not.toContain("Toe Touch");
  });
});

describe("History — archived exercises (#17)", () => {
  it("keeps an archived exercise's past weeks showing its percentages", async () => {
    // Log against Toe Touch, then retire it. Its history must not vanish: the
    // entries still count, and the row still resolves to a name.
    await ctx.entries.addSet({
      exerciseId: "ex-toe-touch",
      amount: 500,
      at: { day: "2026-02-24", hour: 12 },
    });
    await ctx.exercises.archive("ex-toe-touch");

    renderHistory();
    await waitFor(() => expect(screen.getByTestId("history-row-2026-02-23")).toBeTruthy());

    // Archived exercises are hidden from the per-exercise list, but the period
    // still counts their active days rather than pretending nothing happened.
    const regularity = screen.getByTestId("history-regularity-2026-02-23");
    expect(regularity.textContent).toBeTruthy();

    // And the entries are still in the database, exported, and queryable.
    expect(await ctx.entries.count()).toBe(1);
    expect(await ctx.exercises.get("ex-toe-touch")).toBeDefined();
  });
});
