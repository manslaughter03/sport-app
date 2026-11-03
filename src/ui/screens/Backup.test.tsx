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
import { buildBackup, parseBackup, serializeBackup } from "../../data/backup.ts";

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

describe("Backup import", () => {
  /** Builds a valid backup file the component can receive through the input. */
  async function backupFile(): Promise<File> {
    const backup = await buildBackup(ctx.db, ctx.clock);
    return new File([serializeBackup(backup)], "sport-app-backup-2026-03-04.json", {
      type: "application/json",
    });
  }

  async function choose(file: File): Promise<void> {
    renderBackup();
    await waitFor(() => expect(screen.getByTestId("import-input")).toBeTruthy());
    const input = screen.getByTestId("import-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId("import-confirm")).toBeTruthy());
  }

  it("asks before writing anything", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const file = await backupFile();
    await choose(file);

    // Nothing has been written yet: both modes are still on the table.
    expect(screen.getByTestId("import-merge")).toBeTruthy();
    expect(screen.getByTestId("import-replace")).toBeTruthy();
    expect(screen.getByTestId("import-replace").textContent).toContain("1 set will be deleted");
  });

  it("cancel leaves the database untouched", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const file = await backupFile();
    await choose(file);

    fireEvent.click(screen.getByTestId("import-cancel"));

    await waitFor(() => expect(screen.queryByTestId("import-confirm")).toBeNull());
    expect(await ctx.db.entries.count()).toBe(1);
  });

  it("merges a file into an existing database and reports the counts", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const file = await backupFile();

    // Data logged after the export: the merge must keep it and add nothing.
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 15 });

    await choose(file);
    fireEvent.click(screen.getByTestId("import-merge"));

    await waitFor(() => expect(screen.getByTestId("import-status")).toBeTruthy());
    // Nothing was added or overwritten: every row in the file is already here.
    expect(screen.getByTestId("import-status").textContent).toContain("Nothing to do");
    // The set logged after the export survives a merge.
    expect(await ctx.db.entries.count()).toBe(2);
  });

  it("replace-all restores the file and reports what was removed", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    const file = await backupFile();
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 15 });

    await choose(file);
    fireEvent.click(screen.getByTestId("import-replace"));

    await waitFor(() => expect(screen.getByTestId("import-status")).toBeTruthy());
    expect(screen.getByTestId("import-status").textContent).toContain("Replaced everything");
    await waitFor(async () => expect(await ctx.db.entries.count()).toBe(1));
    // The import's own outcome is reported, not the export's status line.
    expect(screen.queryByTestId("export-status")).toBeNull();
  });

  it("refuses a file from a newer app version with a readable message", async () => {
    const backup = await buildBackup(ctx.db, ctx.clock);
    const newer = new File(
      [JSON.stringify({ ...backup, schemaVersion: backup.schemaVersion + 1 })],
      "newer.json",
      { type: "application/json" },
    );

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("import-input")).toBeTruthy());
    const input = screen.getByTestId("import-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [newer], configurable: true });
    fireEvent.change(input);

    await waitFor(() =>
      expect(screen.getByTestId("import-error").textContent).toMatch(/newer version/i),
    );
    // No confirmation appears for a file that cannot be applied.
    expect(screen.queryByTestId("import-confirm")).toBeNull();
  });

  it("refuses a file that is not a backup at all", async () => {
    const bogus = new File(["{"], "notes.json", { type: "application/json" });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("import-input")).toBeTruthy());
    const input = screen.getByTestId("import-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [bogus], configurable: true });
    fireEvent.change(input);

    await waitFor(() =>
      expect(screen.getByTestId("import-error").textContent).toMatch(/not valid JSON/i),
    );
  });

  it("shows the re-sequencing note when imported sets had to be re-numbered", async () => {
    await ctx.entries.addSet({ exerciseId: "ex-pushup", amount: 20 });
    // A foreign set claiming the same seq slot.
    const backup = await buildBackup(ctx.db, ctx.clock);
    backup.data.entries = [
      ...backup.data.entries,
      {
        id: "foreign-1",
        exerciseId: "ex-pushup",
        day: "2026-03-01",
        amount: 12,
        createdAt: "2026-03-01T10:00:00.000Z",
        seq: 1,
      },
    ];
    const file = new File([serializeBackup(backup)], "collide.json", { type: "application/json" });

    await choose(file);
    fireEvent.click(screen.getByTestId("import-merge"));

    await waitFor(() => expect(screen.getByTestId("import-details")).toBeTruthy());
    expect(screen.getByTestId("import-details").textContent).toContain("re-numbered");
  });
});

