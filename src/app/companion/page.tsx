"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./page.module.css";
import { useSessionCompanion } from "@/hooks/useSessionCompanion";
import {
  PEER_PROTOCOL_VERSION,
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { ScorePanel } from "@/components/ScorePanel";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { VictoryBanner } from "@/components/VictoryBanner";
import { getPlayerStats } from "@/utils/getPlayerStats";
import {
  selectCurrentPlayerIndex,
  selectRemainingTurns,
} from "@/state/gameSession";

// Persist the claimed slot per host so a refresh on the phone doesn't
// kick the player out of their seat.
const claimStorageKey = (hostCode: string) =>
  `game-timer:v1:companion:claim:${hostCode}`;

function CompanionScreen() {
  const params = useSearchParams();
  const code = params.get("code");

  const { status, lastMessage, error, send } =
    useSessionCompanion<HostToCompanionMessage>(code);

  const state = lastMessage?.type === "STATE" ? lastMessage.state : null;

  const [claimedSlot, setClaimedSlot] = useState<number | null>(null);

  // Restore a previously-claimed slot for this host when we arrive,
  // and re-announce it once we're connected.
  useEffect(() => {
    if (!code) return;
    try {
      const raw = window.localStorage.getItem(claimStorageKey(code));
      if (raw !== null) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) setClaimedSlot(parsed);
      }
    } catch {
      // localStorage unavailable — claim simply won't persist.
    }
  }, [code]);

  useEffect(() => {
    if (status === "connected" && claimedSlot !== null) {
      const msg: CompanionToHostMessage = {
        type: "CLAIM",
        protocolVersion: PEER_PROTOCOL_VERSION,
        playerIndex: claimedSlot,
      };
      send(msg);
    }
  }, [status, claimedSlot, send]);

  const claim = (playerIndex: number) => {
    setClaimedSlot(playerIndex);
    if (code) {
      try {
        window.localStorage.setItem(
          claimStorageKey(code),
          String(playerIndex),
        );
      } catch {
        // Persistence is best-effort.
      }
    }
    send({
      type: "CLAIM",
      protocolVersion: PEER_PROTOCOL_VERSION,
      playerIndex,
    } satisfies CompanionToHostMessage);
  };

  const release = () => {
    setClaimedSlot(null);
    if (code) {
      try {
        window.localStorage.removeItem(claimStorageKey(code));
      } catch {
        // best-effort
      }
    }
    send({
      type: "RELEASE",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);
  };

  const endTurn = () =>
    send({
      type: "END_TURN",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);

  const bumpScore = (delta: number) =>
    send({
      type: "INCREMENT_SCORE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      delta,
    } satisfies CompanionToHostMessage);

  const stats = useMemo(
    () =>
      state
        ? getPlayerStats(
            state.turns
              .filter((t) => t.playerIndex !== null)
              .map((t) => ({
                playerIndex: t.playerIndex as number,
                elapsedSeconds: t.elapsedSeconds,
              })),
          )
        : [],
    [state],
  );

  const activePlayerIndex = state ? selectCurrentPlayerIndex(state) : null;
  const activePlayer =
    state?.players && activePlayerIndex !== null
      ? state.players[activePlayerIndex]
      : undefined;
  const victorPlayer =
    state?.victor !== undefined && state?.victor !== null && state.players
      ? state.players[state.victor]
      : undefined;
  const remaining = state ? selectRemainingTurns(state) : 0;
  const scoresVisible = !!(
    state?.scoreConfig &&
    state.players &&
    state.players.length > 0
  );
  const claimedPlayer =
    claimedSlot !== null && state?.players
      ? state.players[claimedSlot]
      : undefined;
  const isMyTurn =
    claimedSlot !== null && activePlayerIndex === claimedSlot && !victorPlayer;
  const myScore =
    claimedSlot !== null && state ? (state.scores[claimedSlot] ?? state.scoreConfig?.min ?? 0) : 0;
  const scoreMin = state?.scoreConfig?.min ?? 0;
  const scoreMax = state?.scoreConfig?.max;
  const scoreStep = state?.scoreConfig?.increment ?? 1;
  const atMin = myScore <= scoreMin;
  const atMax = scoreMax !== undefined ? myScore >= scoreMax : false;

  if (!code) {
    return (
      <div className={styles.container}>
        <div className={styles.errorBox}>
          No host code in the URL — open this page from the Share button on a
          host device.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span
          className={`${styles.statusDot} ${
            status === "connecting"
              ? styles.statusDotConnecting
              : status === "connected"
                ? styles.statusDotConnected
                : status === "disconnected"
                  ? styles.statusDotDisconnected
                  : styles.statusDotError
          }`}
          aria-hidden
        />
        <span>
          {status === "connecting" && (
            <>
              Connecting to <span className={styles.hostCode}>{code}</span>…
            </>
          )}
          {status === "connected" && (
            <>
              Connected to <span className={styles.hostCode}>{code}</span>
            </>
          )}
          {status === "disconnected" && (
            <>
              Disconnected from <span className={styles.hostCode}>{code}</span>
            </>
          )}
          {status === "error" && (
            <>Failed to connect: {error?.message ?? "unknown error"}</>
          )}
        </span>
        {claimedPlayer && (
          <span className={styles.claimedAs}>
            <span
              className={styles.claimSwatch}
              style={{ background: claimedPlayer.color }}
              aria-hidden
            />
            {claimedPlayer.name}
            <button
              type="button"
              onClick={release}
              className={styles.changeButton}
            >
              change
            </button>
          </span>
        )}
      </div>

      {!state && status === "connected" && (
        <div className={styles.empty}>Waiting for the host to share state…</div>
      )}

      {state && (
        <>
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

          <div className={styles.bigStat}>
            <span className={styles.bigStatValue}>{remaining}</span>
            <span className={styles.bigStatLabel}>turns remaining</span>
          </div>

          {state.players && state.players.length > 0 && claimedSlot === null && (
            <div className={styles.claimPanel}>
              <span className={styles.claimTitle}>Claim a player</span>
              <ul className={styles.claimList}>
                {state.players.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => claim(i)}
                      className={styles.claimRow}
                    >
                      <span
                        className={styles.claimSwatch}
                        style={{ background: p.color }}
                        aria-hidden
                      />
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {claimedPlayer && !victorPlayer && (
            <button
              type="button"
              onClick={endTurn}
              disabled={!isMyTurn}
              className={styles.endTurnButton}
            >
              {isMyTurn ? "End my turn" : "Waiting for your turn…"}
            </button>
          )}

          {claimedPlayer && state.scoreConfig && (
            <div className={styles.scoreControls}>
              <button
                type="button"
                onClick={() => bumpScore(-scoreStep)}
                disabled={atMin}
                className={styles.scoreButton}
                aria-label="Decrease my score"
              >
                <Minus aria-hidden />
              </button>
              <div>
                <div className={styles.scoreLabel}>My score</div>
                <div className={styles.scoreValue}>{myScore}</div>
              </div>
              <button
                type="button"
                onClick={() => bumpScore(scoreStep)}
                disabled={atMax}
                className={styles.scoreButton}
                aria-label="Increase my score"
              >
                <Plus aria-hidden />
              </button>
            </div>
          )}

          <div className={styles.bottomStack}>
            {scoresVisible && state.players && state.scoreConfig && (
              <ScorePanel
                players={state.players}
                scores={state.scores}
                scoreConfig={state.scoreConfig}
                readOnly
              />
            )}
            {stats.length > 0 && (
              <PlayerTimeShare stats={stats} players={state.players || []} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function CompanionPage() {
  return (
    <Suspense fallback={null}>
      <CompanionScreen />
    </Suspense>
  );
}
