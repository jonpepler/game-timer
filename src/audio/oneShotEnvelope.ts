/**
 * Volume envelope for a sound played once (a turn chime, an overtime
 * cue): a linear fade in from silence, full volume, then a linear fade
 * out that ends with the sound, so neither edge starts or stops with a
 * click.
 *
 * A sound too short for both full fades, which with a little held
 * volume between them need `SHORT_SOUND_SECONDS`, has its fades scaled
 * down in proportion so they never meet.
 */

export const ONE_SHOT_FADE_SECONDS = 0.5;
export const SHORT_SOUND_SECONDS = 1.2;

export interface GainPoint {
  /** Seconds after the sound starts */
  at: number;
  gain: number;
}

/** Seconds of fade at each end of a sound `duration` seconds long. */
export const oneShotFade = (duration: number): number => {
  if (duration <= 0) return 0;
  if (duration >= SHORT_SOUND_SECONDS) return ONE_SHOT_FADE_SECONDS;
  return (duration * ONE_SHOT_FADE_SECONDS) / SHORT_SOUND_SECONDS;
};

/**
 * The envelope as points to ramp linearly between, starting at silence
 * and ending silent at `duration`.
 */
export const oneShotEnvelope = (duration: number): GainPoint[] => {
  const fade = oneShotFade(duration);
  if (fade === 0) return [];
  return [
    { at: 0, gain: 0 },
    { at: fade, gain: 1 },
    { at: duration - fade, gain: 1 },
    { at: duration, gain: 0 },
  ];
};
