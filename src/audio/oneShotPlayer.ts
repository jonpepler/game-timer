import type { AudioOutput, SoundFile } from "./audioOutput";
import { oneShotEnvelope } from "./oneShotEnvelope";

/** Quick fade for cutting a sound short when it is played again. */
const CUT_SECONDS = 0.03;

/**
 * Plays one sound start to finish through the shared output, softened
 * by the one-shot envelope. Playing it again while it still sounds cuts
 * the earlier play short rather than layering the two.
 */
export class OneShotPlayer {
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;

  constructor(
    private readonly output: AudioOutput,
    private readonly file: SoundFile,
  ) {}

  play(): void {
    void this.output.running().then(async (context) => {
      if (!context) return;
      const buffer = await this.file.decode(context);
      if (!buffer) return;
      this.cut(context);
      const gainNode = context.createGain();
      gainNode.connect(context.destination);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      const startAt = context.currentTime;
      const [first, ...rest] = oneShotEnvelope(buffer.duration);
      if (first) gainNode.gain.setValueAtTime(first.gain, startAt);
      for (const point of rest) {
        gainNode.gain.linearRampToValueAtTime(point.gain, startAt + point.at);
      }
      source.onended = () => {
        source.disconnect();
        gainNode.disconnect();
        if (this.source === source) {
          this.source = undefined;
          this.gain = undefined;
        }
      };
      source.start(startAt);
      this.source = source;
      this.gain = gainNode;
    });
  }

  stop(): void {
    try {
      this.source?.stop();
    } catch {
      // A source that never started cannot be stopped; nothing to silence.
    }
    this.source = undefined;
    this.gain = undefined;
  }

  private cut(context: AudioContext): void {
    const source = this.source;
    const gain = this.gain?.gain;
    if (!source || !gain) return;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + CUT_SECONDS);
    source.stop(now + CUT_SECONDS);
    this.source = undefined;
    this.gain = undefined;
  }
}
