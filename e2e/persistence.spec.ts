import { test, expect, type Page } from "@playwright/test";
import { incrementScoreWithMilestones, startGame } from "./_setup-helpers";

const BASE = "/game-timer";

const startGenericPlayers = (
  page: Page,
  {
    expectedTurns,
    playerCount,
  }: { expectedTurns: number; playerCount: number },
) =>
  startGame(page, {
    expectedTurns,
    trackPlayers: true,
    playerCount,
  });

// Root with N seats — first N factions in the canonical order.
const ROOT_FACTION_LABELS = [
  "Marquise de Cat",
  "Eyrie Dynasties",
  "Woodland Alliance",
  "Vagabond",
  "Lizard Cult",
  "Riverfolk Company",
];
const startRoot = (page: Page, playerCount: number) =>
  startGame(page, {
    game: "root",
    playerCount,
    factions: ROOT_FACTION_LABELS.slice(0, playerCount),
  });

const tapToAdvance = (page: Page) => page.locator("main").click();

test.describe("session persistence", () => {
  test("Generic-with-players: turn log + remaining count survive a refresh", async ({
    page,
  }) => {
    await startGenericPlayers(page, { expectedTurns: 30, playerCount: 2 });
    await tapToAdvance(page); // start timer
    await tapToAdvance(page); // turn 1
    await tapToAdvance(page); // turn 2
    await expect(page.getByText(/28\s*turns left/i)).toBeVisible();
    await expect(page.getByText(/Player 1.*’s turn/)).toBeVisible();

    await page.reload();

    // Modal should NOT reappear because there's an in-progress session.
    await expect(
      page.getByRole("heading", { name: /game setup/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/28\s*turns left/i)).toBeVisible();
    // Round-robin position preserved: 2 turns done = Player 1 again.
    await expect(page.getByText(/Player 1.*’s turn/)).toBeVisible();
  });

  test("Root: scores + faction roster survive a refresh", async ({ page }) => {
    await startRoot(page, 2);
    // Score buttons are labelled by player.name (default "Player 1",
    // "Player 2" — the seating step's default names).
    const marker = (name: string) =>
      page.getByRole("button", {
        name: new RegExp(`^${name} score `, "i"),
      });
    // Root's score config declares hireling-trigger milestones at
    // 4, 8, 12 — Player 1 → 5 crosses the 4-VP dialog which has to
    // be acknowledged before the next + click registers.
    await incrementScoreWithMilestones(page, "Player 1", 5);
    await marker("Player 2").click();
    await incrementScoreWithMilestones(page, "Player 2", 3);

    await page.reload();

    await expect(
      page.getByRole("heading", { name: /game setup/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Player 1 score 5/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Player 2 score 3/i }),
    ).toBeVisible();
  });

  test("New game button opens the modal without clearing the session", async ({
    page,
  }) => {
    await startGenericPlayers(page, { expectedTurns: 30, playerCount: 2 });
    await tapToAdvance(page); // start
    await tapToAdvance(page); // turn 1
    await expect(page.getByText(/29\s*turns left/i)).toBeVisible();

    await page.getByRole("button", { name: /start a new game/i }).click();
    await expect(
      page.getByRole("heading", { name: /game setup/i }),
    ).toBeVisible();

    // Cancel — session should be intact.
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(
      page.getByRole("heading", { name: /game setup/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/29\s*turns left/i)).toBeVisible();
  });

  test("Submitting Start Game mid-game RESETs the prior turn log", async ({
    page,
  }) => {
    await startGenericPlayers(page, { expectedTurns: 30, playerCount: 2 });
    await tapToAdvance(page);
    await tapToAdvance(page);
    await tapToAdvance(page);
    await expect(page.getByText(/28\s*turns left/i)).toBeVisible();

    await page.getByRole("button", { name: /start a new game/i }).click();
    // Wizard opens at the Game screen. Next → Expected turns screen.
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByLabel(/expected turns/i).fill("50");
    await page.getByRole("button", { name: /^Next/ }).click();
    // Generic Players screen → Start.
    await page.getByRole("button", { name: /start game/i }).click();

    // Turn counter resets to the new expectedTurns; old turns are gone.
    await expect(page.getByText(/50\s*turns left/i)).toBeVisible();
    // Undo should be disabled — no turns recorded against the new session.
    await expect(
      page.getByRole("button", { name: /undo last turn/i }),
    ).toBeDisabled();
  });
});
