import { test } from "@playwright/test";
import { expectCountdownFrom, ring } from "./_countdown-helpers";
import { startGame } from "./_setup-helpers";

/*
 * Before any turn is recorded, the countdown runs for the game's own
 * default average. The generic game's default is five minutes.
 */

test("a generic game's first countdown is five minutes", async ({ page }) => {
  await startGame(page);
  await ring(page).click();
  await expectCountdownFrom(page, 300);
});
