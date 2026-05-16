"use client";

import styles from "./page.module.css";
import { CircularProgressbar } from "react-circular-progressbar";

import "react-circular-progressbar/dist/styles.css";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Footer } from "@/components/timer/Footer";
import { FullScreen } from "@/components/FullScreen";
import { useEffect, useMemo, useState } from "react";
import { useTimer } from "@/hooks/useTimer";
import { PlayerArcs } from "@/components/timer/PlayerArcs";
import { useGameSetup } from "@/hooks/useGameSetupModal";
import { GameConfig } from "@/components/GameSetupModal";
import { getPlayerStats } from "@/utils/getPlayerStats";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";

const initialTime = 5 * 60;
const defaultExpectedTurns = 90;

export default function Home() {
  const { height, width } = useWindowSize();

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
    state,
    remainingTurns,
    currentPlayerIndex,
    setExpectedTurns,
    setPlayers,
  } = useTimer({
    initialTime,
    initialExpectedTurns: defaultExpectedTurns,
    height,
    width,
  });

  const [preventClickCapture, setPreventClickCapture] = useState(false);
  const [config, setConfig] = useState<GameConfig>();

  const applyConfig = (incoming: GameConfig) => {
    setConfig(incoming);
    setExpectedTurns(incoming.expectedTurns);
    setPlayers(incoming.players);
  };

  const { open, isOpen, modal } = useGameSetup(applyConfig);

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

  const playerStats = useMemo(
    () =>
      getPlayerStats(
        state.turns
          .filter((t) => t.playerIndex !== null)
          .map((t) => ({
            playerIndex: t.playerIndex as number,
            elapsedSeconds: t.elapsedSeconds,
          })),
      ),
    [state.turns],
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
            {config?.players && currentPlayerIndex !== null && (
              <PlayerArcs
                players={config.players}
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
      <PlayerTimeShare stats={playerStats} players={config?.players || []} />
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
