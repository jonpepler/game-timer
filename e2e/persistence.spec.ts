import { test, expect, type Page } from "@playwright/test";

const BASE = "/game-timer";

const startGenericPlayers = async (
  page: Page,
  { expectedTurns, playerCount }: { expectedTurns: number; playerCount: number },
) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/expected turns/i).fill(String(expectedTurns));
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill(String(playerCount));
  await page.getByRole("button", { name: /start game/i }).click();
};

const startRoot = async (page: Page, playerCount: number) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill(String(playerCount));
  await page.getByRole("button", { name: /start game/i }).click();
};

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
    const inc = (name: string) =>
      page.getByRole("button", {
        name: new RegExp(`Increase score for ${name}`, "i"),
      });
    for (let i = 0; i < 5; i++) await inc("Marquise de Cat").click();
    for (let i = 0; i < 3; i++) await inc("Eyrie Dynasties").click();

    const panel = page.getByLabel(/^Scores$/);
    await expect(panel).toContainText("5");
    await expect(panel).toContainText("3");

    await page.reload();

    await expect(
      page.getByRole("heading", { name: /game setup/i }),
    ).toHaveCount(0);
    const restored = page.getByLabel(/^Scores$/);
    await expect(restored).toContainText("Marquise de Cat");
    await expect(restored).toContainText("Eyrie Dynasties");
    await expect(restored).toContainText("5");
    await expect(restored).toContainText("3");
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
    await page.getByLabel(/expected turns/i).fill("50");
    await page.getByRole("button", { name: /start game/i }).click();

    // Turn counter resets to the new expectedTurns; old turns are gone.
    await expect(page.getByText(/50\s*turns left/i)).toBeVisible();
    // Undo should be disabled — no turns recorded against the new session.
    await expect(
      page.getByRole("button", { name: /undo last turn/i }),
    ).toBeDisabled();
  });
});
