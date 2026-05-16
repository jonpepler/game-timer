import { test, expect } from "@playwright/test";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

test.describe("game definitions", () => {
  test("Generic is preselected and seeds 90 expected turns", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await expect(page.getByLabel(/^Game$/)).toHaveValue("generic");
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("90");
  });

  test("picking Root reseeds expected turns and the player palette", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");

    // Root's default expected turns is 80.
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("80");

    // Enable player tracking; default count is 2, so player rows should
    // pre-fill with the first two Root factions in registry order.
    await page.getByLabel(/track individual players/i).check();
    await expect(page.getByLabel(/^Player 1 name$/)).toHaveValue(
      "Marquise de Cat",
    );
    await expect(page.getByLabel(/^Player 2 name$/)).toHaveValue(
      "Eyrie Dynasties",
    );
  });

  test("Root caps the player count at the number of factions (8)", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();
    const countInput = page.getByLabel(/number of players/i);
    // The native number input caps to max=8; manually entering a higher
    // value gets clamped on commit by the handler.
    await expect(countInput).toHaveAttribute("max", "8");
    await countInput.fill("8");
    await expect(countInput).toHaveValue("8");
    await expect(page.getByLabel(/^Player 8 name$/)).toHaveValue(
      "Corvid Conspiracy",
    );
  });

  test("switching from Root back to Generic re-seeds Player N defaults", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();
    await expect(page.getByLabel(/^Player 1 name$/)).toHaveValue(
      "Marquise de Cat",
    );

    await page.getByLabel(/^Game$/).selectOption("generic");
    // After switching back, the player rows reset to the generic Player N
    // palette, expected turns reset to 90.
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("90");
    await expect(page.getByLabel(/^Player 1 name$/)).toHaveValue("Player 1");
    await expect(page.getByLabel(/^Player 2 name$/)).toHaveValue("Player 2");
  });
});
