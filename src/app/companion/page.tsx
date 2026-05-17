"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import styles from "./page.module.css";
import { useSessionCompanion } from "@/hooks/useSessionCompanion";
import type { HostToCompanionMessage } from "@/state/peerProtocol";
import { ScorePanel } from "@/components/ScorePanel";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { VictoryBanner } from "@/components/VictoryBanner";
import { getPlayerStats } from "@/utils/getPlayerStats";
import {
  selectCurrentPlayerIndex,
  selectRemainingTurns,
} from "@/state/gameSession";

function CompanionScreen() {
  const params = useSearchParams();
  const code = params.get("code");

  const { status, lastMessage, error } =
    useSessionCompanion<HostToCompanionMessage>(code);

  const state = lastMessage?.type === "STATE" ? lastMessage.state : null;

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
