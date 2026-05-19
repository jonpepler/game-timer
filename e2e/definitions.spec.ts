import { test, expect } from "@playwright/test";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

const advance = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Next/ }).click();

test.describe("game definitions (wizard)", () => {
  test("Generic is preselected, seeds 90 expected turns", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await expect(page.getByLabel(/^Game$/)).toHaveValue("generic");
    await advance(page);
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("90");
  });

  test("picking Root reseeds expected turns", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    await advance(page);
    // Root's default is 40 (post-2026-05 tune).
    await expect(page.getByLabel(/expected turns/i)).toHaveValue("40");
  });

  test("Root caps the seat count at maxPlayers (6)", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    // Game → Turns → Expansions → Map → Deck → Landmarks → Seating
    for (let i = 0; i < 6; i++) await advance(page);
    // Default seat count is 4; max is 6 → 2 add-seat clicks fills it.
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: /add seat/i }).click();
    }
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
    // Game → Turns → Expansions → Map.
    await advance(page);
    await advance(page);
    // Default expansions: just "base"; turn the rest on so all maps show.
    await page.getByLabel(/Riverfolk Expansion/).check();
    await page.getByLabel(/Underworld Expansion/).check();
    await page.getByLabel(/Marauder Expansion/).check();
    await page.getByLabel(/Homeland Expansion/).check();
    await advance(page);
    await expect(page.getByRole("heading", { name: /^Map$/ })).toBeVisible();
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
    await advance(page);
    await advance(page);
    await page.getByLabel(/Riverfolk Expansion/).check();
    await page.getByLabel(/Marauder Expansion/).check();
    await advance(page); // map screen
    await advance(page); // deck screen
    await expect(page.getByRole("heading", { name: /^Deck$/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Base deck/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Exiles and Partisans/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Squires and Disciples/ }),
    ).toBeVisible();
  });

  test("Generic shows no setup-step screens", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    // Generic only has Game + Turns + Players. The next button on the
    // Players screen reads "Start Game" not "Next".
    await advance(page);
    await advance(page);
    await expect(
      page.getByRole("heading", { name: /Players \(optional\)/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start game/i }),
    ).toBeVisible();
  });

  test("faction mutex: Vagabond + Knaves of the Deepwood can't both be picked", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("root");
    // Walk to the faction picker: Game→Turns→Expansions→Map→Deck→Landmarks→Seating→Hirelings→Draft→Faction
    // = 9 Next clicks. We also need Homeland on to surface Knaves.
    await advance(page);
    await advance(page);
    await page.getByLabel(/Homeland Expansion/).check();
    for (let i = 0; i < 7; i++) await advance(page);
    // First seat picks Vagabond.
    await page.getByTestId("faction-card-vagabond").click();
    // The Knaves card should now be visually disabled (aria-disabled).
    await expect(page.getByTestId("faction-card-knaves")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
