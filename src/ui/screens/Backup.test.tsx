// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render as renderInto,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/preact";
import { createApp, type AppContext } from "../app.ts";
import { Backup } from "./Backup.tsx";
import { createDatabase } from "../../data/db.ts";
import { createClock } from "../../data/clock.ts";
import { createExercisesRepo } from "../../data/repos/exercises.ts";
import { createEntriesRepo } from "../../data/repos/entries.ts";
import { createGoalsRepo } from "../../data/repos/goals.ts";
import { createSettingsRepo } from "../../data/repos/settings.ts";
import { seedIfEmpty } from "../../data/seed.ts";
import { parseBackup } from "../../data/backup.ts";

let counter = 0;
let ctx: AppContext;
let day = "2026-03-04";

function clockAt(d: string, hour = 12) {
  return createClock(() => ({
    day: d,
    hour,
    instant: `${d}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  }));
}

const mounted: RenderResult[] = [];

function renderBackup(): RenderResult {
  const result = renderInto(<Backup ctx={ctx} />);
  mounted.push(result);
  return result;
}

/** Captures the blob a download would have produced, then reads it lazily. */
let capturedBlob: Blob | undefined;
let capturedFilename = "";

async function captured(): Promise<{ filename: string; text: string }> {
  return { filename: capturedFilename, text: await (capturedBlob?.text() ?? Promise.resolve("")) };
}

beforeEach(async () => {
  counter += 1;
  day = "2026-03-04";
  const db = createDatabase(`backup-ui-test-${counter}`);
  const clock = clockAt(day);
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

  capturedBlob = undefined;
  capturedFilename = "";
  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();

  // Intercept the anchor click so the test can inspect the download.
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    capturedFilename = this.download;
  };
});

afterEach(async () => {
  for (const result of mounted.splice(0)) result.unmount();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await ctx.db.close();
  await ctx.db.delete();
});

describe("Backup screen", () => {
  it("shows what would be exported", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 15 });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("stat-entries").textContent).toBe("2"));
    expect(screen.getByTestId("stat-days").textContent).toBe("1");
    expect(screen.getByTestId("stat-exercises").textContent).toBe("3");
  });

  it("says never exported on a fresh install", async () => {
    renderBackup();
    await waitFor(() => expect(screen.getByTestId("last-export").textContent).toContain("Never"));
  });

  it("exports a valid backup file", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("export")).toBeTruthy());
    fireEvent.click(screen.getByTestId("export"));

    await waitFor(() => expect(screen.getByTestId("export-status")).toBeTruthy());

    const file = await captured();
    expect(file.filename).toBe("sport-app-backup-2026-03-04.json");
    const parsed = parseBackup(file.text);
    expect(parsed.data.entries).toHaveLength(1);
    expect(parsed.data.exercises).toHaveLength(3);
  });

  it("stamps lastExportAt so the nudge resets", async () => {
    renderBackup();
    await waitFor(() => expect(screen.getByTestId("export")).toBeTruthy());
    fireEvent.click(screen.getByTestId("export"));

    await waitFor(async () => {
      const settings = await ctx.settings.get();
      expect(settings.lastExportAt).toBe("2026-03-04T12:00:00.000Z");
    });

    await waitFor(() =>
      expect(screen.getByTestId("last-export").textContent).toContain("2026-03-04"),
    );
  });

  it("surfaces an export failure instead of failing silently", async () => {
    renderBackup();
    await waitFor(() => expect(screen.getByTestId("export")).toBeTruthy());

    const realBuild = ctx.db.settings.get.bind(ctx.db.settings);
    ctx.db.settings.get = (async () => {
      throw new Error("storage unavailable");
    }) as unknown as typeof ctx.db.settings.get;

    fireEvent.click(screen.getByTestId("export"));
    await waitFor(() =>
      expect(screen.getByTestId("export-error").textContent).toContain("storage unavailable"),
    );

    ctx.db.settings.get = realBuild;
  });
});

describe("Backup nudge", () => {
  it("appears with a week of data and no prior export", async () => {
    for (const d of [
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]) {
      await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20, at: { day: d, hour: 12 } });
    }

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("backup-nudge")).toBeTruthy());
  });

  it("stays hidden with only a couple of days of data", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    await ctx.entries.addSet({
      exerciseId: "ex-pushup",
      amount: 20,
      at: { day: "2026-03-03", hour: 12 },
    });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("export")).toBeTruthy());
    expect(screen.queryByTestId("backup-nudge")).toBeNull();
  });

  it("disappears after a fresh export", async () => {
    for (const d of [
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]) {
      await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20, at: { day: d, hour: 12 } });
    }

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("backup-nudge")).toBeTruthy());

    fireEvent.click(screen.getByTestId("export"));

    await waitFor(() => expect(screen.queryByTestId("backup-nudge")).toBeNull());
  });
});
