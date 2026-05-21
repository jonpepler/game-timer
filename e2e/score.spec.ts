import { test, expect, type Page } from "@playwright/test";
import { dismissMilestoneIfShown, startGame } from "./_setup-helpers";

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
    factions: ROOT_FACTIONS.slice(0, playerCount).map((f) => f.label),
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
    for (let i = 0; i < delta; i++) {
      await incButton(page, name).click();
      // Root's milestones at 4/8/12 open a fullscreen dialog that
      // blocks every subsequent + click. Dismiss between clicks so
      // the loop keeps progressing.
      await dismissMilestoneIfShown(page);
    }
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

  test.skip("no score panel when Root is picked but player tracking is off", async () => {
    // Premise no longer applies: in the wizard, Root's seat-players
    // step is part of the flow, so you can't reach the timer without
    // seats. If we want to verify "no players", we'd need to allow
    // 0-seat Root — not currently supported.
  });

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
    // selected-row +/- buttons target Marquise out of the gate. We
    // assert against each player's marker aria-label rather than the
    // selected-row text so the assertion can't be satisfied by any
    // other "N" elsewhere on the score panel (track ticks, the other
    // player coincidentally holding the same score).
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    await incButton(page, "Marquise de Cat").click();
    await expect(marker(page, "Marquise de Cat")).toHaveAccessibleName(
      /score 3$/i,
    );

    await decButton(page, "Marquise de Cat").click();
    await expect(marker(page, "Marquise de Cat")).toHaveAccessibleName(
      /score 2$/i,
    );

    // Selecting Eyrie's marker re-points the +/- controls to Eyrie.
    await marker(page, "Eyrie Dynasties").click();
    await incButton(page, "Eyrie Dynasties").click();
    await expect(marker(page, "Eyrie Dynasties")).toHaveAccessibleName(
      /score 1$/i,
    );
    // Marquise's recorded score didn't change.
    await expect(marker(page, "Marquise de Cat")).toHaveAccessibleName(
      /score 2$/i,
    );
  });

  test("- is disabled at min, + is disabled at max (Root: 0..30)", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await expect(decButton(page, "Marquise de Cat")).toBeDisabled();
    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
      await dismissMilestoneIfShown(page);
    }
    await expect(incButton(page, "Marquise de Cat")).toBeDisabled();
  });

  test("clicking score buttons does not also trigger tap-to-advance", async ({
    page,
  }) => {
    await startRoot(page, 2);
    // Wizard now ends on the A.10 info step which doesn't pass
    // autoStart — Start Game just commits the config. First tap
    // starts the timer (state.started → true, no turn recorded);
    // second tap records turn 1, rotating Marquise → Eyrie and
    // dropping remaining to 15.
    await page.locator("main").click();
    await page.locator("main").click();
    await expect(page.getByText(/15\s*turns left/i)).toBeVisible();
    // Eyrie is the active player now → auto-selected. Clicking the
    // score adder must NOT bubble into the tap-to-advance handler.
    await incButton(page, "Eyrie Dynasties").click();
    await expect(page.getByText(/15\s*turns left/i)).toBeVisible();
  });

  test("hitting Root's max (30) fires a victory banner and stops the active-player banner", async ({
    page,
  }) => {
    await startRoot(page, 2);
    await expect(page.getByRole("status")).toHaveCount(0);

    for (let i = 0; i < 30; i++) {
      await incButton(page, "Marquise de Cat").click();
      await dismissMilestoneIfShown(page);
    }

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Marquise de Cat");
    await expect(banner).toContainText(/wins/i);
    // The victory banner is a full-screen dismissable overlay — the
    // timer view stays mounted behind it (so the user sees the
    // final scoreboard when they dismiss). Assert the overlay's
    // dismiss affordance is present.
    await expect(
      page.getByRole("button", { name: /Dismiss victory banner/i }),
    ).toBeVisible();
  });
});
