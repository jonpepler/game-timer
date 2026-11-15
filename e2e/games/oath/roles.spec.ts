import { expect, test } from "@playwright/test";
import {
  CHANCELLOR_PURPLE,
  changeRole,
  DEVICES,
  endTurn,
  endTurns,
  expectActiveRole,
  expectTurn,
  startOath,
  turnNameColour,
} from "./oath.helpers";

/*
 * Oath: New Foundations, Exiles, Citizens and the Chancellor:
 * OR §4 and §13, RB p8 and p34. By the table's decision, role changes
 * are generic (any player may take any role) and never end a turn,
 * unlike RB p34's "End their Act Phase".
 */

test.describe.configure({ timeout: 60_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Oath roles (${device})`, () => {
    test.use(use);

    test("OR §4 (RB p8): roles from setup show for the player taking their turn", async ({
      page,
    }) => {
      await startOath(page, {
        players: 3,
        chancellor: "Player 1",
        citizens: ["Player 2"],
      });
      await expectActiveRole(page, "Chancellor");
      await endTurn(page);
      await expectActiveRole(page, "Citizen");
      await endTurn(page);
      await expectActiveRole(page, "Exile");
    });

    test("OR §4 (RB p8): the Chancellor plays the Empire's purple", async ({
      page,
    }) => {
      await startOath(page, { players: 3, chancellor: "Player 2" });
      expect(await turnNameColour(page, "Player 2")).toBe(CHANCELLOR_PURPLE);
    });

    test("OR §13 (RB p34), table decision: a role change for the player taking their turn leaves it running", async ({
      page,
    }) => {
      await startOath(page, { players: 3, chancellor: "Player 1" });
      await endTurn(page);
      await expectTurn(page, "Player 2");
      await changeRole(page, "Player 2", "Citizen");
      await expectTurn(page, "Player 2");
      await expectActiveRole(page, "Citizen");
      await endTurn(page);
      await expectTurn(page, "Player 3");
    });

    test("OR §13 (RB p34): a Citizen can exile themself", async ({ page }) => {
      await startOath(page, {
        players: 3,
        chancellor: "Player 1",
        citizens: ["Player 2"],
      });
      await endTurn(page);
      await changeRole(page, "Player 2", "Exile");
      await expectTurn(page, "Player 2");
      await expectActiveRole(page, "Exile");
    });

    test("OR §13 (RB p34): changing another player's role leaves the turn running", async ({
      page,
    }) => {
      await startOath(page, { players: 3, chancellor: "Player 1" });
      await changeRole(page, "Player 3", "Citizen");
      await expectTurn(page, "Player 1");
      await endTurns(page, 2);
      await expectTurn(page, "Player 3");
      await expectActiveRole(page, "Citizen");
    });
  });
}
