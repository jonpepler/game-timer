import { test, expect, type Page } from "@playwright/test";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

const startRoot = async (page: Page, playerCount = 2) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill(String(playerCount));
  await page.getByRole("button", { name: /start game/i }).click();
};

const incButton = (page: Page, playerName: string) =>
  page.getByRole("button", { name: new RegExp(`Increase score for ${playerName}`, "i") });
const decButton = (page: Page, playerName: string) =>
  page.getByRole("button", { name: new RegExp(`Decrease score for ${playerName}`, "i") });
const scoreCell = (page: Page, playerName: string) =>
  page
    .locator(`text=${playerName}`)
    .locator("..")
    .locator("xpath=following-sibling::*[contains(@class, 'score')]")
    .first();

test.describe("score layer", () => {
  test("no score panel when the picked definition has no scoreConfig (Generic)", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/track individual players/i).check();
    await page.getByRole("button", { name: /start game/i }).click();
    // Generic has no score subsystem — panel + label should not render.
    await expect(page.getByLabel(/^Scores$/)).toHaveCount(0);
  });

  test("no score panel when Root is picked but player tracking is off", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByRole("button", { name: /start game/i }).click();
    await expect(page.getByLabel(/^Scores$/)).toHaveCount(0);
  });

  test("Root + players renders a score row per faction, starting at min", async ({
    page,
  }) => {
    await startRoot(page, 3);
    const panel = page.getByLabel(/^Scores$/);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Marquise de Cat");
    await expect(panel).toContainText("Eyrie Dynasties");
    await expect(panel).toContainText("Woodland Alliance");
    // Three zeros — one per faction.
    await expect(panel.getByText(/^0$/)).toHaveCount(3);
  });

  test("+ and - update the score for the targeted player only", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    // Marquise should be 3; Eyrie still at 0.
    const panel = page.getByLabel(/^Scores$/);
    await expect(panel.getByText(/^3$/)).toBeVisible();
    await expect(panel.getByText(/^0$/)).toBeVisible();

    await decButton(page, "Marquise de Cat").click();
    await expect(panel.getByText(/^2$/)).toBeVisible();
  });

  test("- is disabled at min, + is disabled at max (Root: 0..30)", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await expect(decButton(page, "Marquise de Cat")).toBeDisabled();
    // Pump Marquise to 30. The reducer clamps at max and disables +.
    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
    }
    await expect(incButton(page, "Marquise de Cat")).toBeDisabled();
  });

  test("clicking score buttons does not also trigger tap-to-advance", async ({
    page,
  }) => {
    await startRoot(page, 2);
    // Start the timer.
    await page.locator("main").click();
    // Take one turn so we have 79 remaining.
    await page.locator("main").click();
    await expect(page.getByText(/79\s*turns left/i)).toBeVisible();

    // Now hit the + button — it should NOT decrement turns-left.
    await incButton(page, "Eyrie Dynasties").click();
    await expect(page.getByText(/79\s*turns left/i)).toBeVisible();
  });

  test("hitting Root's max (30) fires a victory banner and stops the active-player banner", async ({
    page,
  }) => {
    await startRoot(page, 2);
    // No victor yet.
    await expect(page.getByRole("status")).toHaveCount(0);

    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
    }

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Marquise de Cat");
    await expect(banner).toContainText(/wins/i);
    // Active-player banner should be replaced by the victory banner.
    await expect(page.getByText(/.*’s turn/)).toHaveCount(0);
  });
});
