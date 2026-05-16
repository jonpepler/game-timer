import { test, expect } from "@playwright/test";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

test("landing → timer navigation works", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("link", { name: /new game/i })).toBeVisible();
  await page.getByRole("link", { name: /new game/i }).click();
  await expect(page).toHaveURL(/\/timer/);
  await expect(
    page.getByRole("heading", { name: /game setup/i }),
  ).toBeVisible();
});

test("setup modal's expectedTurns flows into the footer", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  const turnsInput = page.getByLabel(/expected turns/i);
  await expect(turnsInput).toBeVisible();
  await turnsInput.fill("42");
  await page.getByRole("button", { name: /start game/i }).click();
  await expect(page.getByText(/42\s*turns\s*left/i)).toBeVisible();
});
