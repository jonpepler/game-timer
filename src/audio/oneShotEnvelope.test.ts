import { describe, expect, it } from "vitest";
import {
  ONE_SHOT_FADE_SECONDS,
  oneShotEnvelope,
  oneShotFade,
  SHORT_SOUND_SECONDS,
} from "./oneShotEnvelope";

describe("oneShotEnvelope", () => {
  it("fades in over half a second, holds, and fades out to end with the sound", () => {
    expect(oneShotEnvelope(4)).toEqual([
      { at: 0, gain: 0 },
      { at: 0.5, gain: 1 },
      { at: 3.5, gain: 1 },
      { at: 4, gain: 0 },
    ]);
  });

  it("keeps full half-second fades from the short-sound threshold up", () => {
    expect(oneShotFade(SHORT_SOUND_SECONDS)).toBe(ONE_SHOT_FADE_SECONDS);
    expect(oneShotFade(1.8)).toBe(ONE_SHOT_FADE_SECONDS);
  });

  it("scales the fades down for a short sound so they never meet", () => {
    for (const duration of [0.05, 0.3, 0.6, 1, 1.19]) {
      const [, faded, held, end] = oneShotEnvelope(duration);
      expect(faded.at).toBeLessThan(held.at);
      expect(end.at).toBe(duration);
      expect(faded.at).toBeCloseTo(
        (duration * ONE_SHOT_FADE_SECONDS) / SHORT_SOUND_SECONDS,
      );
    }
  });

  it("shrinks the fades smoothly into the threshold, with no jump", () => {
    expect(oneShotFade(SHORT_SOUND_SECONDS - 1e-6)).toBeCloseTo(
      ONE_SHOT_FADE_SECONDS,
    );
  });

  it("has nothing to play for an empty sound", () => {
    expect(oneShotEnvelope(0)).toEqual([]);
  });
});
