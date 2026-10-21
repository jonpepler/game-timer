import { expect, type Page, test } from "@playwright/test";
import { expectCountdownFrom, ring } from "../../_countdown-helpers";
import { navigateToScreen, startGame } from "../../_setup-helpers";

/*
 * Arcs's first countdown, before any turn is recorded, is its default
 * average of four minutes rather than the generic five.
 */

/** Walk the open wizard from its Game screen into a two-seat Arcs game. */
const setUpArcs = async (page: Page) => {
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /seat players/i);
  for (let i = 4; i > 2; i--)
    await page.getByRole("button", { name: `Remove seat ${i}` }).click();
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  for (const leader of ["Elder", "Mystic"]) {
    await page
      .getByRole("button", { name: leader, exact: true })
      .press("Enter");
    await page.getByRole("button", { name: /^Confirm setup$/ }).click();
  }
  const startBtn = page.getByRole("button", { name: /start game/i });
  for (let i = 0; i < 6; i++) {
    if (await startBtn.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await startBtn.click();
  await expect(page.getByText(/turns left/i)).toBeVisible({ timeout: 15_000 });
};

test("the first countdown is Arcs's four-minute default", async ({ page }) => {
  await page.goto("/game-timer/timer");
  await setUpArcs(page);
  await ring(page).click();
  await expectCountdownFrom(page, 240);
});

test("a new Arcs game after a generic one starts at four minutes", async ({
  page,
}) => {
  await startGame(page);
  await ring(page).click();
  await expectCountdownFrom(page, 300);
  await ring(page).click();

  await page.getByRole("button", { name: /start a new game/i }).click();
  await setUpArcs(page);
  await ring(page).click();
  await expectCountdownFrom(page, 240);
});
