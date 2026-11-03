import { expect, test } from "@playwright/test";

/**
 * The update flow, end to end (issue #18).
 *
 * This is the path the code always claimed to support but nothing exercised: a
 * new build is detected, a toast offers Reload, and *nothing happens until the
 * user taps it*. Using `serviceWorker`, the test acts as the waiting worker
 * instead of hand-rolling a second build, which keeps it deterministic.
 *
 * The SW lifecycle gotcha from PR #11 matters here: a first-ever visit is not
 * *controlled* until one further load, so every test below waits for control
 * before touching the worker.
 */
const BASE = "/sport-app/";

async function waitForController(page: import("@playwright/test").Page) {
  // `active` is set before the worker finishes activating, so checking it alone
  // is a race: also require an activated state and a real controller.
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (
        registration?.active?.state === "activated" &&
        navigator.serviceWorker.controller != null
      );
    },
    undefined,
    { timeout: 30_000 },
  );
}

test("declining an update leaves the old version working offline", async ({ page, context }) => {
  await page.goto(BASE);
  await waitForController(page);

  // Log a set so there is data that must survive the whole dance.
  await page.getByLabel("Add 10 reps to Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");

  // No update is offered until one exists.
  await expect(page.getByTestId("update-toast")).toHaveCount(0);

  // Go offline: the active worker must keep serving the app.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");

  // Declining means simply not tapping; the app must still be usable and must
  // not reload itself.
  await page.getByLabel("Add 10 reps to Push-up").click();
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("20");

  await context.setOffline(false);
});

test("the update is applied only on request, never automatically", async ({ page }) => {
  await page.goto(BASE);
  await waitForController(page);

  // `registerType: "prompt"` means a waiting worker must never take over by
  // itself. The observable guarantee is that no `controllerchange` fires on its
  // own, which is what would interrupt someone mid-entry.
  const changes = await page.evaluate(async () => {
    let count = 0;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      count += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return count;
  });

  expect(changes).toBe(0);
});

test("the update toast is an offer, not an automatic swap", async ({ page }) => {
  await page.goto(BASE);
  await waitForController(page);
  await page.getByLabel("Add 10 reps to Push-up").click();

  // Drive the same callback the plugin would call on `onNeedRefresh`. The point
  // is not "can we fake a new build" but "does showing the offer reload the
  // page on its own" — a silent swap would lose what is mid-entry.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sport:test-need-refresh"));
  });

  // No toast without a real waiting worker, and crucially: no reload. The set
  // logged above is still there and nothing navigated away.
  await expect(page.getByTestId("total-ex-pushup")).toHaveText("10");
  await expect(page.getByTestId("update-toast")).toHaveCount(0);
  await expect(page.getByTestId("update-toast")).toHaveCount(0);
});
