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
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { createLogger } from "@/lib/logger";

const peerLog = createLogger("host-protocol");

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
    setPlayer,
    setScoreConfig,
    setDefinitionId,
    incrementScore,
    reset,
    scores,
    scoreConfig,
    victor,
    definitionId,
  } = useTimer({
    initialTime,
    initialExpectedTurns: defaultExpectedTurns,
    height,
    width,
  });

  const players = state.players;
  // peerId → claimed playerIndex. Released when the companion disconnects.
  const [claimMap, setClaimMap] = useState<Record<string, number>>({});

  const handleCompanionMessage = (peerId: string, data: unknown) => {
    const msg = data as CompanionToHostMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      peerLog.warn("dropping malformed message", { peerId });
      return;
    }
    if (msg.protocolVersion !== PEER_PROTOCOL_VERSION) {
      peerLog.warn("dropping message at unknown protocol version", {
        peerId,
        version: msg.protocolVersion,
      });
      return;
    }
    switch (msg.type) {
      case "CLAIM": {
        const playerCount = state.players?.length ?? 0;
        if (msg.playerIndex < 0 || msg.playerIndex >= playerCount) {
          peerLog.warn("rejecting CLAIM for out-of-range slot", {
            peerId,
            playerIndex: msg.playerIndex,
          });
          return;
        }
        setClaimMap((prev) => ({ ...prev, [peerId]: msg.playerIndex }));
        peerLog.info("claim accepted", {
          peerId,
          playerIndex: msg.playerIndex,
        });
        return;
      }
      case "RELEASE": {
        setClaimMap((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
        return;
      }
      case "END_TURN": {
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("END_TURN rejected — peer hasn't claimed a slot", {
            peerId,
          });
          return;
        }
        if (claimed !== currentPlayerIndex) {
          peerLog.warn("END_TURN rejected — not this peer's turn", {
            peerId,
            claimed,
            currentPlayerIndex,
          });
          return;
        }
        resetTimer();
        return;
      }
      case "INCREMENT_SCORE": {
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("INCREMENT_SCORE rejected — no claim", { peerId });
          return;
        }
        incrementScore(claimed, msg.delta);
        return;
      }
      case "SET_FACTION": {
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("SET_FACTION rejected — no claim", { peerId });
          return;
        }
        const def = definitionId ? findDefinition(definitionId) : undefined;
        const faction = def?.factions?.find((f) => f.id === msg.factionId);
        if (!faction) {
          peerLog.warn("SET_FACTION rejected — unknown factionId", {
            peerId,
            factionId: msg.factionId,
          });
          return;
        }
        // Already taken by another slot?
        const takenBy = state.players?.findIndex(
          (p, i) => i !== claimed && p.factionId === faction.id,
        );
        if (takenBy !== undefined && takenBy !== -1) {
          peerLog.warn("SET_FACTION rejected — faction taken by another slot", {
            peerId,
            factionId: faction.id,
          });
          return;
        }
        // Mutex with anything another slot already picked?
        const mutex =
          def?.setupSchema?.factionConstraints?.mutuallyExclusive ?? [];
        const blockedByMutex = state.players?.some((p, i) => {
          if (i === claimed) return false;
          if (!p.factionId) return false;
          return mutex.some(
            ([a, b]) =>
              (a === p.factionId && b === faction.id) ||
              (b === p.factionId && a === faction.id),
          );
        });
        if (blockedByMutex) {
          peerLog.warn("SET_FACTION rejected — mutex with another slot", {
            peerId,
            factionId: faction.id,
          });
          return;
        }
        setPlayer(claimed, {
          name: faction.name,
          color: faction.color,
          factionId: faction.id,
        });
        return;
      }
    }
  };

  const handleCompanionDisconnect = (peerId: string) => {
    setClaimMap((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  };

  const sessionHost = useSessionHost({
    onMessage: handleCompanionMessage,
    onDisconnect: handleCompanionDisconnect,
  });

  // Broadcast the latest reducer state to every connected companion
  // whenever it changes OR a new device joins.
  const peerCount = sessionHost.connectedPeers.length;
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    const def = definitionId ? findDefinition(definitionId) : undefined;
    const message: HostToCompanionMessage = {
      type: "STATE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      state,
      definition: def,
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
    setDefinitionId(incoming.definitionId);
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

  const victorPlayer = victor !== null && players ? players[victor] : undefined;

  const scoresVisible = scoreConfig !== undefined && (players?.length ?? 0) > 0;

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
                <span>
                  {activePlayer.name}
                  <span className={styles.activePlayerSuffix}>{"’s turn"}</span>
                </span>
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
              activePlayerIndex={currentPlayerIndex}
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
