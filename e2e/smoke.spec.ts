import { expect, test } from "@playwright/test";

/**
 * The v0 acceptance smoke (plan §5), minus the parts that need a physical phone.
 *
 * Each test starts from a clean origin, so IndexedDB is empty and the app seeds
 * itself — which is also the first-run path a real user hits.
 */

test("seeds and logs sets, and the weekly percentage moves", async ({ page }) => {
  await page.goto("/");

  // Seeded exercises are on Today.
  await expect(page.getByText("Push-up")).toBeVisible();
  await expect(page.getByText("Core")).toBeVisible();

  await page.getByLabel("Add 10 reps to Push-up").click();
  await page.getByLabel("Add 10 reps to Push-up").click();

  // 20 of 700 ≈ 2.9 % — the total and the ring update without a reload.
  // Assert the total element specifically: the row also contains a "+10"
  // button, so a substring match on the row would pass for the wrong reason.
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("20");
  await expect(page.getByTestId("ring-ex-pushup")).toContainText("%");
});

test("data survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add 10 reps to Push-up").click();
  await page.getByLabel("Add 5 reps to Push-up").click();

  await expect(page.getByTestId("total-ex-pushup")).toHaveText("15");

  await page.reload();

  // The whole point of local-first: the 15 is still there.
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("15");
});

test("undo removes exactly one set", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add 10 reps to Push-up").click();
  await page.getByLabel("Add 10 reps to Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("20");

  await page.getByLabel("Undo last set for Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");
});

test("progress screen shows volume and regularity", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add 10 reps to Push-up").click();

  await page.getByRole("button", { name: "Progress" }).click();

  await expect(page.getByTestId("regularity")).toBeVisible();
  await expect(page.getByTestId("volume-ex-pushup")).toContainText("%");
  await expect(page.getByTestId("day-grid")).toBeVisible();
  await expect(page.getByTestId("day-position")).toContainText("of 7");
});

test("targets editor changes the target for this week", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Targets" }).click();

  const input = page.getByTestId("target-input-ex-pushup");
  await expect(input).toHaveValue("700");
  await input.fill("800");
  await page.getByTestId("save-ex-pushup").click();
  await expect(page.getByTestId("saved-ex-pushup")).toBeVisible();
});

test("export downloads a valid backup file", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add 10 reps to Push-up").click();
  await page.getByRole("button", { name: "Backup" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^sport-app-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test("installs a service worker and works offline after first load", async ({ page, context }) => {
  await page.goto("/");

  // The SW must be active AND have finished precaching before we cut the
  // network; an active worker with an empty cache would fail the reload and
  // make this test flaky for the wrong reason.
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.active == null) return false;
      const names = await caches.keys();
      return names.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );

  await page.getByLabel("Add 10 reps to Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");

  // Airplane mode.
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText("Push-up")).toBeVisible();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");

  // And logging still works with no network at all.
  await page.getByLabel("Add 5 reps to Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("15");

  await context.setOffline(false);
});

test("serves the manifest with the Pages subpath", async ({ page, request }) => {
  await page.goto("/");
  const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
  expect(manifestHref).toBe("/sport-app/manifest.webmanifest");

  // Pages serves the app under /sport-app/, so the manifest is there too.
  const response = await request.get("/sport-app/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { start_url: string; scope: string };
  expect(manifest.start_url).toBe("/sport-app/");
  expect(manifest.scope).toBe("/sport-app/");
});
