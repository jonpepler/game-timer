import type { AudioOutput, SoundFile } from "./audioOutput";
import {
  LOOP_FADE_OUT_SECONDS,
  LOOP_WINDOW_SECONDS,
  sampleLoopEnvelope,
} from "./loopEnvelope";

/** Hands-off gap between holding the current gain and the new curve. */
const RESYNC_SECONDS = 0.02;

/**
 * Plays one sound on a seamless loop under the end of the countdown,
 * shaped by the loop envelope. An HTML audio element's `loop` leaves a
 * gap at the wrap, so this decodes the file once and loops the buffer
 * in Web Audio.
 *
 * Callers describe where the countdown is (`play`) and when it stops
 * (`pause`, `stop`); the player schedules the start, the swell and the
 * fade on the audio clock, once the shared output has been unlocked.
 */
export class LoopPlayer {
  private context: AudioContext | undefined;
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;
  private loopStartedAt = 0;
  private offset = 0;
  private generation = 0;
  private cleanup: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly output: AudioOutput,
    private readonly file: SoundFile,
  ) {}

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

  private async ready(): Promise<AudioBuffer | undefined> {
    const context = await this.output.running();
    if (!context) return undefined;
    this.context = context;
    return this.file.decode(context);
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
