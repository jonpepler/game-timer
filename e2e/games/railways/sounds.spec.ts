import { expect, test } from "@playwright/test";
import { expectFaded, probeAudio } from "../../_audio-probe";
import { ring, startRailways } from "./railways.helpers";

const SOUND = "/game-timer/games/railways/sound";

test("Railways requests its train sounds under the base path and schedules the loop for the last 30 seconds", async ({
  page,
}) => {
  const audio = await probeAudio(page);
  await startRailways(page);
  await expect
    .poll(() => audio.requested)
    .toEqual(
      expect.arrayContaining([
        `${SOUND}/next_turn.mp3`,
        `${SOUND}/last_30.flac`,
        `${SOUND}/overtime.mp3`,
      ]),
    );

  // The first tap started the countdown: the loop is due 30s before zero.
  const [, mm, ss] =
    /(\d\d):(\d\d)/.exec((await ring(page).textContent()) ?? "") ?? [];
  const countdown = Number(mm) * 60 + Number(ss);
  expect(countdown).toBeGreaterThan(30);
  await expect.poll(() => audio.loopStarts()).toHaveLength(1);
  const [loop] = await audio.loopStarts();
  // 150204 frames at 44.1kHz, whatever rate the browser decodes to.
  expect(loop.duration).toBeCloseTo(150204 / 44100, 3);
  expect(loop.delay).toBeGreaterThan(countdown - 30 - 2);
  expect(loop.delay).toBeLessThanOrEqual(countdown - 30 + 1);
});

test("Railways' turn whistle fades in and out over half a second", async ({
  page,
}) => {
  const audio = await probeAudio(page);
  await startRailways(page);
  await ring(page).click();
  await expect.poll(() => audio.oneShotStarts()).toHaveLength(1);
  const [whistle] = await audio.oneShotStarts();
  expect(whistle.duration).toBeCloseTo(4.88, 1);
  expectFaded(whistle, 0.5);
});
