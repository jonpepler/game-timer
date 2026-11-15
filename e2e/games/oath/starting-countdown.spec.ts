import { test } from "@playwright/test";
import { expectCountdownFrom } from "../../_countdown-helpers";
import { startOath } from "./oath.helpers";

/*
 * Oath's first countdown, before any turn is recorded, is its default
 * average of four minutes rather than the generic five.
 */

test("the first countdown is Oath's four-minute default", async ({ page }) => {
  test.setTimeout(60_000);
  await startOath(page, { players: 3 });
  await expectCountdownFrom(page, 240);
});
