import {
  LOOP_FADE_OUT_SECONDS,
  LOOP_WINDOW_SECONDS,
  sampleLoopEnvelope,
} from "./loopEnvelope";

/** Hands-off gap between holding the current gain and the new curve. */
const RESYNC_SECONDS = 0.02;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Plays one sound on a seamless loop under the end of the countdown,
 * shaped by the loop envelope. An HTML audio element's `loop` leaves a
 * gap at the wrap, so this decodes the file once and loops the buffer
 * in Web Audio.
 *
 * Callers describe where the countdown is (`play`) and when it stops
 * (`pause`, `stop`); the player schedules the start, the swell and the
 * fade on the audio clock. Nothing sounds until `unlock` has run inside
 * a user gesture, which mobile browsers require before audio can start.
 */
export class LoopPlayer {
  private readonly data: Promise<ArrayBuffer | undefined>;
  private context: AudioContext | undefined;
  private buffer: Promise<AudioBuffer | undefined> | undefined;
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;
  private loopStartedAt = 0;
  private offset = 0;
  private generation = 0;
  private cleanup: ReturnType<typeof setTimeout> | undefined;

  constructor(url: string) {
    this.data =
      typeof fetch === "undefined"
        ? Promise.resolve(undefined)
        : fetch(url)
            .then((response) =>
              response.ok ? response.arrayBuffer() : undefined,
            )
            .catch(() => undefined);
  }

  /**
   * Create or resume the audio context. Call from a tap or click: iOS
   * Safari only lets audio start from inside one, and also wants a sound
   * started there, so a one-frame silent buffer plays too.
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.context) {
      /**
       * Web Audio on iOS follows the ringer switch by default, while the
       * HTML audio elements the other sounds use do not. Asking for the
       * playback session keeps every sound on the same footing.
       */
      const session = (navigator as AudioSessionNavigator).audioSession;
      if (session) session.type = "playback";
      this.context = new AudioContext();
    }
    const context = this.context;
    if (context.state !== "running") void context.resume().catch(() => {});
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination);
    silence.start();
  }

  /**
   * Follow a countdown at `position` seconds to zero (negative in
   * overtime). Starts the loop now or when the window opens, or carries
   * a sounding loop on with its envelope re-aligned to `position`.
   */
  play(position: number): void {
    const generation = ++this.generation;
    const requestedAt = performance.now();
    void this.ready().then((buffer) => {
      if (!buffer || generation !== this.generation) return;
      const elapsed = (performance.now() - requestedAt) / 1000;
      this.schedule(buffer, position - elapsed);
    });
  }

  /** Silence the loop, keeping its place in the file for the next `play`. */
  pause(): void {
    this.generation++;
    const context = this.context;
    const source = this.source;
    if (context && source?.buffer && context.currentTime > this.loopStartedAt) {
      this.offset =
        (context.currentTime - this.loopStartedAt) % source.buffer.duration;
    }
    this.stopSource();
  }

  /** Silence the loop at once and forget its place. */
  stop(): void {
    this.generation++;
    this.offset = 0;
    this.stopSource();
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }

  private async ready(): Promise<AudioBuffer | undefined> {
    const context = this.context;
    if (!context) return undefined;
    // Read through a call: the state changes across the await.
    const running = () => context.state === "running";
    if (!running()) {
      await context.resume().catch(() => {});
      if (!running()) return undefined;
    }
    this.buffer ??= this.data.then((data) =>
      data
        ? context.decodeAudioData(data.slice(0)).catch(() => undefined)
        : undefined,
    );
    return this.buffer;
  }

  private schedule(buffer: AudioBuffer, position: number): void {
    const context = this.context;
    if (!context || position <= -LOOP_FADE_OUT_SECONDS) {
      this.stopSource();
      return;
    }
    const now = context.currentTime;
    const delay = Math.max(position - LOOP_WINDOW_SECONDS, 0);
    const { curve, duration } = sampleLoopEnvelope(position);
    const sounding = this.source !== undefined && this.gain !== undefined;

    if (sounding && delay === 0 && this.gain) {
      const gain = this.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.setValueCurveAtTime(curve, now + RESYNC_SECONDS, duration);
    } else {
      this.stopSource();
      const gainNode = context.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(context.destination);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gainNode);
      const startAt = now + delay;
      gainNode.gain.setValueCurveAtTime(curve, startAt, duration);
      source.start(startAt, this.offset % buffer.duration);
      this.loopStartedAt = startAt - this.offset;
      this.source = source;
      this.gain = gainNode;
    }

    const generation = this.generation;
    clearTimeout(this.cleanup);
    this.cleanup = setTimeout(
      () => {
        if (generation !== this.generation) return;
        this.offset = 0;
        this.stopSource();
      },
      (delay + duration + RESYNC_SECONDS) * 1000 + 100,
    );
  }

  private stopSource(): void {
    clearTimeout(this.cleanup);
    this.cleanup = undefined;
    const source = this.source;
    this.source = undefined;
    if (source) {
      try {
        source.stop();
      } catch {
        // A source that never started cannot be stopped; nothing to silence.
      }
      source.disconnect();
    }
    this.gain?.disconnect();
    this.gain = undefined;
  }
}
