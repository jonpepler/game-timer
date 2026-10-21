import { useEffect, useMemo, useRef } from "react";
import { LoopPlayer } from "@/audio/loopPlayer";
import { findDefinition } from "@/state/definitionRegistry";
import { resolveSoundUrls } from "@/state/gameSounds";

const preload = (url: string | null): HTMLAudioElement | undefined => {
  if (!url || typeof Audio === "undefined") return undefined;
  const audio = new Audio(url);
  audio.preload = "auto";
  return audio;
};

/**
 * The timer's sounds for the active game: the turn chime, the overtime
 * cue, and the loop under the end of the countdown. A game's own files
 * replace the core ones slot by slot.
 */
export const useSounds = (definitionId: string | undefined) => {
  const urls = useMemo(
    () =>
      resolveSoundUrls(definitionId ? findDefinition(definitionId) : undefined),
    [definitionId],
  );

  const next = useRef<HTMLAudioElement | undefined>(undefined);
  const overtime = useRef<HTMLAudioElement | undefined>(undefined);
  const loop = useRef<LoopPlayer | undefined>(undefined);

  useEffect(() => {
    next.current = preload(urls.next_turn);
    overtime.current = preload(urls.overtime);
    const player = urls.last_30 ? new LoopPlayer(urls.last_30) : undefined;
    loop.current = player;
    return () => {
      next.current = undefined;
      overtime.current = undefined;
      player?.dispose();
      loop.current = undefined;
    };
  }, [urls]);

  return useMemo(
    () => ({
      playNext: () => void next.current?.play().catch(() => {}),
      playOvertime: () => void overtime.current?.play().catch(() => {}),
      /** Call from a user gesture so later sounds may start */
      unlockAudio: () => loop.current?.unlock(),
      /** Follow the countdown at `position` seconds to zero; negative in overtime */
      followCountdown: (position: number) => loop.current?.play(position),
      pauseLoop: () => loop.current?.pause(),
      stopLoop: () => loop.current?.stop(),
    }),
    [],
  );
};
