import { useMemo, useState } from "react";
import {
  StopwatchResult,
  TimerResult,
  useStopwatch,
  useTimer as useInternalTimer,
} from "react-timer-hook";
import { useImmutableList } from "@/hooks/useImmutableList";
import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { useSounds } from "./useSounds";

type UseTimerProps = {
  initialTime: number;
  height: number;
  width: number;
  nextTurn: () => void;
};

export const useTimer = ({
  initialTime,
  height,
  width,
  nextTurn,
}: UseTimerProps) => {
  const { playNext, playOvertime } = useSounds();
  const [started, setStarted] = useState(false);

  const stopwatch = useStopwatch({ autoStart: false });
  const timer = useInternalTimer({
    autoStart: false,
    expiryTimestamp: new Date(),
    onExpire: () => {
      stopwatch.reset();
      if (playOvertime) playOvertime();
    },
  });
  const [times, addTime] = useImmutableList<number>();
  const [averageTime, setAverageTime] = useState(initialTime);

  const timerFinished = timer.totalSeconds === 0 && started;
  const paused = useMemo(
    () => !timer.isRunning && !stopwatch.isRunning,
    [timer, stopwatch],
  );

  const getNewAverageTime = (newTime: number) =>
    Math.floor(
      times.reduce((total, sum) => total + sum, newTime) / (times.length + 1),
    );

  const startTimer = () => {
    timer.restart(getDateSecondsFromNow(averageTime));
    setStarted(true);
  };

  const resetTimer = () => {
    if (!started) {
      startTimer();
      return;
    }
    const timePassed =
      averageTime -
      timer.totalSeconds +
      (timerFinished ? stopwatch.totalSeconds : 0);
    const newAverageTime = getNewAverageTime(timePassed);
    addTime(timePassed);
    setAverageTime(newAverageTime);
    timer.restart(getDateSecondsFromNow(newAverageTime));

    if (playNext) playNext();
    nextTurn();
  };

  const getTimeString = (t: TimerResult | StopwatchResult) =>
    `${t.hours ? t.hours + ":" : ""}${t.minutes.toString().padStart(2, "0")}:${t.seconds.toString().padStart(2, "0")}`;

  const getTimerString = () => getTimeString(timer);
  const getStopwatchString = () => getTimeString(stopwatch);

  const size = (Math.min(...[height, width]) / 3) * 2;

  const pause = () => {
    timer.pause();
    stopwatch.pause();
  };
  const unpause = () => {
    if (!timerFinished) timer.resume();
    stopwatch.start();
  };

  return {
    getTimerString,
    getStopwatchString,
    size,
    pause,
    unpause,
    resetTimer,
    paused,
    timerTotalSeconds: timer.totalSeconds,
    stopwatchTotalSeconds: stopwatch.totalSeconds,
    averageTime,
    timerFinished,
    times,
  };
};
