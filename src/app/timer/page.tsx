"use client";

import { useMemo, useState } from "react";
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
import { useTurnCounter } from "@/hooks/useTurnCounter";
import { EditableField } from "@/components/EditableField";
import { FullScreen, useFullScreenHandle } from "react-full-screen";

const initialTime = 5 * 60;
const expectedTurns = 90;

export default function Home() {
  const handle = useFullScreenHandle();
  const { height, width } = useWindowSize();
  const [started, setStarted] = useState(false);
  const stopwatch = useStopwatch({ autoStart: false });
  const timer = useTimer({
    autoStart: false,
    expiryTimestamp: new Date(),
    onExpire: () => stopwatch.reset(),
  });
  const [times, addTime] = useImmutableList<number>();
  const [averageTime, setAverageTime] = useState(initialTime);
  const { remainingTurns, nextTurn, setExpectedTurns } =
    useTurnCounter(expectedTurns);
  const [preventClickCapture, setPreventClickCapture] = useState(false);
  const timerFinished = timer.totalSeconds === 0 && started;
  const paused = useMemo(
    () => !timer.isRunning && !stopwatch.isRunning,
    [timer, stopwatch],
  );

  // useEffect(() => {
  //   if (timerFinished) stopwatch.reset();
  // }, [timerFinished]);

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

  return (
    <FullScreen handle={handle}>
      <div
        className={styles.container}
        onClick={() => {
          if (!preventClickCapture) resetTimer();
        }}
      >
        <main className={styles.main}>
          <div style={{ width: size, height: size }}>
            <CircularProgressbar
              value={(timer.totalSeconds / averageTime) * 100}
              background
              styles={{
                path: {
                  stroke: paused ? "grey" : "white",
                  strokeLinecap: "butt",
                  strokeWidth: "2",
                  strokeDasharray: "10, 5",
                },
                trail: {
                  strokeWidth: "0.2",
                },
                text: {
                  fontFamily: "monospace",
                  fill: paused ? "grey" : "white",
                },
                background: {
                  fill: "red",
                  fillOpacity: timerFinished
                    ? stopwatch.totalSeconds / averageTime
                    : 0,
                  transitionProperty: "fill-opacity",
                  transitionDuration: "2s",
                },
              }}
              text={
                timerFinished ? "+" + getStopwatchString() : getTimerString()
              }
            />
          </div>
        </main>
      </div>
      <footer className={styles.footer}>
        <EditableField
          text={"Remaining Turns: " + remainingTurns}
          value={remainingTurns.toString()}
          onChange={(text) => setExpectedTurns(Number(text))}
          onEditingChange={setPreventClickCapture}
        />
        {paused ? (
          <button onClick={unpause} className={styles.button}>
            ⏵
          </button>
        ) : (
          <button onClick={pause} className={styles.button}>
            ⏸
          </button>
        )}

        <span suppressHydrationWarning={true}>
          Predicted game finish:{" "}
          {getDateSecondsFromNow(
            remainingTurns * averageTime,
          ).toLocaleTimeString()}
        </span>
      </footer>

      <div className={styles.menuContainer}>
        {handle.active ? (
          <button className={styles.button} onClick={handle.exit}>
            x
          </button>
        ) : (
          <button className={styles.button} onClick={handle.enter}>
            ⛶
          </button>
        )}
      </div>
    </FullScreen>
  );
}
