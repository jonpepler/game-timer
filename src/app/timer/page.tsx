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
import { ScorePanel } from "@/components/ScorePanel";
import { VictoryBanner } from "@/components/VictoryBanner";
import { findDefinition } from "@/state/definitionRegistry";
import { Plus } from "lucide-react";
import { ShareSessionMenu } from "@/components/ShareSessionMenu";
import { useSessionHost } from "@/hooks/useSessionHost";
import {
  PEER_PROTOCOL_VERSION,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";

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
    undo,
    canUndo,
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
    setScoreConfig,
    incrementScore,
    reset,
    scores,
    scoreConfig,
    victor,
  } = useTimer({
    initialTime,
    initialExpectedTurns: defaultExpectedTurns,
    height,
    width,
  });

  const players = state.players;
  const sessionHost = useSessionHost();

  // Broadcast the latest reducer state to every connected companion
  // whenever it changes OR a new device joins.
  const peerCount = sessionHost.connectedPeers.length;
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    const message: HostToCompanionMessage = {
      type: "STATE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      state,
      sentAt: Date.now(),
    };
    sessionHost.send(message);
  }, [state, peerCount, sessionHost.status, sessionHost.send]);

  const [preventClickCapture, setPreventClickCapture] = useState(false);

  const applyConfig = (incoming: GameConfig) => {
    // Wipe any prior session so submitting the modal mid-game starts
    // genuinely fresh — turn log + scores cleared, imperative timer
    // parked. Then layer the new settings on top.
    reset();
    setExpectedTurns(incoming.expectedTurns);
    setPlayers(incoming.players);
    const definition = findDefinition(incoming.definitionId);
    // Score is only meaningful when player tracking is on — clear the
    // subsystem otherwise so victories can't fire against an empty roster.
    setScoreConfig(incoming.players ? definition?.score : undefined);
  };

  const { open, isOpen, modal } = useGameSetup(applyConfig);

  // Only auto-open the setup modal on first mount when there's nothing
  // to resume — a restored session counts as already-configured.
  const needsSetup = players === undefined && state.turns.length === 0;
  const [firstOpen, setFirstOpen] = useState(true);
  useEffect(() => {
    if (firstOpen) {
      setFirstOpen(false);
      if (needsSetup) open();
    }
  }, [open, firstOpen, needsSetup]);
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

  const activePlayer =
    players && currentPlayerIndex !== null
      ? players[currentPlayerIndex]
      : undefined;

  const victorPlayer =
    victor !== null && players ? players[victor] : undefined;

  const scoresVisible =
    scoreConfig !== undefined && (players?.length ?? 0) > 0;

  return (
    <FullScreen
      menuExtras={
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            className={styles.newGameButton}
            aria-label="Start a new game"
          >
            <Plus size={16} aria-hidden />
            New game
          </button>
          <ShareSessionMenu
            status={sessionHost.status}
            sessionCode={sessionHost.sessionCode}
            connectedPeers={sessionHost.connectedPeers}
            error={sessionHost.error}
            open={sessionHost.open}
            close={sessionHost.close}
          />
        </>
      }
    >
      <div
        className={styles.container}
        onClick={() => {
          if (!preventClickCapture) resetTimer();
        }}
      >
        {modal}
        <main className={styles.main}>
          {victorPlayer ? (
            <VictoryBanner victor={victorPlayer} />
          ) : (
            activePlayer && (
              <div
                className={styles.activePlayer}
                style={{ color: activePlayer.color }}
              >
                <span
                  className={styles.activePlayerSwatch}
                  style={{ background: activePlayer.color }}
                  aria-hidden
                />
                {/* eslint-disable-next-line prettier/prettier */}
                <span>{activePlayer.name}<span className={styles.activePlayerSuffix}>{"’s turn"}</span></span>
              </div>
            )
          )}
          <div style={{ width: size, height: size, position: "relative" }}>
            {players && currentPlayerIndex !== null && (
              <PlayerArcs
                players={players}
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
                  stroke: paused
                    ? "var(--color-timer-paused)"
                    : "var(--color-timer-active)",
                  strokeLinecap: "butt",
                  strokeWidth: "2",
                  strokeDasharray: "10, 5",
                },
                trail: {
                  strokeWidth: "0.2",
                },
                text: {
                  fontFamily: "monospace",
                  fill: paused
                    ? "var(--color-timer-paused)"
                    : "var(--color-timer-active)",
                },
                background: {
                  fill: "var(--color-timer-overtime)",
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
      {(scoresVisible || playerStats.length > 0) && (
        <div className={styles.playerOverlay}>
          {scoresVisible && players && scoreConfig && (
            <ScorePanel
              players={players}
              scores={scores}
              scoreConfig={scoreConfig}
              onIncrement={incrementScore}
            />
          )}
          {playerStats.length > 0 && (
            <PlayerTimeShare stats={playerStats} players={players || []} />
          )}
        </div>
      )}
      <Footer
        {...{
          remainingTurns,
          setExpectedTurns,
          setPreventClickCapture,
          paused,
          pause,
          unpause,
          averageTime,
          undo,
          canUndo,
        }}
      />
    </FullScreen>
  );
}
