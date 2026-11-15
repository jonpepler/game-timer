import { expect, test } from "@playwright/test";
import {
  DEVICES,
  endDiePrompt,
  endTurns,
  gameOverScreen,
  LABEL,
  press,
  startOath,
} from "./oath.helpers";

/*
 * Oath: New Foundations, what comes after the game: OR §14 "Chronicle
 * Phase", RB p36. By the table's decision the timer marks only the ends it
 * runs (Stable Regime and War Exhaustion), not Usurper or Vision wins.
 */

test.describe.configure({ timeout: 90_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Oath game end (${device})`, () => {
    test.use(use);

    test("OR §14 (RB p36): after a Stable Regime win, the table is pointed to the Chronicle task cards", async ({
      page,
    }) => {
      await startOath(page, { players: 2, chancellor: "Player 1" });
      await endTurns(page, 10);
      await press(
        page,
        endDiePrompt(page, 5).getByRole("button", {
          name: LABEL.chancellorWins,
        }),
      );
      await expect(
        page.getByRole("dialog", { name: LABEL.victory }),
      ).toContainText(/Chronicle task cards/);
    });

    test("OR §14 (RB p36): after War Exhaustion, the table is pointed to the Chronicle task cards", async ({
      page,
    }) => {
      await startOath(page, { players: 2 });
      await endTurns(page, 16);
      await expect(gameOverScreen(page)).toContainText(/Chronicle task cards/);
    });
  });
}
