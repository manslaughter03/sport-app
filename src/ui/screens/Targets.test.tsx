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
import { Targets } from "./Targets.tsx";
import { presetsFor } from "../components/QuickAdd.tsx";
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

function renderTargets(): RenderResult {
  const result = renderInto(<Targets ctx={ctx} />);
  mounted.push(result);
  return result;
}

beforeEach(async () => {
  counter += 1;
  const db = createDatabase(`targets-test-${counter}`);
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

function inputFor(testId: string): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

describe("Targets — rendering", () => {
  it("shows the current weekly target for each exercise", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));
    expect(inputFor("target-input-ex-core").value).toBe("3000");
    expect(inputFor("target-input-ex-toe-touch").value).toBe("1000");
  });

  it("shows the active-days target", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-activeDays").value).toBe("4"));
  });

  it("labels the unit per exercise kind", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("unit-ex-pushup").textContent).toContain("reps"));
    expect(screen.getByTestId("unit-ex-core").textContent).toContain("seconds");
  });
});

describe("Targets — saving", () => {
  it("saves a new target by splitting the goal, not mutating it", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "800" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(async () => {
      const goals = await ctx.goals.all();
      const pushupGoals = goals.filter(
        (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
      );
      expect(pushupGoals).toHaveLength(2);
    });

    const goals = await ctx.goals.all();
    const pushupGoals = goals
      .filter((g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup")
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

    // The original row is closed, its target preserved.
    expect(pushupGoals[0]?.target).toBe(700);
    expect(pushupGoals[0]?.effectiveTo).toBe("2026-03-04");
    // The new row opens today.
    expect(pushupGoals[1]?.target).toBe(800);
    expect(pushupGoals[1]?.effectiveFrom).toBe("2026-03-04");
    expect(pushupGoals[1]?.effectiveTo).toBeUndefined();
  });

  it("changes this week's target but leaves last week untouched", async () => {
    // The whole point of goal versioning, exercised through the real UI.
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "800" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(async () => {
      const lastWeek = await ctx.goals.inForce(
        { kind: "exercise", exerciseId: "ex-pushup" },
        "week",
        "2026-03-02", // exclusive end of the week 2026-02-23..03-01
      );
      expect(lastWeek?.target).toBe(700);
    });

    const thisWeek = await ctx.goals.inForce(
      { kind: "exercise", exerciseId: "ex-pushup" },
      "week",
      "2026-03-09",
    );
    expect(thisWeek?.target).toBe(800);
  });

  it("saves the active-days target", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-activeDays").value).toBe("4"));

    fireEvent.input(inputFor("target-input-activeDays"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("save-activeDays"));

    await waitFor(async () => {
      const goal = await ctx.goals.inForce({ kind: "activeDays" }, "week", "2026-03-09");
      expect(goal?.target).toBe(5);
    });
  });

  it("does not write when the value is unchanged", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(async () => {
      const goals = await ctx.goals.all();
      const pushupGoals = goals.filter(
        (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
      );
      expect(pushupGoals).toHaveLength(1);
    });
  });
});

describe("Targets — validation", () => {
  it("rejects zero, negative and non-numeric input", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    for (const bad of ["0", "-5", "", "abc"]) {
      fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: bad } });
      fireEvent.click(screen.getByTestId("save-ex-pushup"));
      await waitFor(() => expect(screen.getByTestId("error-ex-pushup")).toBeTruthy());
    }

    // Nothing was written.
    const goals = await ctx.goals.all();
    expect(
      goals.filter((g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup"),
    ).toHaveLength(1);
  });

  it("rejects a fractional target", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(() => expect(screen.getByTestId("error-ex-pushup")).toBeTruthy());
  });

  it("clears the error once a valid value is saved", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));
    await waitFor(() => expect(screen.getByTestId("error-ex-pushup")).toBeTruthy());

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "900" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(() => expect(screen.queryByTestId("error-ex-pushup")).toBeNull());
  });

  it("confirms a successful save", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-pushup").value).toBe("700"));

    fireEvent.input(inputFor("target-input-ex-pushup"), { target: { value: "750" } });
    fireEvent.click(screen.getByTestId("save-ex-pushup"));

    await waitFor(() => expect(screen.getByTestId("saved-ex-pushup").textContent).toContain("Saved"));
  });
});

describe("Targets — quick-add step", () => {
  it("shows the current step for reps exercises", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("step-input-ex-pushup").value).toBe("5"));
    // Toe Touch is high-volume, so its step is larger.
    expect(inputFor("step-input-ex-toe-touch").value).toBe("50");
  });

  it("does not offer a step for a duration exercise", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("target-input-ex-core").value).toBe("3000"));
    // Core's buttons are fixed second presets (30/60/90), so a step is meaningless.
    expect(screen.queryByTestId("step-input-ex-core")).toBeNull();
  });

  it("saves a new step and the quick-add buttons follow", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("step-input-ex-toe-touch").value).toBe("50"));

    fireEvent.input(inputFor("step-input-ex-toe-touch"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("save-step-ex-toe-touch"));

    await waitFor(async () => {
      const exercises = await ctx.exercises.list();
      expect(exercises.find((e) => e.id === "ex-toe-touch")?.step).toBe(100);
    });

    // The live Today screen now offers +100 / +200.
    renderTargets();
    await waitFor(async () => {
      const updated = await ctx.exercises.get("ex-toe-touch");
      expect(presetsFor(updated!)).toEqual([100, 200]);
    });
  });

  it("changes a step without touching goal history", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("step-input-ex-pushup").value).toBe("5"));

    fireEvent.input(inputFor("step-input-ex-pushup"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("save-step-ex-pushup"));

    await waitFor(async () => {
      expect((await ctx.exercises.get("ex-pushup"))?.step).toBe(25);
    });

    // A step is a UI convenience, not a goal: no split row was created.
    const goals = await ctx.goals.all();
    const pushupGoals = goals.filter(
      (g) => g.scope.kind === "exercise" && g.scope.exerciseId === "ex-pushup",
    );
    expect(pushupGoals).toHaveLength(1);
  });

  it("rejects zero, negative and non-numeric steps", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("step-input-ex-pushup").value).toBe("5"));

    for (const bad of ["0", "-5", "", "abc", "2.5"]) {
      fireEvent.input(inputFor("step-input-ex-pushup"), { target: { value: bad } });
      fireEvent.click(screen.getByTestId("save-step-ex-pushup"));
      await waitFor(() => expect(screen.getByTestId("step-error-ex-pushup")).toBeTruthy());
    }

    // Nothing was written.
    expect((await ctx.exercises.get("ex-pushup"))?.step).toBe(5);
  });
});
