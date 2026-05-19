import { test, expect, type Page } from "@playwright/test";
import { startGame as walkWizard } from "./_setup-helpers";

// `walkWizard` drives the multi-screen wizard. The local startGame
// preserves this test file's existing "playerCount enables tracking"
// shorthand from when the modal had a single checkbox.
const startGame = (
  page: Page,
  options: { expectedTurns?: number; playerCount?: number } = {},
) =>
  walkWizard(page, {
    expectedTurns: options.expectedTurns,
    trackPlayers: options.playerCount !== undefined,
    playerCount: options.playerCount,
  });

// Helper: advance one turn via the tap-to-advance zone. The very first
// tap starts the timer; subsequent taps record a turn each.
const tapToAdvance = async (page: Page) => {
  await page.locator("main").click();
};

const undoButton = (page: Page) =>
  page.getByRole("button", { name: /undo last turn/i });

test.describe("undo", () => {
  test("is disabled before any turns are taken", async ({ page }) => {
    await startGame(page);
    // Even after the first tap starts the timer, no turn has been
    // *recorded* yet — the undo button should remain disabled.
    await tapToAdvance(page);
    await expect(undoButton(page)).toBeDisabled();
    await expect(page.getByText(/90\s*turns left/i)).toBeVisible();
  });

  test("restores the remaining-turns counter after a single turn", async ({
    page,
  }) => {
    await startGame(page, { expectedTurns: 30 });
    await tapToAdvance(page); // start timer
    await tapToAdvance(page); // record turn 1

    await expect(page.getByText(/29\s*turns left/i)).toBeVisible();
    await expect(undoButton(page)).toBeEnabled();

    await undoButton(page).click();

    await expect(page.getByText(/30\s*turns left/i)).toBeVisible();
    await expect(undoButton(page)).toBeDisabled();
  });

  test("rotates the active player back to the previous one", async ({
    page,
  }) => {
    await startGame(page, { playerCount: 3 });
    await tapToAdvance(page); // start timer; Player 1 on the clock
    await expect(page.getByText(/Player 1.*’s turn/)).toBeVisible();

    await tapToAdvance(page); // end Player 1; Player 2 on the clock
    await expect(page.getByText(/Player 2.*’s turn/)).toBeVisible();

    await tapToAdvance(page); // end Player 2; Player 3 on the clock
    await expect(page.getByText(/Player 3.*’s turn/)).toBeVisible();

    await undoButton(page).click();
    await expect(page.getByText(/Player 2.*’s turn/)).toBeVisible();

    await undoButton(page).click();
    await expect(page.getByText(/Player 1.*’s turn/)).toBeVisible();
  });

  test("clicking undo does not also trigger the tap-to-advance handler", async ({
    page,
  }) => {
    await startGame(page, { expectedTurns: 30 });
    await tapToAdvance(page); // start timer
    await tapToAdvance(page); // turn 1
    await tapToAdvance(page); // turn 2
    await expect(page.getByText(/28\s*turns left/i)).toBeVisible();

    // One click on undo should pop ONE turn (29 left), not pop one AND
    // re-advance to a new turn (which would yield something else).
    await undoButton(page).click();
    await expect(page.getByText(/29\s*turns left/i)).toBeVisible();
  });

  test("supports multiple undos popping turns LIFO", async ({ page }) => {
    await startGame(page, { expectedTurns: 30 });
    await tapToAdvance(page); // start timer
    await tapToAdvance(page); // turn 1
    await tapToAdvance(page); // turn 2
    await tapToAdvance(page); // turn 3
    await expect(page.getByText(/27\s*turns left/i)).toBeVisible();

    await undoButton(page).click();
    await expect(page.getByText(/28\s*turns left/i)).toBeVisible();
    await undoButton(page).click();
    await expect(page.getByText(/29\s*turns left/i)).toBeVisible();
    await undoButton(page).click();
    await expect(page.getByText(/30\s*turns left/i)).toBeVisible();
    await expect(undoButton(page)).toBeDisabled();
  });
});
