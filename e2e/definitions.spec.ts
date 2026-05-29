import { test, expect } from "@playwright/test";
import { navigateToScreen } from "./_setup-helpers";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

test.describe("game definitions (wizard)", () => {
  test("Generic is preselected, seeds 90 expected turns", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await expect(page.getByLabel(/^Game$/)).toHaveValue("generic");
    await navigateToScreen(page, /how long is this game/i);
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("90");
  });

  test("picking Root skips the Expected-turns screen (turnsPerPlayer rules)", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByRole("button", { name: /^Next/ }).click();
    // Root's turnsPerPlayer = 8 derives expectedTurns from seats at
    // submit; no Expected-turns screen — Next from Game lands at
    // Expansions.
    await expect(
      page.getByRole("heading", { name: /expansions in this game/i }),
    ).toBeVisible();
  });

  test("Root caps the seat count at maxPlayers (6)", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await navigateToScreen(page, /seat players/i);
    // Default seat count is 4; max is 6 → 2 add-seat clicks fills it.
    await page.getByRole("button", { name: /add seat/i }).click();
    await page.getByRole("button", { name: /add seat/i }).click();
    const addBtn = page.getByRole("button", { name: /add seat/i });
    await expect(addBtn).toBeDisabled();
    const seatRows = page.locator(
      'input[aria-label^="Seat "][aria-label$=" name"]',
    );
    await expect(seatRows).toHaveCount(6);
  });
});

test.describe("Root setup wizard surface", () => {
  test("Map screen lists every map, defaulting to Autumn", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    // Expansions default-on, so every map should be visible on the
    // Map screen.
    await navigateToScreen(page, /^Map$/);
    for (const name of [
      "Autumn",
      "Winter",
      "Lake",
      "Mountain",
      "Marsh",
      "Gorge",
    ]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
  });

  test("Deck screen shows Base + Exiles + Squires when their modules are on", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await navigateToScreen(page, /^Deck$/);
    await expect(page.getByRole("button", { name: /Base deck/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Exiles and Partisans/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Squires and Disciples/ }),
    ).toBeVisible();
  });

  test("Generic shows no setup-step screens", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await navigateToScreen(page, /Players \(optional\)/i);
    await expect(
      page.getByRole("button", { name: /start game/i }),
    ).toBeVisible();
  });

  test("faction mutex: Vagabond + Knaves of the Deepwood can't both be picked", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await navigateToScreen(page, /^Faction$/);
    // Switch to free-choice so all 13 factions are visible (default
    // draft mode only deals n+1).
    await page.getByRole("button", { name: /^Skip draft$/ }).click();
    // First seat picks Vagabond — two-step now (preview, then
    // Confirm setup commits the pick).
    await page.getByRole("button", { name: "Vagabond", exact: true }).click();
    await page.getByRole("button", { name: /^Confirm setup$/ }).click();
    // The Knaves card should now be visually disabled (aria-disabled)
    // for the next seat — mutex-excluded by Vagabond's pick.
    await expect(
      page.getByRole("button", {
        name: "Knaves of the Deepwood",
        exact: true,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
