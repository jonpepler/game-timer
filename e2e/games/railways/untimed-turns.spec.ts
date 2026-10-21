import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  DEVICES,
  endStockRound,
  endStockTurn,
  expectTurn,
  foundCompanies,
  installClock,
  letTimePass,
  openPricePrompt,
  press,
  readTimeShares,
  ringClock,
  startRailways,
  stepButton,
  untimedNotice,
} from "./railways.helpers";

/*
 * Landmarks p7, the Metropolitan Transit Department: on its operating
 * turn every shareholder acts, from the priority player clockwise, so
 * the agreed timer leaves that turn untimed. The ring says so instead of
 * counting down, tapping ends the turn and asks for the price move, and
 * the time share does not move. Set UNTIMED_EVIDENCE_DIR to save
 * screenshots of the untimed turn.
 */

const EVIDENCE_DIR = process.env.UNTIMED_EVIDENCE_DIR;
const METROPOLITAN = "Metropolitan";

const shot = async (page: Page, device: string, name: string) => {
  if (EVIDENCE_DIR)
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${device}-${name}.png`),
    });
};

const pauseButton = (page: Page) =>
  page.getByRole("button", { name: "Pause timer" });

for (const [device, use] of DEVICES) {
  test.describe(`Railways untimed turn (${device})`, () => {
    test.use(use);

    test("Landmarks p7: the Metropolitan's operating turn is untimed and still asks the price", async ({
      page,
    }) => {
      await installClock(page);
      await startRailways(page, { modules: ["metropolitan"] });

      // A timed Stock Round turn, so the time share has something in it.
      await letTimePass(page, 20);
      await endStockTurn(page);
      await expectTurn(page, "Player 2");
      await foundCompanies(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
        [METROPOLITAN],
      ]);
      await letTimePass(page, 10);
      await endStockRound(page, "Player 1");

      // The Metropolitan joined at the top price, so it operates first.
      await expectTurn(page, METROPOLITAN);
      await expect(untimedNotice(page)).toBeVisible();
      await expect(ringClock(page)).toHaveCount(0);
      await expect(pauseButton(page)).toBeDisabled();
      const shareBefore = await readTimeShares(page);
      expect(shareBefore.length).toBeGreaterThan(0);

      await letTimePass(page, 90);
      await expect(untimedNotice(page)).toBeVisible();
      expect(await readTimeShares(page)).toEqual(shareBefore);
      await shot(page, device, "untimed-turn");

      // Tapping ends the turn and asks for the price move.
      await openPricePrompt(page, METROPOLITAN);
      await shot(page, device, "untimed-price-prompt");
      await press(page, stepButton(page, "up"));

      // Express is timed again; nothing was credited for the untimed turn.
      await expectTurn(page, "Express", "Player 1");
      await expect(untimedNotice(page)).toHaveCount(0);
      await expect(ringClock(page)).toBeVisible();
      await expect(pauseButton(page)).toBeEnabled();
      expect(await readTimeShares(page)).toEqual(shareBefore);
    });
  });
}
