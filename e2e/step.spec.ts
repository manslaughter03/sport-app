import { expect, test } from "@playwright/test";

test("quick-add step is editable and the Today buttons follow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Toe Touch")).toBeVisible();

  // Seeded with a high-volume step.
  await expect(page.getByLabel("Add 50 reps to Toe Touch")).toBeVisible();
  await expect(page.getByLabel("Add 100 reps to Toe Touch")).toBeVisible();

  // Change it to 100 on Targets.
  await page.getByRole("button", { name: "Targets" }).click();
  const stepInput = page.getByTestId("step-input-ex-toe-touch");
  await expect(stepInput).toHaveValue("50");
  await stepInput.fill("100");
  await expect(page.getByTestId("step-preview-ex-toe-touch")).toHaveText("+100 / +200");
  await page.getByTestId("save-step-ex-toe-touch").click();
  await expect(page.getByTestId("step-saved-ex-toe-touch")).toBeVisible();

  // Today now offers +100 / +200, and tapping writes that amount.
  await page.getByRole("button", { name: "Today" }).click();
  await page.getByLabel("Add 100 reps to Toe Touch").click();
  await expect(page.getByTestId("total-ex-toe-touch")).toHaveText("100");

  // Persists across reload.
  await page.reload();
  await expect(page.getByLabel("Add 200 reps to Toe Touch")).toBeVisible();
  await expect(page.getByTestId("total-ex-toe-touch")).toHaveText("100");
});

test("duration exercises have no step control", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Targets" }).click();
  await expect(page.getByTestId("target-input-ex-core")).toHaveValue("3000");
  await expect(page.getByTestId("step-input-ex-core")).toHaveCount(0);
  await expect(page.getByTestId("step-input-activeDays")).toHaveCount(0);
});
