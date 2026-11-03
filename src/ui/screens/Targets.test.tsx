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
import { weekRange } from "../../domain/period.ts";

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

describe("Targets — settings (#16)", () => {
  it("shows the current values", async () => {
    renderTargets();
    await waitFor(() => expect(inputFor("cutoff-input").value).toBe("0"));
    expect(inputFor("active-min-input").value).toBe("1");
    expect(screen.getByTestId("week-start-monday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("week-start-sunday").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the week start and persists it", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("week-start-sunday")).toBeTruthy());

    fireEvent.click(screen.getByTestId("week-start-sunday"));

    await waitFor(async () => expect((await ctx.settings.get()).weekStartsOn).toBe(7));
    await waitFor(() =>
      expect(screen.getByTestId("week-start-sunday").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("settings-saved")).toBeTruthy();
  });

  it("says out loud that the week start re-buckets past weeks", async () => {
    // Changing it visibly moves percentages, so the UI must warn rather than
    // let the user discover it.
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("week-start-note")).toBeTruthy());
    expect(screen.getByTestId("week-start-note").textContent).toMatch(/past weeks/i);
  });

  it("says out loud that the cutoff only affects future writes", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("cutoff-note")).toBeTruthy());
    expect(screen.getByTestId("cutoff-note").textContent).toMatch(/from now on/i);
    expect(screen.getByTestId("cutoff-note").textContent).toMatch(/never rewritten/i);
  });

  it("saves a day cutoff and describes what it does", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("cutoff-input")).toBeTruthy());

    fireEvent.input(screen.getByTestId("cutoff-input"), { target: { value: "3" } });
    expect(screen.getByTestId("cutoff-preview").textContent).toContain("3 am");

    fireEvent.click(screen.getByTestId("cutoff-save"));
    await waitFor(async () => expect((await ctx.settings.get()).dayCutoffHour).toBe(3));
  });

  it("applies the cutoff to the next set logged, and not to history", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("cutoff-input")).toBeTruthy());
    fireEvent.input(screen.getByTestId("cutoff-input"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("cutoff-save"));
    await waitFor(async () => expect((await ctx.settings.get()).dayCutoffHour).toBe(3));

    // A set logged at 00:30 belongs to the previous day (period.test.ts covers
    // the math; this asserts the write path actually reads the setting).
    const late = await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-04", hour: 0 },
    });
    expect(late.day).toBe("2026-03-03");
  });

  it("rejects a cutoff outside 0..23", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("cutoff-input")).toBeTruthy());

    fireEvent.input(screen.getByTestId("cutoff-input"), { target: { value: "24" } });
    fireEvent.click(screen.getByTestId("cutoff-save"));

    await waitFor(() =>
      expect(screen.getByTestId("settings-error").textContent).toMatch(/0 to 23/),
    );
    expect((await ctx.settings.get()).dayCutoffHour).toBe(0);
  });

  it("saves the active-day minimum and says the comparison is per exercise", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("active-min-input")).toBeTruthy());

    fireEvent.input(screen.getByTestId("active-min-input"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("active-min-save"));

    await waitFor(async () => expect((await ctx.settings.get()).activeDayMinAmount).toBe(20));
    // The issue asks for this semantic to be documented, not guessed at.
    expect(screen.getByTestId("active-min-note").textContent).toMatch(/one exercise/i);
  });

  it("rejects a zero active-day minimum", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("active-min-input")).toBeTruthy());

    fireEvent.input(screen.getByTestId("active-min-input"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("active-min-save"));

    await waitFor(() => expect(screen.getByTestId("settings-error")).toBeTruthy());
    expect((await ctx.settings.get()).activeDayMinAmount).toBe(1);
  });

  it("changing the week start re-buckets a past week for real", async () => {
    // 2026-03-04 is a Wednesday. Monday-start week: 3-02..3-08. Sunday-start:
    // 3-01..3-07. A set on Sunday 2026-03-01 is in "last week" on Mondays and
    // "this week" on Sundays — the visible move the UI warns about.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20, at: { day: "2026-03-01", hour: 12 } });

    const mondayWeek = weekRange("2026-03-04", 1);
    const sundayWeek = weekRange("2026-03-04", 7);
    expect(mondayWeek.start).toBe("2026-03-02");
    expect(sundayWeek.start).toBe("2026-03-01");

    renderTargets();
    await waitFor(() => expect(screen.getByTestId("week-start-sunday")).toBeTruthy());
    fireEvent.click(screen.getByTestId("week-start-sunday"));

    await waitFor(async () => expect((await ctx.settings.get()).weekStartsOn).toBe(7));
  });
});

