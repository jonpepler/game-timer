/**
 * Volume envelope for the sound looped under the end of a countdown.
 *
 * Positions are seconds to zero on the countdown: positive while time
 * remains, negative once it has run into overtime. The loop is audible
 * from `LOOP_WINDOW_SECONDS` left until `LOOP_FADE_OUT_SECONDS` into
 * overtime.
 *
 * The curve is gain = progress², rising over the window and falling the
 * same way over the fade. Perceived loudness follows roughly the 0.6
 * power of amplitude (Stevens' power law), so a squared gain is heard as
 * loudness ∝ progress^1.2: a near-steady swell with a slightly slower
 * start. A linear gain would be heard as a jump to most of full volume
 * in the first few seconds and then a plateau; a cubic one would sit
 * near silence for half the window and then rush in at the end.
 */

export const LOOP_WINDOW_SECONDS = 30;
export const LOOP_FADE_OUT_SECONDS = 3;
const CURVE_POWER = 2;

/** Whether the loop should be sounding at `position`. */
export const loopAudible = (position: number): boolean =>
  position <= LOOP_WINDOW_SECONDS && position > -LOOP_FADE_OUT_SECONDS;

/** Gain from 0 to 1 at `position`; 0 outside the audible span. */
export const loopGain = (position: number): number => {
  if (!loopAudible(position)) return 0;
  const progress =
    position >= 0
      ? (LOOP_WINDOW_SECONDS - position) / LOOP_WINDOW_SECONDS
      : 1 + position / LOOP_FADE_OUT_SECONDS;
  return progress ** CURVE_POWER;
};

/**
 * The envelope from `position` to the end of the fade, sampled `rate`
 * times a second, for `AudioParam.setValueCurveAtTime`. Positions before
 * the window are clamped to its start, so the curve always begins where
 * the loop does.
 */
export const sampleLoopEnvelope = (
  position: number,
  rate = 20,
): { curve: Float32Array; duration: number } => {
  const from = Math.min(position, LOOP_WINDOW_SECONDS);
  const duration = Math.max(from + LOOP_FADE_OUT_SECONDS, 0);
  const count = Math.max(Math.ceil(duration * rate) + 1, 2);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    curve[i] = loopGain(from - (duration * i) / (count - 1));
  }
  return { curve, duration };
};
