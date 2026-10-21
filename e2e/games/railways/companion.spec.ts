import { expect, test } from "@playwright/test";
import {
  companionEndTurn,
  companionWaiting,
  endStockRound,
  endTurnFromPhone,
  expectCompanies,
  expectTurn,
  foundCompanies,
  LABEL,
  press,
  pricePrompt,
  removeCompany,
  ROUND,
  startRailwaysWithCompanions,
  untimedNotice,
} from "./railways.helpers";

/*
 * Agreed: a seated phone can do everything the host can. These cover
 * the rules a president's phone plays out that the companion parity
 * spec does not: a bankruptcy, a Merger Round pass, the Metropolitan's
 * shared turn and undo. The host page is desktop sized; each phone is a
 * 390x844 touch screen.
 */

const METROPOLITAN = "Metropolitan";

test.use({ hasTouch: true });

test.describe("Railways from a companion phone", () => {
  test("p17 Bankruptcy: the president's phone declares it, and the bankrupt player's other companies leave the game from that phone too", async ({
    context,
  }) => {
    test.setTimeout(120_000);
    const { host, phones } = await startRailwaysWithCompanions(context, {
      seats: [1],
    });
    const phone = phones[1];
    await foundCompanies(phone, [
      ["Express", 100, "Player 1"],
      ["Tunneling", 90, "Player 2"],
      ["Suburban", 80, "Player 1"],
    ]);
    await endStockRound(phone, "Player 1");
    await expectTurn(host, "Express", "Player 1");

    await endTurnFromPhone(phone, "Express", "bankrupt");
    await removeCompany(phone, "Suburban");
    await expectCompanies(host, ["Tunneling 90"]);
    await expectTurn(host, "Tunneling", "Player 2");
    await expect(companionWaiting(phone)).toBeDisabled();
  });

  test("p18: a Minor Company's president passes its Merger Round turn from a phone, and no share price is asked", async ({
    context,
  }) => {
    test.setTimeout(120_000);
    const { host, phones } = await startRailwaysWithCompanions(context, {
      seats: [2],
    });
    const phone = phones[2];
    await foundCompanies(phone, [
      ["Express", 90, "Player 2"],
      ["Tunneling", 70, "Player 3"],
    ]);
    await endStockRound(phone, "Player 1", ROUND.merger);
    await expectTurn(host, "Express", "Player 2");

    await endTurnFromPhone(phone, "Express");
    await expect(pricePrompt(phone)).toHaveCount(0);
    await expect(pricePrompt(host)).toHaveCount(0);
    await expectTurn(host, "Tunneling", "Player 3");
  });

  test("Landmarks p7 Metropolitan: shareholders act together, so a seated phone can end its untimed turn", async ({
    context,
  }) => {
    test.setTimeout(60_000);
    const { host, phones } = await startRailwaysWithCompanions(context, {
      seats: [1],
      modules: ["metropolitan"],
    });
    const phone = phones[1];
    await foundCompanies(phone, [["Express", 90, "Player 1"], [METROPOLITAN]]);
    await endStockRound(phone, "Player 1");
    await expectTurn(host, METROPOLITAN);
    await expect(untimedNotice(host)).toBeVisible();

    await expect(companionEndTurn(phone, METROPOLITAN)).toBeEnabled({
      timeout: 5_000,
    });
    await endTurnFromPhone(phone, METROPOLITAN, "same");
    await expectTurn(host, "Express", "Player 1");
  });

  test("agreed undo: a phone takes back a mis-recorded price move, and the host asks the question again", async ({
    context,
  }) => {
    test.setTimeout(60_000);
    const { host, phones } = await startRailwaysWithCompanions(context, {
      seats: [1],
    });
    const phone = phones[1];
    await foundCompanies(phone, [
      ["Express", 90, "Player 1"],
      ["Tunneling", 70, "Player 2"],
    ]);
    await endStockRound(phone, "Player 1");
    await endTurnFromPhone(phone, "Express", "down");
    await expectTurn(host, "Tunneling", "Player 2");

    await expect(
      phone.getByRole("button", { name: LABEL.undo, exact: true }),
    ).toBeEnabled({ timeout: 5_000 });
    await press(
      phone,
      phone.getByRole("button", { name: LABEL.undo, exact: true }),
    );
    await expectCompanies(host, ["Express 90", "Tunneling 70"]);
    await expectTurn(host, "Express", "Player 1");
  });
});