describe("Targets — exercise management (#17)", () => {
  it("lists every non-archived exercise in display order", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("exercise-manager-list")).toBeTruthy());

    const names = screen
      .getAllByTestId(/^manage-/)
      .map((row) => row.textContent ?? "");
    expect(names[0]).toContain("Push-up");
    expect(names[1]).toContain("Core");
    expect(names[2]).toContain("Toe Touch");
  });

  it("adds an exercise which then gets a target row", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("new-exercise-name")).toBeTruthy());

    fireEvent.input(screen.getByTestId("new-exercise-name"), { target: { value: "Pull-up" } });
    fireEvent.click(screen.getByTestId("add-exercise-save"));

    await waitFor(() => expect(screen.getByTestId("exercise-notice")).toBeTruthy());
    expect(screen.getByTestId("exercise-notice").textContent).toContain("Pull-up");

    const created = (await ctx.exercises.list()).find((e) => e.name === "Pull-up");
    expect(created).toBeDefined();
    expect(created?.kind).toBe("reps");
    expect(created?.step).toBe(10);

    // It appears as a target row with no target, never `NaN` or `0 %`.
    await waitFor(() => expect(screen.getByTestId(`target-input-${created!.id}`)).toBeTruthy());
    expect(inputFor(`target-input-${created!.id}`).value).toBe("");
    expect(screen.queryByText("NaN")).toBeNull();
  });

  it("creates a duration exercise with second-based defaults", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("new-exercise-name")).toBeTruthy());

    fireEvent.input(screen.getByTestId("new-exercise-name"), { target: { value: "Plank" } });
    fireEvent.change(screen.getByTestId("new-exercise-kind"), { target: { value: "duration" } });
    fireEvent.click(screen.getByTestId("add-exercise-save"));

    await waitFor(() => expect(screen.getByTestId("exercise-notice")).toBeTruthy());
    const created = (await ctx.exercises.list()).find((e) => e.name === "Plank");
    expect(created?.kind).toBe("duration");
    expect(created?.unit).toBe("s");
    expect(created?.step).toBe(30);
  });

  it("does not create an exercise with no goal", async () => {
    const goalsBefore = (await ctx.goals.all()).length;
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("new-exercise-name")).toBeTruthy());

    fireEvent.input(screen.getByTestId("new-exercise-name"), { target: { value: "Pull-up" } });
    fireEvent.click(screen.getByTestId("add-exercise-save"));

    await waitFor(() => expect(screen.getByTestId("exercise-notice")).toBeTruthy());
    expect((await ctx.goals.all()).length).toBe(goalsBefore);
  });

  it("rejects an empty name without creating anything", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("new-exercise-name")).toBeTruthy());

    fireEvent.click(screen.getByTestId("add-exercise-save"));

    await waitFor(() => expect(screen.getByTestId("exercise-error")).toBeTruthy());
    expect(screen.getByTestId("exercise-error").textContent).toMatch(/name/i);
    expect(await ctx.exercises.list()).toHaveLength(3);
  });

  it("moves an exercise down and the order persists", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("move-down-ex-pushup")).toBeTruthy());

    fireEvent.click(screen.getByTestId("move-down-ex-pushup"));

    await waitFor(async () => {
      const names = (await ctx.exercises.list()).map((e) => e.name);
      expect(names).toEqual(["Core", "Push-up", "Toe Touch"]);
    });
  });

  it("disables the arrows at the ends of the list", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("move-up-ex-pushup")).toBeTruthy());

    expect((screen.getByTestId("move-up-ex-pushup") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("move-down-ex-pushup") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("move-down-ex-toe-touch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("never offers a delete", async () => {
    renderTargets();
    await waitFor(() => expect(screen.getByTestId("exercise-manager-list")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("archives an exercise, keeps its history, and offers to restore it", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-toe-touch", amount: 500 });

    renderTargets();
    await waitFor(() => expect(screen.getByTestId("archive-ex-toe-touch")).toBeTruthy());
    fireEvent.click(screen.getByTestId("archive-ex-toe-touch"));

    await waitFor(async () =>
      expect((await ctx.exercises.get("ex-toe-touch"))?.archivedAt).toBeTruthy(),
    );
    // The notice says history is kept: "archive" could read as "delete".
    expect(screen.getByTestId("exercise-notice").textContent).toMatch(/history is kept/i);

    // Gone from Today's list, moved to the archived section, entries untouched.
    await waitFor(() => expect(screen.getByTestId("archived-ex-toe-touch")).toBeTruthy());
    expect(screen.queryByTestId("manage-ex-toe-touch")).toBeNull();
    expect(screen.queryByTestId("target-input-ex-toe-touch")).toBeNull();
    expect(await ctx.entries.count()).toBe(1);
  });

  it("restores an archived exercise to its old position", async () => {
    await ctx.exercises.archive("ex-core");

    renderTargets();
    await waitFor(() => expect(screen.getByTestId("unarchive-ex-core")).toBeTruthy());
    fireEvent.click(screen.getByTestId("unarchive-ex-core"));

    await waitFor(async () => {
      const names = (await ctx.exercises.list()).map((e) => e.name);
      expect(names).toEqual(["Push-up", "Core", "Toe Touch"]);
    });
    expect(screen.getByTestId("exercise-notice").textContent).toContain("Core");
  });
});
