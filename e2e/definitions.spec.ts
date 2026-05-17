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

  test("Root caps the player count at maxPlayers (6) even though it has 13 factions", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();
    const countInput = page.getByLabel(/number of players/i);
    // Root declares maxPlayers: 6 in the JSON, so the input caps at 6
    // regardless of the larger faction roster.
    await expect(countInput).toHaveAttribute("max", "6");
    await countInput.fill("6");
    await expect(countInput).toHaveValue("6");
    await expect(page.getByLabel(/^Player 6 name$/)).toHaveValue(
      "Riverfolk Company",
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

test.describe("Root advanced setup", () => {
  test("renders maps + decks + landmarks + hirelings + draft", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");

    // Map picker shows every map and defaults to Autumn (the first in
    // the registry order).
    const mapSelect = page.getByLabel(/^Map$/);
    await expect(mapSelect).toBeVisible();
    await expect(mapSelect).toContainText("Autumn");
    await expect(mapSelect).toContainText("Winter");
    await expect(mapSelect).toContainText("Lake");
    await expect(mapSelect).toContainText("Mountain");
    await expect(mapSelect).toContainText("Marsh");
    await expect(mapSelect).toContainText("Gorge");

    // Deck picker shows all three.
    const deckSelect = page.getByLabel(/^Deck$/);
    await expect(deckSelect).toContainText("Base deck");
    await expect(deckSelect).toContainText("Exiles and Partisans");
    await expect(deckSelect).toContainText("Squires and Disciples");

    // Landmarks + hirelings cap inputs.
    await expect(page.getByLabel(/^Landmarks$/)).toHaveAttribute("max", "2");
    await expect(page.getByLabel(/^Hirelings$/)).toHaveAttribute("max", "3");

    // Draft toggle exposed (off by default).
    await expect(page.getByLabel(/^Draft factions$/)).not.toBeChecked();
  });

  test("Generic has no Advanced setup section", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    // Generic doesn't declare a setupSchema, so no advanced controls.
    await expect(page.getByLabel(/^Map$/)).toHaveCount(0);
    await expect(page.getByLabel(/^Deck$/)).toHaveCount(0);
  });

  test("faction picker disables already-picked factions", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();

    // Default: Player 1 = Marquise (the picker reflects this).
    const p1Faction = page.getByLabel(/^Faction for player 1$/);
    await expect(p1Faction).toHaveValue("marquise");
    const p2Faction = page.getByLabel(/^Faction for player 2$/);
    await expect(p2Faction).toHaveValue("eyrie");

    // Marquise should be disabled on row 2's dropdown (already taken).
    const marquiseOnRow2 = p2Faction.locator(`option[value="marquise"]`);
    await expect(marquiseOnRow2).toBeDisabled();
  });

  test("picking a faction updates the player name + colour", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();
    // Swap Player 2 from Eyrie to Lord of the Hundreds.
    await page
      .getByLabel(/^Faction for player 2$/)
      .selectOption("hundreds");
    await expect(page.getByLabel(/^Player 2 name$/)).toHaveValue(
      "Lord of the Hundreds",
    );
  });

  test("mutex: Vagabond + Knaves of the Deepwood can't both be picked", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await page.getByLabel(/track individual players/i).check();

    // Pick Vagabond for Player 1.
    await page
      .getByLabel(/^Faction for player 1$/)
      .selectOption("vagabond");

    // Knaves of the Deepwood should now be disabled on Player 2's
    // dropdown via the mutex pair declared in root.json.
    const knavesOnRow2 = page
      .getByLabel(/^Faction for player 2$/)
      .locator(`option[value="knaves"]`);
    await expect(knavesOnRow2).toBeDisabled();
  });
});
