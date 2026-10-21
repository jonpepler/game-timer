import { expect, type Page, test } from "@playwright/test";
import {
  changePriceOutOfTurn,
  chooseNextRound,
  closeFoundingSheet,
  DEVICES,
  dismissRoundPrompt,
  endMergerTurn,
  endStockTurn,
  endStockRound,
  endTurnWithPriceChange,
  expectCompanies,
  expectDefaultNextRound,
  expectRound,
  expectRoundComplete,
  expectTurn,
  foundCompanies,
  MODULE,
  openFoundingSheet,
  openMerge,
  press,
  openPricePrompt,
  ROUND,
  type StartOptions,
  startRailways,
  stepButton,
} from "./railways.helpers";

/*
 * Landmarks of the Lost Atlas expansion rulebook: the Metropolitan
 * Transit Department (pp6-7), Events (pp8-9), New Minors and Majors
 * (pp10-11) and the miscellaneous variants (p12). Page numbers are the
 * printed ones.
 */

/*
 * Each test walks the whole setup wizard and then plays rounds, which takes
 * up to 16s with 8 workers and more than the 30s default during load spikes.
 */
test.describe.configure({ timeout: 60_000 });

const METROPOLITAN = "Metropolitan";

type Launch = [name: string, price?: number, president?: string];

const toOperatingRound = async (
  page: Page,
  companies: Launch[],
  options: StartOptions = {},
) => {
  await startRailways(page, options);
  await foundCompanies(page, companies);
  await endStockRound(page, "Player 1");
};

/** Run one company's Operating Round turn with no change in price. */
const operateFlat = (page: Page, company: string) =>
  endTurnWithPriceChange(page, "same", company);