describe("Backup — storage persistence (#18)", () => {
  /** jsdom has no StorageManager, so each case installs its own. */
  function stubStorage(manager: Partial<StorageManager> | undefined) {
    Object.defineProperty(navigator, "storage", {
      value: manager,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    stubStorage(undefined);
  });

  it("says plainly when storage is protected", async () => {
    stubStorage({ persist: async () => true, persisted: async () => true });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("persistence")).toBeTruthy());

    const node = screen.getByTestId("persistence");
    expect(node.getAttribute("data-state")).toBe("persisted");
    expect(node.textContent).toMatch(/protected from eviction/i);
  });

  it("says plainly when it is NOT protected, and points at the export", async () => {
    // The accurate-but-uncomfortable case: claiming protection here would be a
    // lie that costs the user their history.
    stubStorage({ persisted: async () => false });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("persistence")).toBeTruthy());

    const node = screen.getByTestId("persistence");
    expect(node.getAttribute("data-state")).toBe("best-effort");
    expect(node.textContent).toMatch(/not protected/i);
    expect(node.textContent).toMatch(/export/i);
  });

  it("does not claim protection when the browser cannot report it", async () => {
    stubStorage(undefined);

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("persistence")).toBeTruthy());
    expect(screen.getByTestId("persistence").getAttribute("data-state")).toBe("unavailable");
    expect(screen.getByTestId("persistence").textContent).not.toMatch(/protected from eviction/i);
  });

  it("shows how much space the origin is using when the browser will say", async () => {
    stubStorage({
      persisted: async () => true,
      estimate: async () => ({ usage: 1_500_000, quota: 100_000_000 }),
    });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("storage-usage")).toBeTruthy());
    expect(screen.getByTestId("storage-usage").textContent).toContain("1.4 MB");
    expect(screen.getByTestId("storage-usage").textContent).toContain("2 %");
  });

  it("omits the usage line rather than inventing a number", async () => {
    stubStorage({ persisted: async () => true, estimate: async () => ({}) });

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("persistence")).toBeTruthy());
    expect(screen.queryByTestId("storage-usage")).toBeNull();
  });
});

describe("Backup — install prompt (#18)", () => {
  it("offers an Install button only after the browser fired the event", async () => {
    renderBackup();
    await waitFor(() => expect(screen.getByTestId("export")).toBeTruthy());
    expect(screen.queryByTestId("install")).toBeNull();
  });

  it("installs when the captured prompt is replayed", async () => {
    const { captureInstallPrompt, resetInstallPrompt } = await import("../install.ts");
    const prompt = vi.fn(async () => undefined);
    captureInstallPrompt({
      preventDefault: () => undefined,
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    } as never);

    renderBackup();
    await waitFor(() => expect(screen.getByTestId("install")).toBeTruthy());
    fireEvent.click(screen.getByTestId("install"));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    // Spent, so the control goes away rather than being tappable twice.
    await waitFor(() => expect(screen.queryByTestId("install")).toBeNull());
    resetInstallPrompt();
  });
});

describe("formatBytes", () => {
  it("uses believable units", async () => {
    const { formatBytes } = await import("./Backup.tsx");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1.0 kB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
    expect(formatBytes(5_000_000_000)).toBe("4.7 GB");
  });

  it("never renders a negative or NaN size", async () => {
    const { formatBytes } = await import("./Backup.tsx");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});
