import { test, expect, type Page } from "@playwright/test";
import { startGame } from "./_setup-helpers";

// Dev server runs under basePath "/game-timer" (see next.config.js).
const BASE = "/game-timer";

const ROOT_FACTIONS = [
  { id: "marquise", label: "Marquise de Cat" },
  { id: "eyrie", label: "Eyrie Dynasties" },
  { id: "alliance", label: "Woodland Alliance" },
  { id: "vagabond", label: "Vagabond" },
];

// Seat each player AS their faction so the assertions below (which key
// off player.name in score-button aria-labels) keep working.
const startRoot = (page: Page, playerCount = 2) =>
  startGame(page, {
    game: "root",
    playerCount,
    factions: ROOT_FACTIONS.slice(0, playerCount).map((f) => f.id),
    seatNames: ROOT_FACTIONS.slice(0, playerCount).map((f) => f.label),
  });

// Marker (selects which player the +/- controls target).
const marker = (page: Page, playerName: string) =>
  page.getByRole("button", {
    name: new RegExp(`^${playerName} score `, "i"),
  });
const incButton = (page: Page, playerName: string) =>
  page.getByRole("button", {
    name: new RegExp(`Increase score for ${playerName}`, "i"),
  });
const decButton = (page: Page, playerName: string) =>
  page.getByRole("button", {
    name: new RegExp(`Decrease score for ${playerName}`, "i"),
  });

const selectAndPump = async (page: Page, name: string, delta: number) => {
  await marker(page, name).click();
  if (delta > 0) {
    for (let i = 0; i < delta; i++) await incButton(page, name).click();
  } else {
    for (let i = 0; i < -delta; i++) await decButton(page, name).click();
  }
};

test.describe("score layer", () => {
  test("no score panel when the picked definition has no scoreConfig (Generic)", async ({
    page,
  }) => {
    await startGame(page, { trackPlayers: true, playerCount: 2 });
    await expect(page.getByLabel(/^Scores$/)).toHaveCount(0);
  });

  test.skip(
    "no score panel when Root is picked but player tracking is off",
    async () => {
      // Premise no longer applies: in the wizard, Root's seat-players
      // step is part of the flow, so you can't reach the timer without
      // seats. If we want to verify "no players", we'd need to allow
      // 0-seat Root — not currently supported.
    },
  );

  test("Root + players renders a track marker per faction, starting at min", async ({
    page,
  }) => {
    await startRoot(page, 3);
    const panel = page.getByLabel(/^Scores$/);
    await expect(panel).toBeVisible();
    // Each player gets a marker button.
    await expect(marker(page, "Marquise de Cat")).toBeVisible();
    await expect(marker(page, "Eyrie Dynasties")).toBeVisible();
    await expect(marker(page, "Woodland Alliance")).toBeVisible();
    // Track shows the min/max tick labels.
    await expect(panel).toContainText("0");
    await expect(panel).toContainText("30");
  });

  test("+ and - update the score for the selected player", async ({ page }) => {
    await startRoot(page, 2);
    // Marquise is the active player and so the default selection — the
    // selected-row +/- buttons target Marquise out of the gate.
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    // Selected-row score reads 3.
    await expect(
      page.getByLabel(/^Scores$/).getByText(/^3$/),
    ).toBeVisible();

    await decButton(page, "Marquise de Cat").click();
    await expect(
      page.getByLabel(/^Scores$/).getByText(/^2$/),
    ).toBeVisible();

    // Selecting Eyrie's marker re-points the +/- controls to Eyrie.
    await marker(page, "Eyrie Dynasties").click();
    await incButton(page, "Eyrie Dynasties").click();
    await expect(
      page.getByLabel(/^Scores$/).getByText(/^1$/),
    ).toBeVisible();
    // Marquise's recorded score didn't change — verify by re-selecting.
    await marker(page, "Marquise de Cat").click();
    await expect(
      page.getByLabel(/^Scores$/).getByText(/^2$/),
    ).toBeVisible();
  });

  test("- is disabled at min, + is disabled at max (Root: 0..30)", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await expect(decButton(page, "Marquise de Cat")).toBeDisabled();
    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
    }
    await expect(incButton(page, "Marquise de Cat")).toBeDisabled();
  });

  test("clicking score buttons does not also trigger tap-to-advance", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await page.locator("main").click();
    await page.locator("main").click();
    await expect(page.getByText(/39\s*turns left/i)).toBeVisible();
    // After the turn rotation, Eyrie is the active player → auto-selected.
    await incButton(page, "Eyrie Dynasties").click();
    await expect(page.getByText(/39\s*turns left/i)).toBeVisible();
  });

  test("hitting Root's max (30) fires a victory banner and stops the active-player banner", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await expect(page.getByRole("status")).toHaveCount(0);

    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
    }

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Marquise de Cat");
    await expect(banner).toContainText(/wins/i);
    // Active-player banner replaced by the victory banner.
    await expect(page.getByText(/.*’s turn/)).toHaveCount(0);
  });
});
