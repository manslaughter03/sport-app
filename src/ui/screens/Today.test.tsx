// @vitest-environment jsdom
// jsdom ships no IndexedDB, so the fake must be installed before any Dexie
// database is constructed.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createApp, type AppContext } from "../app.ts";
import { Today } from "./Today.tsx";
import { createDatabase } from "../../data/db.ts";
import { createClock } from "../../data/clock.ts";
import { createExercisesRepo } from "../../data/repos/exercises.ts";
import { createEntriesRepo } from "../../data/repos/entries.ts";
import { createGoalsRepo } from "../../data/repos/goals.ts";
import { createSettingsRepo } from "../../data/repos/settings.ts";
import { seedIfEmpty } from "../../data/seed.ts";

let dbName: string;
let counter = 0;
let ctx: AppContext;

function fixedClock(day = "2026-03-04", hour = 12) {
  return createClock(() => ({
    day,
    hour,
    instant: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  }));
}

beforeEach(async () => {
  counter += 1;
  dbName = `ui-test-${counter}`;
  const db = createDatabase(dbName);
  const clock = fixedClock();
  const settings = createSettingsRepo(db);
  const exercises = createExercisesRepo(db, clock);
  const entries = createEntriesRepo(db, clock, settings);
  const goals = createGoalsRepo(db, clock);

  ctx = createApp({ db, clock, settings, exercises, entries, goals });
  await seedIfEmpty(db, clock);
});

afterEach(async () => {
  cleanup();
  await ctx.db.delete();
});

describe("Today — rendering", () => {
  it("lists the seeded exercises", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());
    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.getByText("Toe Touch")).toBeTruthy();
  });

  it("shows zero for today when nothing is logged", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("renders reps buttons for a reps exercise and duration buttons for a duration exercise", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    const pushup = screen.getByTestId("exercise-ex-pushup");
    expect(pushup.textContent).toContain("+5");
    expect(pushup.textContent).toContain("+10");

    const core = screen.getByTestId("exercise-ex-core");
    expect(core.textContent).toContain(":30");
    expect(core.textContent).toContain(":60");
    expect(core.textContent).toContain(":90");
  });
});

describe("Today — quick add", () => {
  it("writes one entry per tap with the right exercise and amount", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 5 reps to Push-up"));

    await waitFor(async () => {
      const rows = await ctx.entries.forDay("2026-03-04");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.exerciseId).toBe("ex-pushup");
      expect(rows[0]?.amount).toBe(5);
    });
  });

  it("updates the today total without a manual refresh (liveQuery)", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    await waitFor(() => {
      const pushup = screen.getByTestId("exercise-ex-pushup");
      expect(pushup.textContent).toContain("10");
    });
  });

  it("accumulates taps", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 5 reps to Push-up"));

    await waitFor(async () => {
      const rows = await ctx.entries.forDay("2026-03-04");
      const total = rows.reduce((sum, r) => sum + r.amount, 0);
      expect(total).toBe(25);
    });
  });

  it("writes seconds for a duration preset", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 60 seconds to Core"));

    await waitFor(async () => {
      const rows = await ctx.entries.forDay("2026-03-04");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.exerciseId).toBe("ex-core");
      expect(rows[0]?.amount).toBe(60);
    });
  });

  it("shows the duration total compactly in the quick-add row", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 90 seconds to Core"));
    fireEvent.click(screen.getByLabelText("Add 60 seconds to Core"));

    // The row is tight, so it uses the compact form (m:ss).
    await waitFor(() => {
      const core = screen.getByTestId("exercise-ex-core");
      expect(core.textContent).toContain("2:30");
    });
  });
});

describe("Today — undo", () => {
  it("removes exactly one set", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));

    await waitFor(async () => {
      expect(await ctx.entries.forDay("2026-03-04")).toHaveLength(2);
    });

    fireEvent.click(screen.getByLabelText("Undo last set for Push-up"));

    await waitFor(async () => {
      expect(await ctx.entries.forDay("2026-03-04")).toHaveLength(1);
    });
  });

  it("is disabled when there is nothing to undo", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());
    const undo = screen.getByLabelText("Undo last set for Push-up") as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
  });
});

describe("Today — weekly ring", () => {
  it("shows the weekly percentage against the goal", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Push-up")).toBeTruthy());

    // 70 of 700 is 10 %.
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));
    fireEvent.click(screen.getByLabelText("Add 10 reps to Push-up"));

    await waitFor(() => {
      const ring = screen.getByTestId("ring-ex-pushup");
      expect(ring.textContent).toContain("10 %");
    });
  });

  it("prints an unclamped percentage while clamping the ring width", async () => {
    // Pre-load more than the weekly target: 700 * 1.4 = 980.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 980 });

    render(<Today ctx={ctx} />);
    await waitFor(() => {
      const ring = screen.getByTestId("ring-ex-pushup");
      expect(ring.textContent).toContain("140 %");
    });

    const bar = screen.getByTestId("ringbar-ex-pushup");
    // Width is clamped to 100 %, never 140 %.
    expect(bar.getAttribute("data-width")).toBe("100");
  });

  it("shows the period day position so a small number is not misread", async () => {
    render(<Today ctx={ctx} />);
    await waitFor(() => {
      expect(screen.getByTestId("day-position").textContent).toContain("3 of 7");
    });
  });
});
