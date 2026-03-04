"use client";

import styles from "./page.module.css";
import { CircularProgressbar } from "react-circular-progressbar";

import "react-circular-progressbar/dist/styles.css";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Footer } from "@/components/timer/Footer";
import { FullScreen } from "@/components/FullScreen";
import { useTurnCounter } from "@/hooks/useTurnCounter";
import { useEffect, useMemo, useState } from "react";
import { useTimer } from "@/hooks/useTimer";
import { PlayerArcs } from "@/components/timer/PlayerArcs";
import { useGameSetup } from "@/hooks/useGameSetupModal";
import { GameConfig } from "@/components/GameSetupModal";

const initialTime = 5 * 60;
const expectedTurns = 90;

export default function Home() {
  const { height, width } = useWindowSize();
  const { turns, remainingTurns, nextTurn, setExpectedTurns } =
    useTurnCounter(expectedTurns);

  const {
    getTimerString,
    getStopwatchString,
    size,
    pause,
    unpause,
    resetTimer,
    paused,
    timerTotalSeconds,
    stopwatchTotalSeconds,
    averageTime,
    timerFinished,
  } = useTimer({ initialTime, height, width, nextTurn });
  const [preventClickCapture, setPreventClickCapture] = useState(false);

  const [config, setConfig] = useState<GameConfig>();
  const { open, isOpen, modal } = useGameSetup(setConfig);
  const [firstOpen, setFirstOpen] = useState(true);
  useEffect(() => {
    if (firstOpen) {
      setFirstOpen(false);
      open();
    }
  }, [open, firstOpen]);
  useEffect(() => {
    setPreventClickCapture(isOpen);
  }, [isOpen]);
  const numPlayers = useMemo(() => config?.players?.length, [config]);
  const currentPlayerIndex = useMemo(
    () => turns % (numPlayers || 0),
    [turns, numPlayers],
  );

  return (
    <FullScreen>
      <div
        className={styles.container}
        onClick={() => {
          if (!preventClickCapture) resetTimer();
        }}
      >
        {modal}
        <main className={styles.main}>
          <div style={{ width: size, height: size, position: "relative" }}>
            {config?.players && (
              <PlayerArcs
                players={config?.players}
                activeIndex={currentPlayerIndex}
                containerSize={size}
                internalSizeOffset={40}
              />
            )}
            <CircularProgressbar
              value={(timerTotalSeconds / averageTime) * 100}
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
                    ? stopwatchTotalSeconds / averageTime
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
      <Footer
        {...{
          remainingTurns,
          setExpectedTurns,
          setPreventClickCapture,
          paused,
          pause,
          unpause,
          averageTime,
        }}
      />
    </FullScreen>
  );
}
