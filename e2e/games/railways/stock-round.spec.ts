import { expect, test } from "@playwright/test";
import {
  changePriceOutOfTurn,
  chooseNextRound,
  DEVICES,
  endStockRound,
  endStockTurn,
  endTurnWithPriceChange,
  expectCompanies,
  expectPresident,
  expectRound,
  expectRoundComplete,
  expectTurn,
  foundCompanies,
  foundCompany,
  closeFoundingSheet,
  openFoundingSheet,
  press,
  ROUND,
  setPresident,
  startRailways,
  undo,
} from "./railways.helpers";

/*
 * Railways of the Lost Atlas, 2nd edition rulebook: the Stock Round
 * (pp10-11) and stock token movement outside a company's own turn.
 * Page numbers are the printed ones.
 */

/*
 * Each test walks the whole setup wizard and then plays rounds, which takes
 * up to 16s with 8 workers and more than the 30s default during load spikes.
 */
test.describe.configure({ timeout: 60_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Railways Stock Round (${device})`, () => {
    test.use(use);

    test("p10: beginning with the priority player, players take turns clockwise", async ({
      page,
    }) => {
      await startRailways(page, { priority: "Player 3" });
      await endStockTurn(page);
      await expectTurn(page, "Player 4");
      await endStockTurn(page);
      await expectTurn(page, "Player 1");
    });

    test("p11 Pass: passing does not remove a player; play returns to them and the round goes on", async ({
      page,
    }) => {
      await startRailways(page, { priority: "Player 2" });
      for (const next of ["Player 3", "Player 4", "Player 1", "Player 2"]) {
        await endStockTurn(page);
        await expectTurn(page, next);
      }
      await expectRound(page, ROUND.stock);
    });

    test("Diagram 3 (p10): Expansive tops the 80 column, Resourceful launches below it, Tunneling tops 70, and each next turn goes clockwise of the auction's initiator", async ({
      page,
    }) => {
      await startRailways(page, { players: 2, priority: "Player 1" });

      // Player 1 starts an auction; Player 2 wins Expansive at 160.
      await foundCompany(page, "Expansive", 80, "Player 2");
      await closeFoundingSheet(page);
      await expectTurn(page, "Player 1");
      await endStockTurn(page);
      await expectTurn(page, "Player 2");

      // Player 2 starts an auction; Player 1 wins Resourceful at 165.
      await foundCompanies(page, [["Resourceful", 80, "Player 1"]]);
      await expectCompanies(page, ["Expansive 80", "Resourceful 80"]);
      await endStockTurn(page);
      await expectTurn(page, "Player 1");

      // Player 1 bids 140 unopposed for Tunneling.
      await foundCompanies(page, [["Tunneling", 70, "Player 1"]]);
      await expectCompanies(page, [
        "Expansive 80",
        "Resourceful 80",
        "Tunneling 70",
      ]);
      await expectPresident(page, "Expansive", "Player 2");
      await expectPresident(page, "Resourceful", "Player 1");
    });

    test("p10: initial stock prices run 60 to 135, and a launch needs a price and a president", async ({
      page,
    }) => {
      await startRailways(page);
      const sheet = await openFoundingSheet(page);
      await press(page, sheet.getByRole("button", { name: "Add Express" }));
      const details = page.getByRole("dialog", { name: "Add Express" });
      for (const price of [60, 70, 80, 90, 100, 110, 120, 135]) {
        await expect(
          details.getByRole("button", { name: String(price), exact: true }),
        ).toBeVisible();
      }
      for (const price of [50, 150]) {
        await expect(
          details.getByRole("button", { name: String(price), exact: true }),
        ).toHaveCount(0);
      }
      const confirm = details.getByRole("button", { name: "Add Express" });
      await expect(confirm).toBeDisabled();
      await press(
        page,
        details.getByRole("button", { name: "90", exact: true }),
      );
      await expect(confirm).toBeDisabled();
      await press(
        page,
        details.getByRole("button", { name: "Player 2", exact: true }),
      );
      await expect(confirm).toBeEnabled();
    });

    test("p11 Selling: a sale drops the price one increment and the token goes below those already in the new column", async ({
      page,
    }) => {
      await startRailways(page);
      await foundCompanies(page, [
        ["Expansive", 80, "Player 1"],
        ["Tunneling", 70, "Player 2"],
        ["Suburban", 70, "Player 3"],
      ]);
      await changePriceOutOfTurn(page, "Expansive", "down");
      await expectCompanies(page, [
        "Tunneling 70",
        "Suburban 70",
        "Expansive 70",
      ]);
    });

    test("p11 End of Stock Round: a fully owned company rises one increment, below the tokens already in that column", async ({
      page,
    }) => {
      await startRailways(page);
      await foundCompanies(page, [
        ["Expansive", 80, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      await changePriceOutOfTurn(page, "Tunneling", "up");
      await expectCompanies(page, ["Expansive 80", "Tunneling 80"]);
    });

    test("p11 Token Movement: a share price reaching 0 dissolves the company", async ({
      page,
    }) => {
      await startRailways(page);
      await foundCompanies(page, [
        ["Expansive", 80, "Player 1"],
        ["Tunneling", 60, "Player 2"],
      ]);
      // Several Stock Rounds of sales have worn Tunneling down to 10.
      await changePriceOutOfTurn(page, "Tunneling", 10);
      await expectCompanies(page, ["Expansive 80", "Tunneling 10"]);
      await changePriceOutOfTurn(page, "Tunneling", "down");
      await expectCompanies(page, ["Expansive 80"]);
    });

    test("p4 and p11 Change of ownership: the presidency moves to the player with more shares", async ({
      page,
    }) => {
      await startRailways(page);
      await foundCompanies(page, [["Express", 90, "Player 1"]]);
      await setPresident(page, "Express", "Player 3");
      await expectPresident(page, "Express", "Player 3");
      await endStockRound(page, "Player 2");
      await expectTurn(page, "Express", "Player 3");
    });

    test("p11 End of Stock Round: the priority marker goes to the player named, who opens the next Stock Round", async ({
      page,
    }) => {
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 1"]]);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      // Player 2 took the last non-pass action, so Player 3 takes priority.
      await endStockRound(page, "Player 3");
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "same");
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.stock);
      await expectTurn(page, "Player 3");
      await endStockTurn(page);
      await expectTurn(page, "Player 4");
    });
    test("p11 End of Stock Round: undoing back into the Stock Round asks for priority again, and the new answer stands", async ({
      page,
    }) => {
      await startRailways(page, { priority: "Player 1" });
      await foundCompanies(page, [["Express", 90, "Player 1"]]);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      await endStockRound(page, "Player 3");
      await expectTurn(page, "Express", "Player 1");

      // Player 2 did act after all: back into the Stock Round.
      await undo(page);
      await expectRound(page, ROUND.stock);
      await expectTurn(page, "Player 2");
      await endStockTurn(page);
      await expectTurn(page, "Player 3");

      // Player 3 now took the last non-pass action, so Player 4 has
      // priority; the table is asked again rather than keeping Player 3.
      await endStockRound(page, "Player 4");
      await expectTurn(page, "Express", "Player 1");
      await endTurnWithPriceChange(page, "same");
      await expectRoundComplete(page, ROUND.operating);
      await chooseNextRound(page, ROUND.stock);
      await expectTurn(page, "Player 4");
    });

    test("p11 Pass, Note: if no Minor Company launches in the initial Stock Round, it restarts with the priority player", async ({
      page,
    }) => {
      await startRailways(page, { priority: "Player 2" });
      for (const next of ["Player 3", "Player 4", "Player 1"]) {
        await endStockTurn(page);
        await expectTurn(page, next);
      }
      // Everyone passed: reshuffle the charters and start again.
      await endStockRound(page, "Player 2", ROUND.stock);
      await expectTurn(page, "Player 2");
      await endStockTurn(page);
      await expectTurn(page, "Player 3");
    });
  });
}
