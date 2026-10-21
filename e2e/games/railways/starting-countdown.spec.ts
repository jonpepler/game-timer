import { test } from "@playwright/test";
import { expectCountdownFrom } from "../../_countdown-helpers";
import { startRailways } from "./railways.helpers";

/*
 * Railways opens on the Stock Round, which declares its own average of
 * forty-five seconds. A phase's declared average wins over the game's
 * default, so the first countdown is forty-five seconds, not the generic
 * five minutes.
 */

test("the first Stock Round countdown is the round's forty-five-second average", async ({
  page,
}) => {
  // startRailways taps the ring once to start the clock.
  await startRailways(page);
  await expectCountdownFrom(page, 45);
});
