import { expect, type Page, test } from "@playwright/test";
import { expectCountdownFrom, ring } from "../../_countdown-helpers";
import { startGame } from "../../_setup-helpers";

/*
 * Root's first countdown, before any turn is recorded, is its default
 * average of four minutes rather than the generic five.
 */

const startRoot = (page: Page) =>
  startGame(page, {
    game: "root",
    playerCount: 2,
    factions: ["Marquise de Cat", "Eyrie Dynasties"],
  });

test("the first countdown is Root's four-minute default", async ({ page }) => {
  await startRoot(page);
  await ring(page).click();
  await expectCountdownFrom(page, 240);
});

test("a session restored before the first tap keeps the four-minute default", async ({
  page,
}) => {
  await startRoot(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: /game setup/i })).toHaveCount(
    0,
  );
  await ring(page).click();
  await expectCountdownFrom(page, 240);
});
