import { describe, expect, it } from "vitest";
import {
  LOOP_FADE_OUT_SECONDS,
  LOOP_WINDOW_SECONDS,
  loopAudible,
  loopGain,
  sampleLoopEnvelope,
} from "./loopEnvelope";

describe("loopGain", () => {
  it("is silent before the window opens", () => {
    expect(loopGain(LOOP_WINDOW_SECONDS + 0.01)).toBe(0);
    expect(loopGain(300)).toBe(0);
    expect(loopAudible(LOOP_WINDOW_SECONDS + 0.01)).toBe(false);
  });

  it("starts silent as the window opens and reaches full volume at zero", () => {
    expect(loopGain(LOOP_WINDOW_SECONDS)).toBe(0);
    expect(loopAudible(LOOP_WINDOW_SECONDS)).toBe(true);
    expect(loopGain(0)).toBe(1);
  });

  it("swells on a squared curve, a quarter volume halfway through", () => {
    expect(loopGain(LOOP_WINDOW_SECONDS / 2)).toBeCloseTo(0.25);
    expect(loopGain(LOOP_WINDOW_SECONDS * 0.9)).toBeCloseTo(0.01);
  });

  it("only ever rises through the window", () => {
    let previous = -1;
    for (let p = LOOP_WINDOW_SECONDS; p >= 0; p -= 0.25) {
      const gain = loopGain(p);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
  });

  it("gives a short countdown the volume its point on the ramp has", () => {
    expect(loopGain(20)).toBeCloseTo((10 / 30) ** 2);
  });

  it("fades out over the first seconds of overtime, then stops", () => {
    expect(loopGain(-LOOP_FADE_OUT_SECONDS / 2)).toBeCloseTo(0.25);
    expect(loopGain(-LOOP_FADE_OUT_SECONDS)).toBe(0);
    expect(loopAudible(-LOOP_FADE_OUT_SECONDS)).toBe(false);
    expect(loopGain(-60)).toBe(0);
  });
});

describe("sampleLoopEnvelope", () => {
  it("covers the window and the fade from a long countdown", () => {
    const { curve, duration } = sampleLoopEnvelope(240, 10);
    expect(duration).toBe(LOOP_WINDOW_SECONDS + LOOP_FADE_OUT_SECONDS);
    expect(curve[0]).toBe(0);
    expect(curve[curve.length - 1]).toBe(0);
    expect(Math.max(...curve)).toBeCloseTo(1);
  });

  it("starts part-way up the ramp when the countdown is already inside the window", () => {
    const { curve, duration } = sampleLoopEnvelope(12, 10);
    expect(duration).toBe(12 + LOOP_FADE_OUT_SECONDS);
    expect(curve[0]).toBeCloseTo(loopGain(12));
  });

  it("finishes the fade from a point in overtime", () => {
    const { curve, duration } = sampleLoopEnvelope(-1, 10);
    expect(duration).toBe(LOOP_FADE_OUT_SECONDS - 1);
    expect(curve[0]).toBeCloseTo(loopGain(-1));
    expect(curve[curve.length - 1]).toBe(0);
  });
});
