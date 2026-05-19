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
  type Player,
} from "@/state/gameSession";
import { playerColor, playerSubheading } from "@/lib/playerVisual";
import type {
  GameDefinition,
  SetupConstraint,
  SetupOption,
  SetupStep,
} from "@/state/gameDefinition";

// Read the chosen-option id from a player's metadata via the
// active definition's playerVisualFrom key. Returns undefined when
// either the key isn't declared or the metadata isn't set yet.
const optionIdFor = (
  player: Player,
  visualKey: string | undefined,
): string | undefined => {
  if (!visualKey) return undefined;
  const m = player.metadata[visualKey];
  if (m?.type === "selected-option") return m.optionId;
  return undefined;
};

// Locate the player-pick SetupStep in the active definition. Companion
// reads its options to populate its own faction-style picker.
const findPlayerPickStep = (
  definition: GameDefinition | undefined,
):
  | {
      step: SetupStep;
      options: SetupOption[];
      constraints: SetupConstraint[];
    }
  | undefined => {
  const step = definition?.setupSteps?.find(
    (s) => s.kind.type === "player-pick",
  );
  if (!step || step.kind.type !== "player-pick") return undefined;
  return {
    step,
    options: step.kind.options,
    constraints: step.kind.constraints ?? [],
  };
};

// Persist the claimed slot per host so a refresh on the phone doesn't
// kick the player out of their seat.
const claimStorageKey = (hostCode: string) =>
  `game-timer:v1:companion:claim:${hostCode}`;

