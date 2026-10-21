import { expect, type Page } from "@playwright/test";

export interface GainRamp {
  /** Seconds after the source is due to start */
  at: number;
  gain: number;
}

export interface SourceStart {
  loop: boolean;
  /** Seconds of audio in the buffer */
  duration: number;
  /** Seconds between the start call and when the source is due to sound */
  delay: number;
  /** Gain automation scheduled on the node the source plays into */
  ramps: GainRamp[];
}

/**
 * Record every buffer source the page starts, with the gain envelope
 * scheduled for it, since a test cannot hear audio. Install before the
 * page loads.
 */
export const probeAudio = async (page: Page) => {
  await page.addInitScript(() => {
    type Ramp = { time: number; gain: number };
    const starts: Array<{
      loop: boolean;
      duration: number;
      delay: number;
      ramps: Array<{ at: number; gain: number }>;
    }> = [];
    Object.defineProperty(window, "__audioStarts", { value: starts });
    const ramps = new WeakMap<AudioParam, Ramp[]>();
    const outputs = new WeakMap<AudioNode, AudioNode>();
    const record = <A extends unknown[]>(
      method: (
        this: AudioParam,
        value: number,
        time: number,
        ...a: A
      ) => AudioParam,
    ) =>
      function (this: AudioParam, value: number, time: number, ...a: A) {
        const list = ramps.get(this) ?? [];
        list.push({ time, gain: value });
        ramps.set(this, list);
        return method.call(this, value, time, ...a);
      };
    AudioParam.prototype.setValueAtTime = record(
      AudioParam.prototype.setValueAtTime,
    );
    AudioParam.prototype.linearRampToValueAtTime = record(
      AudioParam.prototype.linearRampToValueAtTime,
    );
    const connect = AudioNode.prototype.connect as (
      this: AudioNode,
      ...args: unknown[]
    ) => unknown;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      ...args: unknown[]
    ) {
      if (args[0] instanceof AudioNode) outputs.set(this, args[0]);
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      const startAt = when === 0 ? this.context.currentTime : when;
      const output = outputs.get(this);
      const scheduled =
        output instanceof GainNode ? (ramps.get(output.gain) ?? []) : [];
      starts.push({
        loop: this.loop,
        duration: this.buffer?.duration ?? 0,
        delay: startAt - this.context.currentTime,
        ramps: scheduled.map((r) => ({ at: r.time - startAt, gain: r.gain })),
      });
      return start.call(this, when, ...rest);
    };
  });
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  const starts = () =>
    page.evaluate(
      () =>
        (window as unknown as { __audioStarts: SourceStart[] }).__audioStarts,
    );
  return {
    requested,
    loopStarts: async () => (await starts()).filter((s) => s.loop),
    /** One-shot sounds, leaving out the one-frame silence that unlocks audio */
    oneShotStarts: async () =>
      (await starts()).filter((s) => !s.loop && s.duration > 0.01),
  };
};

/**
 * Assert a one-shot rises from silence over `fade` seconds, holds, and
 * falls back to silence over its last `fade` seconds.
 */
export const expectFaded = (sound: SourceStart, fade: number) => {
  const expected = [
    { at: 0, gain: 0 },
    { at: fade, gain: 1 },
    { at: sound.duration - fade, gain: 1 },
    { at: sound.duration, gain: 0 },
  ];
  expect(sound.ramps).toHaveLength(expected.length);
  sound.ramps.forEach((ramp, i) => {
    expect(ramp.gain).toBe(expected[i].gain);
    expect(ramp.at).toBeCloseTo(expected[i].at, 3);
  });
};
