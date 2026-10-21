import type { Page } from "@playwright/test";

export interface LoopStart {
  loop: boolean;
  /** Seconds of audio in the looped buffer */
  duration: number;
  /** Seconds between the start call and when the source is due to sound */
  delay: number;
}

/**
 * Record every buffer source the page starts, since a test cannot hear
 * audio. Install before the page loads.
 */
export const probeAudio = async (page: Page) => {
  await page.addInitScript(() => {
    const starts: Array<{ loop: boolean; duration: number; delay: number }> =
      [];
    Object.defineProperty(window, "__audioStarts", { value: starts });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      starts.push({
        loop: this.loop,
        duration: this.buffer?.duration ?? 0,
        delay: when === 0 ? 0 : when - this.context.currentTime,
      });
      return start.call(this, when, ...rest);
    };
  });
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  return {
    requested,
    loopStarts: () =>
      page.evaluate(() =>
        (
          window as unknown as { __audioStarts: LoopStart[] }
        ).__audioStarts.filter((s) => s.loop),
      ),
  };
};
