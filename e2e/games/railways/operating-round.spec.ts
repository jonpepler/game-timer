import { expect, type Page, test } from "@playwright/test";
import {
  changePriceOutOfTurn,
  chooseNextRound,
  DEVICES,
  endStockRound,
  endTurnWithPriceChange,
  expectCompanies,
  expectDefaultNextRound,
  expectRoundComplete,
  expectTurn,
  foundCompanies,
  keepPlaying,
  mergeCompanies,
  openPricePrompt,
  press,
  pricePrompt,
  removeCompany,
  dismissRoundPrompt,
  ROUND,
  startRailways,
  stepButton,
  tapRing,
  undo,
} from "./railways.helpers";

/*
 * Railways of the Lost Atlas, 2nd edition rulebook: Operating Rounds
 * (pp12-17) and Token Movement on the Stock Track (p11). Page numbers
 * are the printed ones.
 */

/*
 * Each test walks the whole setup wizard and then plays rounds, which takes
 * up to 16s with 8 workers and more than the 30s default during load spikes.
 */
test.describe.configure({ timeout: 60_000 });

type Launch = [name: string, price: number, president: string];

/** Launch companies in the first Stock Round, then start OR1. */
const toOperatingRound = async (page: Page, companies: Launch[]) => {
  await startRailways(page);
  await foundCompanies(page, companies);
  await endStockRound(page, "Player 1");
};

