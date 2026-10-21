type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * The page's one audio context, shared by every sound so a single
 * unlock covers them all. Nothing sounds until `unlock` has run inside
 * a user gesture, which mobile browsers require before audio can start.
 */
export class AudioOutput {
  private context: AudioContext | undefined;

  /**
   * Create or resume the audio context. Call from a tap or click: iOS
   * Safari only lets audio start from inside one, and also wants a sound
   * started there, so a one-frame silent buffer plays too.
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.context) {
      /**
       * Web Audio on iOS follows the ringer switch by default. Asking for
       * the playback session lets the timer be heard with the phone on
       * silent, as plain audio elements are.
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

  /** The context once it is running; undefined before any unlock. */
  async running(): Promise<AudioContext | undefined> {
    const context = this.context;
    if (!context) return undefined;
    // Read through a call: the state changes across the await.
    const isRunning = () => context.state === "running";
    if (!isRunning()) {
      await context.resume().catch(() => {});
      if (!isRunning()) return undefined;
    }
    return context;
  }

  close(): void {
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}

/**
 * A sound file fetched as soon as it is known and decoded on first use,
 * once a running context exists to decode it with.
 */
export class SoundFile {
  private readonly data: Promise<ArrayBuffer | undefined>;
  private buffer: Promise<AudioBuffer | undefined> | undefined;

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

  decode(context: AudioContext): Promise<AudioBuffer | undefined> {
    this.buffer ??= this.data.then((data) =>
      data
        ? context.decodeAudioData(data.slice(0)).catch(() => undefined)
        : undefined,
    );
    return this.buffer;
  }
}
