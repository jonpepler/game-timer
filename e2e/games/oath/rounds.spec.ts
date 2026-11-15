import { expect, test } from "@playwright/test";
import {
  DEVICES,
  endDiePrompt,
  endTurns,
  expectRound,
  expectTurn,
  expectWinner,
  gameOverScreen,
  LABEL,
  press,
  startOath,
} from "./oath.helpers";

/*
 * Oath: New Foundations, the round track and the end of the game:
 * OR §6 "Ending a Round", RB p19.
 */

test.describe.configure({ timeout: 90_000 });

const playOn = async (page: import("@playwright/test").Page, round: number) => {
  const prompt = endDiePrompt(page, round);
  await press(page, prompt.getByRole("button", { name: LABEL.playOn }));
  await expect(prompt).toBeHidden();
};

for (const [device, use] of DEVICES) {
  test.describe(`Oath rounds (${device})`, () => {
    test.use(use);

    test("OR §6 (RB p19): the round marker advances once each player has taken a turn", async ({
      page,
    }) => {
      await startOath(page, { players: 3 });
      await expectRound(page, 1);
      await endTurns(page, 2);
      await expectRound(page, 1);
      await endTurns(page, 1);
      await expectRound(page, 2);
      await expectTurn(page, "Player 1");
    });

    test("OR §6 (RB p19): no end die is rolled before the end of round five", async ({
      page,
    }) => {
      await startOath(page, { players: 2, chancellor: "Player 1" });
      await endTurns(page, 8);
      await expectRound(page, 5);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    });

    test("OR §6 (RB p19): with an Empire, the end die decides at the end of rounds five (6), six (5 or 6) and seven (3 to 6)", async ({
      page,
    }) => {
      await startOath(page, { players: 2, chancellor: "Player 1" });
      await endTurns(page, 10);
      await expect(endDiePrompt(page, 5)).toContainText(/\b6\b/);
      await playOn(page, 5);
      await expectRound(page, 6);
      await endTurns(page, 2);
      await expect(endDiePrompt(page, 6)).toContainText(/5 or 6/);
      await playOn(page, 6);
      await endTurns(page, 2);
      await expect(endDiePrompt(page, 7)).toContainText(/3 to 6/);
      await playOn(page, 7);
      await expectRound(page, 8);
    });

    test("OR §6 (RB p19): a Stable Regime roll ends the game and the Chancellor wins", async ({
      page,
    }) => {
      await startOath(page, { players: 2, chancellor: "Player 2" });
      await endTurns(page, 10);
      await press(
        page,
        endDiePrompt(page, 5).getByRole("button", {
          name: LABEL.chancellorWins,
        }),
      );
      await expectWinner(page, "Player 2");
    });

    test("RB p9, p19 (OR §4, §6): with no Empire there is no end die", async ({
      page,
    }) => {
      await startOath(page, { players: 2 });
      await endTurns(page, 14);
      await expectRound(page, 8);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    });

    test("OR §6 (RB p19): at the end of round eight the game ends in War Exhaustion", async ({
      page,
    }) => {
      await startOath(page, { players: 2 });
      await endTurns(page, 16);
      await expect(gameOverScreen(page)).toContainText("War Exhaustion");
    });
  });
}