function CompanionScreen() {
  const params = useSearchParams();
  const code = params.get("code");

  const { status, lastMessage, error, send } =
    useSessionCompanion<HostToCompanionMessage>(code);

  // Track the most recent message of each type. STATE arrives during
  // gameplay; SETUP_TURN / SETUP_DONE arrive during the host's
  // wizard. We keep both so the picker overlay can layer on top of
  // the state view.
  const [lastState, setLastState] = useState<
    Extract<HostToCompanionMessage, { type: "STATE" }> | null
  >(null);
  const [pendingTurn, setPendingTurn] = useState<
    Extract<HostToCompanionMessage, { type: "SETUP_TURN" }> | null
  >(null);
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "STATE") setLastState(lastMessage);
    else if (lastMessage.type === "SETUP_TURN") setPendingTurn(lastMessage);
    else if (lastMessage.type === "SETUP_DONE") setPendingTurn(null);
  }, [lastMessage]);

  const state = lastState?.state ?? null;
  const definition = pendingTurn?.definition ?? lastState?.definition;

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
        window.localStorage.setItem(claimStorageKey(code), String(playerIndex));
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

  // Mid-game option swap (e.g. faction change). Looks up the
  // player-pick step on the definition snapshot to fill in stepId.
  const pickOption = (optionId: string) => {
    const pick = definition ? findPlayerPickStep(definition) : undefined;
    if (!pick) return;
    send({
      type: "SET_PLAYER_OPTION",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: pick.step.id,
      optionId,
    } satisfies CompanionToHostMessage);
  };

  // Wizard-time pick response. Sent in answer to a SETUP_TURN from
  // the host; the host applies it to the wizard's setupContext.
  const sendSetupPick = (optionId: string) => {
    if (!pendingTurn) return;
    send({
      type: "SETUP_PICK",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: pendingTurn.stepId,
      seatIndex: pendingTurn.seatIndex,
      optionId,
    } satisfies CompanionToHostMessage);
    // Clear locally — host will broadcast the next SETUP_TURN (or
    // SETUP_DONE) shortly. Optimistic to avoid flicker.
    setPendingTurn(null);
  };

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

  const visualKey = definition?.playerVisualFrom;
  const subheadingKey = definition?.playerSubheadingFrom;
  const pickStep = findPlayerPickStep(definition);
  const activePlayerIndex = state ? selectCurrentPlayerIndex(state) : null;
  const playerViews =
    state?.players?.map((p, i) => ({
      name: p.name,
      color: playerColor(p, i, visualKey),
    })) ?? [];
  const activeSubheading =
    state?.players && activePlayerIndex !== null
      ? playerSubheading(state.players[activePlayerIndex], subheadingKey)
      : undefined;
  const activePlayer =
    activePlayerIndex !== null ? playerViews[activePlayerIndex] : undefined;
  const victorPlayer =
    state?.victor !== undefined && state?.victor !== null
      ? playerViews[state.victor]
      : undefined;
  const remaining = state ? selectRemainingTurns(state) : 0;
  const scoresVisible = !!(
    state?.scoreConfig &&
    state.players &&
    state.players.length > 0
  );
  const claimedPlayer =
    claimedSlot !== null && playerViews.length > 0
      ? playerViews[claimedSlot]
      : undefined;
  const claimedOptionId =
    claimedSlot !== null && state?.players
      ? optionIdFor(state.players[claimedSlot], visualKey)
      : undefined;
  const isMyTurn =
    claimedSlot !== null && activePlayerIndex === claimedSlot && !victorPlayer;
  const myScore =
    claimedSlot !== null && state
      ? (state.scores[claimedSlot] ?? state.scoreConfig?.min ?? 0)
      : 0;
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

      {pendingTurn && (
        <SetupTurnPanel
          pendingTurn={pendingTurn}
          claimedSlot={claimedSlot}
          onPick={sendSetupPick}
        />
      )}

      {!state && !pendingTurn && status === "connected" && (
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
                <span className={styles.activePlayerText}>
                  {/* eslint-disable-next-line prettier/prettier */}
                  <span>
                    {activePlayer.name}
                    <span className={styles.activePlayerSuffix}>
                      {"’s turn"}
                    </span>
                  </span>
                  {activeSubheading && (
                    <span className={styles.activePlayerSubheading}>
                      {activeSubheading}
                    </span>
                  )}
                </span>
              </div>
            )
          )}

          <div className={styles.bigStat}>
            <span className={styles.bigStatValue}>{remaining}</span>
            <span className={styles.bigStatLabel}>turns remaining</span>
          </div>

          {playerViews.length > 0 && claimedSlot === null && (
            <div className={styles.claimPanel}>
              <span className={styles.claimTitle}>Claim a player</span>
              <ul className={styles.claimList}>
                {playerViews.map((p, i) => (
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

          {claimedPlayer && pickStep && pickStep.options.length > 0 && (
            <div className={styles.factionPicker}>
              <label
                htmlFor="companion-faction"
                className={styles.factionPickerLabel}
              >
                {pickStep.step.label}
              </label>
              <select
                id="companion-faction"
                value={claimedOptionId ?? ""}
                onChange={(e) => pickOption(e.target.value)}
                className={styles.factionSelect}
              >
                <option value="" disabled>
                  — pick a {pickStep.step.label.toLowerCase()} —
                </option>
                {pickStep.options.map((o) => {
                  const ownedByOther = state.players?.some(
                    (p, i) =>
                      i !== claimedSlot && optionIdFor(p, visualKey) === o.id,
                  );
                  const mutex = pickStep.constraints
                    .filter((c) => c.type === "mutually-exclusive")
                    .map((c) => c.optionIds);
                  const mutexBlocked = state.players?.some((p, i) => {
                    if (i === claimedSlot) return false;
                    const oid = optionIdFor(p, visualKey);
                    if (!oid) return false;
                    return mutex.some(
                      ([a, b]) =>
                        (a === oid && b === o.id) || (b === oid && a === o.id),
                    );
                  });
                  return (
                    <option
                      key={o.id}
                      value={o.id}
                      disabled={!!ownedByOther || !!mutexBlocked}
                    >
                      {o.label}
                    </option>
                  );
                })}
              </select>
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
            {scoresVisible && playerViews.length > 0 && state.scoreConfig && (
              <ScorePanel
                players={playerViews}
                scores={state.scores}
                scoreConfig={state.scoreConfig}
                readOnly
              />
            )}
            {stats.length > 0 && (
              <PlayerTimeShare stats={stats} players={playerViews} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SetupTurnPanel({
  pendingTurn,
  claimedSlot,
  onPick,
}: {
  pendingTurn: Extract<HostToCompanionMessage, { type: "SETUP_TURN" }>;
  claimedSlot: number | null;
  onPick: (optionId: string) => void;
}) {
  const myTurn = claimedSlot === pendingTurn.seatIndex;
  const pick = pendingTurn.definition
    ? findPlayerPickStep(pendingTurn.definition)
    : undefined;
  // The host sends a synthetic single-step definition snapshot; the
  // step's options are the resolved SetupOption objects. Filter to
  // what the host says is currently visible.
  const allOptions = pick?.options ?? [];
  const visible = pendingTurn.optionIds
    .map((id) => allOptions.find((o) => o.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const excluded = new Set(pendingTurn.excludedOptionIds);

  if (!myTurn) {
    return (
      <div className={styles.empty}>
        Waiting for seat {pendingTurn.seatIndex + 1} to pick a {pick?.step.label.toLowerCase() ?? "card"}…
      </div>
    );
  }

  return (
    <div className={styles.factionPicker}>
      <div className={styles.factionPickerHeader}>
        Your turn — choose a {pick?.step.label.toLowerCase() ?? "card"}
      </div>
      {visible.map((option) => {
        const isBlocked = excluded.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={isBlocked}
            onClick={() => onPick(option.id)}
            className={styles.factionButton}
            style={{
              borderColor: option.color ?? "var(--color-border)",
            }}
          >
            <span
              className={styles.factionSwatch}
              style={{ background: option.color ?? "var(--color-border)" }}
              aria-hidden
            />
            <span>{option.label}</span>
          </button>
        );
      })}
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
