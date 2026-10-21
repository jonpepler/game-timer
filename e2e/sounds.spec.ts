import { expect, test } from "@playwright/test";
import { probeAudio } from "./_audio-probe";
import { ring } from "./_countdown-helpers";
import { startGame } from "./_setup-helpers";

test("a game without its own sounds uses the core ones under the base path, with no loop", async ({
  page,
}) => {
  const audio = await probeAudio(page);
  await startGame(page);
  await ring(page).click();
  await expect
    .poll(() => audio.requested)
    .toEqual(
      expect.arrayContaining([
        "/game-timer/sound/next.wav",
        "/game-timer/sound/overtime.mp3",
      ]),
    );
  expect(audio.requested.filter((p) => p.includes("/games/"))).toEqual([]);
  expect(await audio.loopStarts()).toEqual([]);
});
