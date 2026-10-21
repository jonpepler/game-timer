import { useEffect, useMemo, useRef } from "react";
import { AudioOutput, SoundFile } from "@/audio/audioOutput";
import { LoopPlayer } from "@/audio/loopPlayer";
import { OneShotPlayer } from "@/audio/oneShotPlayer";
import { findDefinition } from "@/state/definitionRegistry";
import { resolveSoundUrls } from "@/state/gameSounds";

interface Players {
  output: AudioOutput;
  next: OneShotPlayer | undefined;
  overtime: OneShotPlayer | undefined;
  loop: LoopPlayer | undefined;
}

/**
 * The timer's sounds for the active game: the turn chime, the overtime
 * cue, and the loop under the end of the countdown. A game's own files
 * replace the core ones slot by slot. All three play through one shared
 * audio output, so the first tap's unlock covers every sound.
 */
export const useSounds = (definitionId: string | undefined) => {
  const urls = useMemo(
    () =>
      resolveSoundUrls(definitionId ? findDefinition(definitionId) : undefined),
    [definitionId],
  );

  const players = useRef<Players | undefined>(undefined);

  useEffect(() => {
    const output = new AudioOutput();
    const oneShot = (url: string | null) =>
      url ? new OneShotPlayer(output, new SoundFile(url)) : undefined;
    const current: Players = {
      output,
      next: oneShot(urls.next_turn),
      overtime: oneShot(urls.overtime),
      loop: urls.last_30
        ? new LoopPlayer(output, new SoundFile(urls.last_30))
        : undefined,
    };
    players.current = current;
    return () => {
      current.next?.stop();
      current.overtime?.stop();
      current.loop?.stop();
      output.close();
      players.current = undefined;
    };
  }, [urls]);

  return useMemo(
    () => ({
      playNext: () => players.current?.next?.play(),
      playOvertime: () => players.current?.overtime?.play(),
      /** Call from a user gesture so later sounds may start */
      unlockAudio: () => players.current?.output.unlock(),
      /** Follow the countdown at `position` seconds to zero; negative in overtime */
      followCountdown: (position: number) =>
        players.current?.loop?.play(position),
      pauseLoop: () => players.current?.loop?.pause(),
      stopLoop: () => players.current?.loop?.stop(),
    }),
    [],
  );
};