for (const [device, use] of DEVICES) {
  test.describe(`Railways Landmarks (${device})`, () => {
    test.use(use);

    test("p10 New Minors and Majors: Twin Cities, Circus, Coupling and Manufacturing can launch, and Authority and League join the Majors, with no module to choose", async ({
      page,
    }) => {
      await startRailways(page);
      const sheet = await openFoundingSheet(page);
      for (const minor of [
        "Twin Cities",
        "Circus",
        "Coupling",
        "Manufacturing",
      ]) {
        await expect(
          sheet.getByRole("button", { name: `Add ${minor}` }),
        ).toBeVisible();
      }
      await closeFoundingSheet(page);
      await foundCompanies(page, [
        ["Twin Cities", 80, "Player 1"],
        ["Circus", 70, "Player 2"],
      ]);
      const merge = await openMerge(page, ["Twin Cities", "Circus"]);
      for (const major of ["Authority", "League", "Union"]) {
        await expect(
          merge.getByRole("button", { name: major, exact: true }),
        ).toBeVisible();
      }
    });

    test("p1: without the Metropolitan module, the Metropolitan stays in the box", async ({
      page,
    }) => {
      await startRailways(page);
      const sheet = await openFoundingSheet(page);
      await expect(
        sheet.getByRole("button", { name: "Add Tunneling" }),
      ).toBeVisible();
      for (const name of [METROPOLITAN]) {
        await expect(
          sheet.getByRole("button", { name: `Add ${name}` }),
        ).toHaveCount(0);
      }
    });

    test("p6 Metropolitan: there is no president's certificate and its price is set for it, so it enters with nothing to choose", async ({
      page,
    }) => {
      await startRailways(page, { modules: ["metropolitan"] });
      await foundCompanies(page, [
        ["Express", 100, "Player 1"],
        [METROPOLITAN],
      ]);
      await expect(
        page.getByRole("dialog", { name: `Add ${METROPOLITAN}` }),
      ).toHaveCount(0);
      await expectCompanies(page, [`${METROPOLITAN} 100`, "Express 100"]);
    });

    test("p6 Metropolitan entering play: its price is set to the highest stock price, above all Companies and Corporations in that column", async ({
      page,
    }) => {
      await startRailways(page, { modules: ["metropolitan"] });
      await foundCompanies(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 90, "Player 2"],
        ["Tunneling", 70, "Player 3"],
        [METROPOLITAN],
      ]);
      await expectCompanies(page, [
        `${METROPOLITAN} 90`,
        "Express 90",
        "Expansive 90",
        "Tunneling 70",
      ]);
    });

    test("p6 Metropolitan entering play: the highest price may be above the launch range", async ({
      page,
    }) => {
      await startRailways(page, { modules: ["metropolitan"] });
      await foundCompanies(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      // Several rounds of payouts later, Express trades at 200.
      await changePriceOutOfTurn(page, "Express", 200);
      await foundCompanies(page, [[METROPOLITAN]]);
      await expectCompanies(page, [
        `${METROPOLITAN} 200`,
        "Express 200",
        "Tunneling 70",
      ]);
    });

    test("p7 Metropolitan Diagram 2: it operates first from the top of its column, and a negative payout drops the price one increment", async ({
      page,
    }) => {
      await toOperatingRound(
        page,
        [
          ["Express", 100, "Player 1"],
          ["Tunneling", 70, "Player 2"],
          [METROPOLITAN],
        ],
        { modules: ["metropolitan"] },
      );
      await expectTurn(page, METROPOLITAN);
      await endTurnWithPriceChange(page, "down", METROPOLITAN);
      await expectCompanies(page, [
        "Express 100",
        `${METROPOLITAN} 90*`,
        "Tunneling 70",
      ]);
      await expectTurn(page, "Express", "Player 1");
    });

    test("Base p18: the Metropolitan is not a Minor Company, so it takes no Merger Round turn", async ({
      page,
    }) => {
      await startRailways(page, { modules: ["metropolitan"] });
      await foundCompanies(page, [["Express", 90, "Player 1"], [METROPOLITAN]]);
      await endStockRound(page, "Player 1", ROUND.merger);
      await expectTurn(page, "Express");
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
    });

    test("p9 Overtime!: play a third Operating Round immediately after the second", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 90, "Player 1"]], {
        modules: ["events"],
      });
      await operateFlat(page, "Express");
      await chooseNextRound(page, ROUND.operating);
      await operateFlat(page, "Express");
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.operating);
      await expectTurn(page, "Express");
      await operateFlat(page, "Express");
      await expectDefaultNextRound(page, ROUND.merger);
    });

    test("p9 Merger Mania!: there is an extra Merger Round between Operating Round 1 and Operating Round 2", async ({
      page,
    }) => {
      await toOperatingRound(
        page,
        [
          ["Express", 90, "Player 1"],
          ["Tunneling", 70, "Player 1"],
        ],
        { modules: ["events"] },
      );
      await operateFlat(page, "Express");
      await operateFlat(page, "Tunneling");
      await chooseNextRound(page, ROUND.merger);
      await expectTurn(page, "Express");
      await endMergerTurn(page);
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
      await chooseNextRound(page, ROUND.operating);
      await operateFlat(page, "Express");
      await operateFlat(page, "Tunneling");
      await expectRoundComplete(page, ROUND.operating);
      // The cycle's regular Merger Round still follows OR2.
      await chooseNextRound(page, ROUND.merger);
    });

    test("p9 Merger Mania!: after Operating Round 2 the regular Merger Round is the default", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 90, "Player 1"]], {
        modules: ["events"],
      });
      await operateFlat(page, "Express");
      await chooseNextRound(page, ROUND.merger);
      await endMergerTurn(page);
      await chooseNextRound(page, ROUND.operating);
      await operateFlat(page, "Express");
      await expectRoundComplete(page, ROUND.operating);
      await expectDefaultNextRound(page, ROUND.merger);
    });

    test("p9 Record Gains!: a payout of at least triple the share price rises three increments", async ({
      page,
    }) => {
      await toOperatingRound(
        page,
        [
          ["Tunneling", 135, "Player 2"],
          ["Express", 100, "Player 1"],
        ],
        { modules: ["events"] },
      );
      await operateFlat(page, "Tunneling");
      await openPricePrompt(page, "Express");
      // 100 to 110, 120, 135.
      await expect(stepButton(page, "up3")).toContainText("135");
      await press(page, stepButton(page, "up3"));
      await dismissRoundPrompt(page);
      // Below Tunneling, already in that column.
      await expectCompanies(page, ["Tunneling 135*", "Express 135*"]);
    });

    test("p9 Record Gains! is an event card: without the Events module there is no three-increment rise", async ({
      page,
    }) => {
      await toOperatingRound(page, [["Express", 100, "Player 1"]]);
      await openPricePrompt(page, "Express");
      await expect(stepButton(page, "up2")).toBeVisible();
      await expect(stepButton(page, "up3")).toHaveCount(0);
    });

    test("p5 Rock Formation: the price rises two increments after revenue is found and before it is distributed, during the company's turn", async ({
      page,
    }) => {
      await toOperatingRound(
        page,
        [
          ["Express", 90, "Player 1"],
          ["Tunneling", 70, "Player 2"],
        ],
        { modules: ["landmarkTiles"] },
      );
      await expectTurn(page, "Express");
      await changePriceOutOfTurn(page, "Express", "up");
      await changePriceOutOfTurn(page, "Express", "up");
      await expectCompanies(page, ["Express 110", "Tunneling 70"]);
      await expectTurn(page, "Express", "Player 1");
      // Then the payout is at least the new price.
      await endTurnWithPriceChange(page, "up", "Express");
      await expectCompanies(page, ["Express 120*", "Tunneling 70"]);
      await expectTurn(page, "Tunneling");
    });

    test("p12 Launching Direct-to-Major: an auction winner can launch straight into a Major Corporation in the Stock Round", async ({
      page,
    }) => {
      await toOperatingRound(page, [
        ["Union", 100, "Player 2"],
        ["Express", 90, "Player 1"],
      ]);
      await expectTurn(page, "Union", "Player 2");
      await endTurnWithPriceChange(page, "up", "Union");
      await expectTurn(page, "Express", "Player 1");
    });

    test("p12 6-7 Player Mode: six or seven players can be seated", async ({
      page,
    }) => {
      await startRailways(page, {
        players: 7,
        modules: Object.keys(MODULE) as StartOptions["modules"],
        priority: "Player 7",
      });
      await expectRound(page, ROUND.stock);
      await endStockTurn(page);
      await expectTurn(page, "Player 1");
    });

    test("p7 Metropolitan: when shareholders must sell to cover a negative payout, the price drops for the sale and again for no payout", async ({
      page,
    }) => {
      await toOperatingRound(
        page,
        [["Express", 100, "Player 1"], [METROPOLITAN]],
        { modules: ["metropolitan"] },
      );
      await expectTurn(page, METROPOLITAN);
      // A shareholder who cannot pay sells a Metropolitan share.
      await changePriceOutOfTurn(page, METROPOLITAN, "down");
      await expectTurn(page, METROPOLITAN);
      await endTurnWithPriceChange(page, "down", METROPOLITAN);
      await expectCompanies(page, ["Express 100", `${METROPOLITAN} 80*`]);
      await expectTurn(page, "Express", "Player 1");
    });
  });
}
