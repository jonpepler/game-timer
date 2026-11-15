import { test } from "@playwright/test";
import {
  changeRole,
  DEVICES,
  endTurn,
  endTurns,
  expectTurn,
  startOath,
} from "./oath.helpers";

/*
 * Oath: New Foundations, who acts and in what order. Cites are to the
 * Buried Giant online rules (OR, section) and the June 2026 combined
 * rulebook (RB, printed page).
 */

test.describe.configure({ timeout: 60_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Oath turn order (${device})`, () => {
    test.use(use);

    test("OR §6 (RB p17): each round starts with the Chancellor and goes clockwise", async ({
      page,
    }) => {
      await startOath(page, { players: 4, chancellor: "Player 3" });
      for (const next of ["Player 4", "Player 1", "Player 2", "Player 3"]) {
        await endTurn(page);
        await expectTurn(page, next);
      }
    });

    test("OR §6 (RB p17): with no Chancellor, each round starts with the first player", async ({
      page,
    }) => {
      await startOath(page, { players: 4, firstPlayer: "Player 2" });
      for (const next of ["Player 3", "Player 4", "Player 1", "Player 2"]) {
        await endTurn(page);
        await expectTurn(page, next);
      }
    });

    test("OR §6, §9 (RB p17, p30): a player who becomes the Chancellor mid-game opens every later round", async ({
      page,
    }) => {
      await startOath(page, { players: 4, firstPlayer: "Player 1" });
      await endTurn(page);
      await expectTurn(page, "Player 2");
      await changeRole(page, "Player 2", "Chancellor");
      await expectTurn(page, "Player 2");
      await endTurns(page, 3);
      await expectTurn(page, "Player 2");
      await endTurn(page);
      await expectTurn(page, "Player 3");
    });
  });
}
