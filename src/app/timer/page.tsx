"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import { CircularProgressbar } from "react-circular-progressbar";
import {
  StopwatchResult,
  TimerResult,
  useStopwatch,
  useTimer,
} from "react-timer-hook";
import "react-circular-progressbar/dist/styles.css";
import { useImmutableList } from "@/hooks/useImmutableList";
import { useWindowSize } from "@/hooks/useWindowSize";

const initialTime = 5 * 60;

export default function Home() {
  const { height, width } = useWindowSize();
  const [started, setStarted] = useState(false);
  const timer = useTimer({ autoStart: false, expiryTimestamp: new Date() });
  const stopwatch = useStopwatch({ autoStart: false });
  const [times, addTime] = useImmutableList<number>();
  const [averageTime, setAverageTime] = useState(initialTime);

  const timerFinished = timer.totalSeconds === 0 && started;

  useEffect(() => {
    if (timerFinished) stopwatch.reset();
  }, [timerFinished]);

  const getDateSecondsFromNow = (seconds: number) => {
    const date = new Date();
    date.setSeconds(date.getSeconds() + seconds);
    return date;
  };

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
  };

  const getTimeString = (t: TimerResult | StopwatchResult) =>
    `${t.hours ? t.hours + ":" : ""}${t.minutes.toString().padStart(2, "0")}:${t.seconds.toString().padStart(2, "0")}`;

  const getTimerString = () => getTimeString(timer);
  const getStopwatchString = () => getTimeString(stopwatch);

  const size = (Math.min(...[height, width]) / 3) * 2;

  return (
    <main className={styles.main} onClick={resetTimer}>
      <div style={{ width: size, height: size }}>
        <CircularProgressbar
          value={(timer.totalSeconds / averageTime) * 100}
          styles={{
            root: {
              // stroke: "red",
            },
            path: {
              // Path color
              stroke: "rgba(255, 255, 255)",
              // Whether to use rounded or flat corners on the ends - can use 'butt' or 'round'
              strokeLinecap: "butt",
              strokeWidth: "2",
              strokeDasharray: "10, 5",
              // Customize transition animation
              // transition: "stroke-dashoffset 0.5s ease 0s",
              // Rotate the path
              // transform: "rotate(0.25turn)",
              // transformOrigin: "center center",
            },
            trail: {
              strokeWidth: "0.2",
            },
            text: {
              fontFamily: "monospace",
              fill: "white",
            },
            background: {},
          }}
          text={timerFinished ? "+" + getStopwatchString() : getTimerString()}
        />
      </div>
    </main>
  );
}
