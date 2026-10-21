import { expect, type Page, test } from "@playwright/test";
import {
  DEVICES,
  endStockRound,
  endStockTurn,
  expectTurn,
  foundCompanies,
  installClock,
  letTimePass,
  startRailways,
} from "./railways.helpers";

/*
 * Railways of the Lost Atlas, 2nd printing rulebook: the game ends after
 * four cycles in the Short Game or six in the Long Game (p19), and each
 * cycle is a Stock Round, two Operating Rounds (p12) and a Merger Round
 * (p18). The timer predicts the finish from that model.
 */

const cyclesLeft = (page: Page) => page.getByText(/^\d+(\.5)? cycles? left$/);
const endsAt = (page: Page) => page.getByText(/^ends at \d{1,2}:\d{2}/);

const finishMinutes = async (page: Page) => {
  const text = (await endsAt(page).textContent()) ?? "";
  const [, h, m, half] = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i) ?? [];
  const hours = (Number(h) % 12) + (half?.toUpperCase() === "PM" ? 12 : 0);
  return (half ? hours : Number(h)) * 60 + Number(m);
};

test.describe.configure({ timeout: 60_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Railways predicted finish (${device})`, () => {
    test.use(use);

    test("p19: a Short Game predicts its finish from four cycles, and a round change moves it", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { length: "Short Game" });

      // The footer counts down the four cycles; the turns behind the
      // finish time are pinned in the definition's unit tests.
      await expect(cyclesLeft(page)).toHaveText("4 cycles left");
      await expect(endsAt(page)).toBeVisible();

      // Two Minors also bring 4 Merger Rounds of 2 turns.
      await foundCompanies(page, [
        ["Express", 90, "Player 3"],
        ["Tunneling", 80, "Player 4"],
      ]);
      await letTimePass(page, 40);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      await expect(cyclesLeft(page)).toHaveText("4 cycles left");
      const beforeRoundChange = await finishMinutes(page);

      /*
       * Into the first Operating Round: the rest of the Stock Round drops
       * out of the finish. One round of four in a cycle is done, and 3.75
       * cycles still reads as four to the nearest half.
       */
      await endStockRound(page, "Player 1");
      await expectTurn(page, "Express", "Player 3");
      await expect(cyclesLeft(page)).toHaveText("4 cycles left");
      expect(await finishMinutes(page)).toBeLessThan(beforeRoundChange);
    });

    test("p19: the Long Game, the default, predicts from six cycles", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page);
      await expect(cyclesLeft(page)).toHaveText("6 cycles left");
      await expect(endsAt(page)).toBeVisible();
    });
  });
}
