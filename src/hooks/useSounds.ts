import { useRef } from "react";

export const useSounds = () => {
  const next = useRef<HTMLAudioElement | undefined>(
    typeof Audio !== "undefined" ? new Audio("sound/next.wav") : undefined,
  );

  const overtime = useRef<HTMLAudioElement | undefined>(
    typeof Audio !== "undefined" ? new Audio("sound/overtime.mp3") : undefined,
  );

  return {
    playNext: () => next.current?.play(),
    playOvertime: () => overtime.current?.play(),
  };
};