for (const [device, use] of DEVICES) {
  test.describe(`Railways Operating Round (${device})`, () => {
    test.use(use);

    test("p12: companies operate in descending stock price order, equal prices from top to bottom, each under its president", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Expansive", 80, "Player 2"],
        ["Express", 90, "Player 1"],
        ["Resourceful", 80, "Player 3"],
        ["Tunneling", 70, "Player 4"],
      ]);
      await expectCompanies(page, [
        "Express 90",
        "Expansive 80",
        "Resourceful 80",
        "Tunneling 70",
      ]);
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "up");
      await expectTurn(page, "Expansive", "Player 2");
      await endTurnWithPriceChange(page, "up");
      await expectTurn(page, "Resourceful", "Player 3");
      await endTurnWithPriceChange(page, "up");
      await expectTurn(page, "Tunneling", "Player 4");
    });

    test("p15 Distributing earnings: withhold or no train drops one increment, a payout below the price holds, at least the price rises one, at least double rises two", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 100, "Player 1"]]);
      const prompt = await openPricePrompt(page, "Express");
      await expect(prompt).toContainText("100");
      await expect(stepButton(page, "down")).toContainText("90");
      await expect(stepButton(page, "same")).toContainText("100");
      await expect(stepButton(page, "up")).toContainText("110");
      await expect(stepButton(page, "up2")).toContainText("120");
      await press(page, stepButton(page, "up2"));
      await dismissRoundPrompt(page);
      await expectCompanies(page, ["Express 120*"]);
    });

    test("p2 stock track: above 120 the increments are 135, then 150", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 120, "Player 1"]]);
      await openPricePrompt(page, "Express");
      await expect(stepButton(page, "up")).toContainText("135");
      await expect(stepButton(page, "up2")).toContainText("150");
      await press(page, stepButton(page, "up"));
      await dismissRoundPrompt(page);
      await expectCompanies(page, ["Express 135*"]);
    });

    test("p11 Token Movement: a company that pays out less than its price keeps it and moves to the bottom of that column as if it just entered", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Expansive", 80, "Player 1"],
        ["Resourceful", 80, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "same", "Expansive");
      await expectCompanies(page, ["Resourceful 80", "Expansive 80*"]);
      await expectTurn(page, "Resourceful", "Player 2");
    });

    test("p11 Token Movement: a token entering a column goes below those already there", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "down", "Express");
      await expectCompanies(page, ["Expansive 80", "Express 80*"]);
    });

    test("p11 Token Movement: flipped tokens stop a company that dropped below others from operating again", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
        ["Tunneling", 60, "Player 3"],
      ]);
      // Express drops to 80, below Expansive, which has yet to operate.
      await endTurnWithPriceChange(page, "down", "Express");
      await expectTurn(page, "Expansive");
      // Expansive drops to 70; Express is still above it but has acted.
      await endTurnWithPriceChange(page, "down", "Expansive");
      await expectCompanies(page, [
        "Express 80*",
        "Expansive 70*",
        "Tunneling 60",
      ]);
      await expectTurn(page, "Tunneling");
      // Tunneling rises past both; nobody operates twice.
      await endTurnWithPriceChange(page, "up2", "Tunneling");
      await expectRoundComplete(page, ROUND.operating);
      await dismissRoundPrompt(page);
      await expectCompanies(page, [
        "Express 80*",
        "Tunneling 80*",
        "Expansive 70*",
      ]);
    });

    test("p11: at the end of an Operating Round every token is flipped back, and the next round runs in the new price order", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "down", "Express");
      await endTurnWithPriceChange(page, "up2", "Tunneling");
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.operating);
      await expectCompanies(page, ["Tunneling 90", "Express 80"]);
      await expectTurn(page, "Tunneling", "Player 2");
    });

    test("p12 and p19: each cycle has two consecutive Operating Rounds, then the Merger Round", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 90, "Player 1"]]);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      await expectDefaultNextRound(page, ROUND.operating);
      await chooseNextRound(page, ROUND.operating);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      await expectDefaultNextRound(page, ROUND.merger);
    });

    test("p18: before the first green train there is no Merger Round; play goes on to the next Stock Round", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 90, "Player 1"]]);
      await endTurnWithPriceChange(page, "same", "Express");
      await chooseNextRound(page, ROUND.operating);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.stock);
      await expectTurn(page, "Player 1");
    });

    test("p12 Issue a share: the price drops one spot during the company's own turn and it keeps operating", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await expectTurn(page, "Express");
      await changePriceOutOfTurn(page, "Express", "down");
      await expectCompanies(page, ["Expansive 80", "Express 80"]);
      await expectTurn(page, "Express", "Player 1");
      // Then it pays out at least its new price.
      await openPricePrompt(page, "Express");
      await expect(stepButton(page, "up")).toContainText("90");
      await press(page, stepButton(page, "up"));
      await expectCompanies(page, ["Express 90*", "Expansive 80"]);
      await expectTurn(page, "Expansive");
    });

    test("p11: a company whose price reaches 0 by withholding is dissolved and the next company operates", async ({
      page,
    }) => {
      await startRailways(page);
      await foundCompanies(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 60, "Player 2"],
      ]);
      // Worn down by earlier sales and withholds.
      await changePriceOutOfTurn(page, "Express", 10);
      await endStockRound(page, "Player 1");
      await expectTurn(page, "Tunneling");
      await endTurnWithPriceChange(page, "same", "Tunneling");
      await openPricePrompt(page, "Express");
      await expect(stepButton(page, "down")).toContainText("0");
      await press(page, stepButton(page, "down"));
      await expectRoundComplete(page, ROUND.operating);
      await dismissRoundPrompt(page);
      await expectCompanies(page, ["Tunneling 60*"]);
    });

    test("p17 Bankruptcy: every company the bankrupt president ran is removed and play resumes with the next company", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 100, "Player 1"],
        ["Tunneling", 90, "Player 2"],
        ["Suburban", 80, "Player 1"],
      ]);
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "bankrupt", "Express");
      await removeCompany(page, "Suburban");
      await expectCompanies(page, ["Tunneling 90"]);
      await expectTurn(page, "Tunneling", "Player 2");
    });

    test("p15: a mis-recorded payout can be undone, restoring the price and order", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "down", "Express");
      await expectCompanies(page, ["Expansive 80", "Express 80*"]);
      await undo(page);
      await expectCompanies(page, ["Express 90", "Expansive 80"]);
      await expectTurn(page, "Express");
    });

    test("p15: after undoing a payout, ending the turn again asks for the price move again", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "down", "Express");
      await undo(page);
      await tapRing(page);
      await expect(pricePrompt(page)).toHaveAccessibleName(
        "End Express’s turn",
      );
      await press(page, stepButton(page, "up"));
      await expectCompanies(page, ["Express 100*", "Expansive 80"]);
    });

    test("p11: a flipped token reads as played this round", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await endTurnWithPriceChange(page, "same", "Express");
      await expectCompanies(page, ["Express 90*", "Expansive 80"]);
      await expect(
        page.getByRole("button", {
          name: "Actions for Express, played this round",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Actions for Expansive",
          exact: true,
        }),
      ).toBeVisible();
    });

    test("p17 Forced train purchase: the president's share sales drop other companies one increment each, and the rest of the round follows the new order", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 100, "Player 1"],
        ["Tunneling", 90, "Player 2"],
        ["Suburban", 80, "Player 3"],
      ]);
      await expectTurn(page, "Express", "Player 1");
      // Player 1 sells Tunneling shares to buy Express a train.
      await changePriceOutOfTurn(page, "Tunneling", "down");
      await expectCompanies(page, [
        "Express 100",
        "Suburban 80",
        "Tunneling 80",
      ]);
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "same", "Express");
      await expectTurn(page, "Suburban", "Player 3");
      await endTurnWithPriceChange(page, "same", "Suburban");
      await expectTurn(page, "Tunneling", "Player 2");
    });

    test("p15: the president can step back from the price question and keep operating", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
      ]);
      await openPricePrompt(page, "Express");
      await keepPlaying(page);
      await expectTurn(page, "Express", "Player 1");
      await expectCompanies(page, ["Express 90", "Expansive 80"]);
      await endTurnWithPriceChange(page, "up", "Express");
      await expectTurn(page, "Expansive", "Player 2");
    });

    test("agreed, any time: a company launched during an Operating Round takes its place in the companies still to operate", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 100, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      await expectTurn(page, "Express", "Player 1");
      // A launch the table forgot to record in the Stock Round.
      await foundCompanies(page, [["Suburban", 80, "Player 3"]]);
      await expectCompanies(page, [
        "Express 100",
        "Suburban 80",
        "Tunneling 70",
      ]);
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "same", "Express");
      await expectTurn(page, "Suburban", "Player 3");
      await endTurnWithPriceChange(page, "same", "Suburban");
      await expectTurn(page, "Tunneling", "Player 2");
    });

    test("agreed, any time: two minors merged during an Operating Round operate once, as the Corporation, in its price order", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Express", 100, "Player 1"],
        ["Tunneling", 80, "Player 2"],
        ["Suburban", 60, "Player 2"],
      ]);
      await expectTurn(page, "Express", "Player 1");
      await mergeCompanies(page, {
        minors: ["Tunneling", "Suburban"],
        major: "Union",
        president: "Player 2",
      });
      await expectCompanies(page, [
        "Express 100",
        "Tunneling Suburban Union 70",
      ]);
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "same", "Express");
      await expectTurn(page, "Tunneling Suburban Union", "Player 2");
      await endTurnWithPriceChange(page, "same", "Tunneling Suburban Union");
      await expectRoundComplete(page, ROUND.operating);
    });

    test("p12 and agreed undo: taking back the choice of the next round asks what comes next again", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 90, "Player 1"]]);
      await endTurnWithPriceChange(page, "same", "Express");
      await chooseNextRound(page, ROUND.operating);
      await expectTurn(page, "Express", "Player 1");

      // The first green train had been bought: a Merger Round was due.
      await undo(page);
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.merger);
      await expectTurn(page, "Express", "Player 1");
    });
  });
}
