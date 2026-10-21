import { expect, type Page, test } from "@playwright/test";
import {
  chooseNextRound,
  DEVICES,
  dismissRoundPrompt,
  endStockRound,
  endStockTurn,
  endTurnWithPriceChange,
  expectNoScoreTracking,
  expectRoundComplete,
  expectTimeShares,
  expectTurn,
  foundCompanies,
  installClock,
  letTimePass,
  ROUND,
  reopenRoundPrompt,
  setPresident,
  startRailways,
} from "./railways.helpers";

/*
 * Whose time is whose. The rulebook has players act in the Stock Round
 * (p10) and presidents make every decision for their company in the
 * Operating Rounds (p12); the agreed timer credits a company's turn to
 * its president at the time, credits the turn running when the table
 * switches rounds, and keeps no score (p19 scores only at the end). The
 * page clock is taken over so each turn lasts exactly as long as stated.
 */

/*
 * Each test walks the whole setup wizard and then plays rounds, which takes
 * up to 16s with 8 workers and more than the 30s default during load spikes.
 */
test.describe.configure({ timeout: 60_000 });

const expectCountdown = (page: Page, time: string) =>
  expect(page.getByRole("button", { name: "Advance turn" })).toContainText(
    time,
  );

for (const [device, use] of DEVICES) {
  test.describe(`Railways timing (${device})`, () => {
    test.use(use);

    test("p12 and agreed: a company's operating time is credited to its president", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 3"]]);
      await letTimePass(page, 40);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      await endStockRound(page, "Player 1");

      // Player 3 never took a Stock Round turn, but presides over Express.
      await expectTurn(page, "Express", "Player 3");
      await letTimePass(page, 120);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      await expectTimeShares(page, { "Player 1": 25, "Player 3": 75 });
    });

    test("p4 and p11 Change of ownership: after the presidency moves, the company's next turn is credited to the new president", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 3"]]);
      await endStockRound(page, "Player 1");

      await letTimePass(page, 90);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      // Look at the board first: Player 4 bought control between rounds.
      await dismissRoundPrompt(page);
      await setPresident(page, "Express", "Player 4");
      await reopenRoundPrompt(page);
      await chooseNextRound(page, ROUND.operating);

      await expectTurn(page, "Express", "Player 4");
      await letTimePass(page, 80);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      await expectTimeShares(page, { "Player 3": 52.9, "Player 4": 47.1 });
    });

    test("each kind of round keeps its own average turn time", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 3"]]);
      // The Stock Round opens on its declared 45s.
      await expectCountdown(page, "00:45");
      // Turns end inside the countdown: fastForward jumps the page clock,
      // so it would skip the overtime count of a longer turn.
      await letTimePass(page, 40);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      await expectCountdown(page, "00:40");
      await letTimePass(page, 20);
      await endStockTurn(page);
      await expectTurn(page, "Player 3");
      await expectCountdown(page, "00:30");

      // The Operating Round starts from its own 2:30, not the Stock Round's.
      await endStockRound(page, "Player 1");
      await expectTurn(page, "Express", "Player 3");
      await expectCountdown(page, "02:30");
    });

    test("p11 End of Stock Round, agreed: ending the round mid-turn credits the time of the turn that was running", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 3"]]);
      await letTimePass(page, 40);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");

      // Everyone passes; Player 2's thinking time still counts.
      await letTimePass(page, 30);
      await endStockRound(page, "Player 3");
      await expectTurn(page, "Express", "Player 3");
      await expectTimeShares(page, { "Player 1": 57.1, "Player 2": 42.9 });
    });

    test("p19 End of Game: the score is counted only at the end, so the timer keeps none", async ({
      page,
    }) => {
      await startRailways(page);
      await expectNoScoreTracking(page);
      await foundCompanies(page, [["Express", 90, "Player 1"]]);
      await endStockRound(page, "Player 1");
      await expectTurn(page, "Express", "Player 1");
      await expectNoScoreTracking(page);
    });
  });
}
