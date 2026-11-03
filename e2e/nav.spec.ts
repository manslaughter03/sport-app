import { expect, test } from "@playwright/test";

/**
 * The bottom nav must always be the topmost thing at its own position.
 *
 * This is a regression test for a real bug: the nav was `position: sticky` with
 * `z-index: auto`, so page content painted above it. Once Targets grew tall
 * enough to scroll (the settings section, #16), tapping "Today" from the
 * scrolled Targets screen silently did nothing — Playwright reported it as
 * "`<input id="setting-cutoff-input">` … intercepts pointer events", and a
 * person would have experienced a dead tab bar.
 *
 * A hit-test is the only assertion that holds regardless of *why* something
 * overlaps: a taller section, a z-index typo, or a new sticky element.
 */
test("the bottom nav stays on top of page content at every scroll offset", async ({ page }) => {
  await page.goto("/");

  // Targets is the tallest screen, and the one where the bug appeared.
  await page.getByRole("button", { name: "Targets" }).click();
  await expect(page.getByTestId("target-input-ex-pushup")).toBeVisible();

  for (const [width, height] of [
    [412, 839],
    [447, 911],
    [400, 700],
  ] as Array<[number, number]>) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);

    const covered = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      const today = document.querySelector("nav button");
      if (nav === null || today === null) return ["no nav"];

      const problems: string[] = [];
      const maxScroll = document.documentElement.scrollHeight;
      for (let y = 0; y <= maxScroll; y += 25) {
        window.scrollTo(0, y);
        const box = today.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        // Anything outside the nav at its own centre means a tap would be lost.
        if (hit !== null && !nav.contains(hit)) {
          problems.push(`scrollY=${y} hit=${hit.tagName}#${hit.id}`);
        }
      }
      window.scrollTo(0, 0);
      return problems.slice(0, 3);
    });

    expect(covered, `nav covered at ${width}x${height}`).toEqual([]);
  }
});

test("every tab is tappable from the tallest screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Targets" }).click();
  await page.getByTestId("step-input-ex-toe-touch").fill("100");
  await page.getByTestId("save-step-ex-toe-touch").click();
  await expect(page.getByTestId("step-saved-ex-toe-touch")).toBeVisible();

  // The exact sequence that used to hang: leave Targets for Today and log a set.
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByLabel("Add 100 reps to Toe Touch")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByTestId("history-count")).toBeVisible();

  await page.getByRole("button", { name: "Backup" }).click();
  await expect(page.getByTestId("export")).toBeVisible();
});
