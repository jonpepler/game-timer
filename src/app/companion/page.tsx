"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./page.module.css";
import { useSessionCompanion } from "@/hooks/useSessionCompanion";
import { describePeerError } from "@/lib/peerTransport";
import { CodeEntryPanel } from "./CodeEntryPanel";
import {
  PEER_PROTOCOL_VERSION,
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { ScorePanel } from "@/components/ScorePanel";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { VictoryBanner } from "@/components/VictoryBanner";
import { PlayerMeeple } from "@/components/PlayerMeeple";
import { EventDialog } from "@/components/EventDialog";
import { FullScreen } from "@/components/FullScreen";
import { getPlayerStats } from "@/utils/getPlayerStats";
import {
  selectCanSeize,
  selectCurrentPlayerIndex,
  selectRemainingTurns,
} from "@/state/gameSession";
import {
  playerColor,
  playerHeadIcon,
  playerIcon,
  playerSubheading,
} from "@/lib/playerVisual";
import { createLogger } from "@/lib/logger";
import type {
  GameDefinition,
  SetupConstraint,
  SetupOption,
  SetupStep,
} from "@/state/gameDefinition";
import type { Player } from "@/state/gameSession";

const stateLog = createLogger("companion-state");
const playersLog = createLogger("companion-players");

// Locate the player-pick SetupStep in the active definition. Companion
// reads its options to populate its own picker grid.
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
  if (step?.kind.type !== "player-pick") return undefined;
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

  const { status, lastMessage, error, send, peerId } =
    useSessionCompanion<HostToCompanionMessage>(code);

  // Track the most recent message of each type. STATE arrives during
  // gameplay; SETUP_TURN / SETUP_DONE / SETUP_SEATING arrive during
  // the host's wizard. We keep all of them so a companion landing
  // mid-setup can render the right control without waiting for the
  // next mutation.
  const [lastState, setLastState] = useState<Extract<
    HostToCompanionMessage,
    { type: "STATE" }
  > | null>(null);
  const [pendingTurn, setPendingTurn] = useState<Extract<
    HostToCompanionMessage,
    { type: "SETUP_TURN" }
  > | null>(null);
  const [pendingSeating, setPendingSeating] = useState<Extract<
    HostToCompanionMessage,
    { type: "SETUP_SEATING" }
  > | null>(null);
  // A pick we've sent and are waiting on the host to acknowledge (by
  // advancing the turn). Drives a "submitting…" state instead of
  // optimistically blanking the picker — and lets us resend if the
  // host's heartbeat shows it's still waiting on this same seat (i.e.
  // our SETUP_PICK was dropped). Held as both state (for render) and a
  // ref (so the message effect reads the latest without re-subscribing).
  const [submitting, setSubmitting] = useState(false);
  const submittedPickRef = useRef<{
    stepId: string;
    seatIndex: number;
    optionId: string;
  } | null>(null);
  // Trail the inter-arrival time of host messages so we can correlate
  // companion sluggishness with the rate of inbound STATE updates.
  // Refs (not state) so the diagnostic doesn't itself trigger a
  // re-render on every message.
  const lastMsgArrivedAtRef = useRef<number>(0);
  // Hash so we only log the roster snapshot when player identity
  // changes (name/metadata) — turn ticks shouldn't spam.
  const lastPlayersSigRef = useRef<string>("");
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "STATE") {
      setLastState(lastMessage);
      const now = Date.now();
      const dt = lastMsgArrivedAtRef.current
        ? now - lastMsgArrivedAtRef.current
        : null;
      lastMsgArrivedAtRef.current = now;
      const bytes = JSON.stringify(lastMessage).length;
      const transitMs = lastMessage.sentAt ? now - lastMessage.sentAt : null;
      stateLog.debug("STATE received", {
        bytes,
        intervalMs: dt,
        transitMs,
        turns: lastMessage.state.turns.length,
      });
      // Roster snapshot — fires when the players[] identity changes
      // (so we can confirm whether the inbound STATE carries the
      // expected color + iconSrc + headIconSrc on each player). Same
      // shape as the host-players logger so the two are easy to
      // cross-reference.
      const players = lastMessage.state.players ?? [];
      if (players.length > 0) {
        const slim = players.map((p, i) => ({
          i,
          name: p.name,
          metadata: p.metadata,
        }));
        const sig = JSON.stringify(slim);
        if (sig !== lastPlayersSigRef.current) {
          lastPlayersSigRef.current = sig;
          playersLog.info("roster", { players: slim });
        }
      }
    } else if (lastMessage.type === "SETUP_TURN") {
      setPendingTurn(lastMessage);
      const submitted = submittedPickRef.current;
      if (submitted) {
        if (
          lastMessage.stepId === submitted.stepId &&
          lastMessage.seatIndex === submitted.seatIndex
        ) {
          // Host is still on the seat we picked for — our SETUP_PICK
          // was dropped. The host re-broadcasts on a heartbeat, so we
          // use each re-arrival as a retry tick and resend the pick.
          send({
            type: "SETUP_PICK",
            protocolVersion: PEER_PROTOCOL_VERSION,
            stepId: submitted.stepId,
            seatIndex: submitted.seatIndex,
            optionId: submitted.optionId,
          } satisfies CompanionToHostMessage);
        } else {
          // Host advanced to a different seat/step — our pick landed.
          submittedPickRef.current = null;
          setSubmitting(false);
        }
      }
    } else if (lastMessage.type === "SETUP_DONE") {
      setPendingTurn(null);
      submittedPickRef.current = null;
      setSubmitting(false);
    } else if (lastMessage.type === "SETUP_SEATING")
      setPendingSeating(lastMessage);
  }, [lastMessage, send]);

  const state = lastState?.state ?? null;
  const definition = pendingTurn?.definition ?? lastState?.definition;

  const [claimedSlot, setClaimedSlot] = useState<number | null>(null);
  // When true, the player-option swap modal is open. Lets the
  // claimant pick a new option from the definition's player-pick
  // step without re-running setup.
  const [changingPlayerOption, setChangingPlayerOption] = useState(false);
  // Two-step preview inside the swap modal — same pattern as the
  // wizard's PlayerPickScreen. Tap card → confirm screen → Confirm.
  const [changePreviewId, setChangePreviewId] = useState<string | null>(null);

  // Companion-chosen display name, persisted per (code, slot) in
  // localStorage so it survives refreshes — and, crucially, across the
  // host starting a *new* game (which resets seat names to "Player N").
  // It's the companion's local source of truth and is propagated to the
  // host (see the sync effect below) so the shared main screen shows
  // the same name rather than a stale "Player 1".
  const [customName, setCustomName] = useState<string>("");
  // Distinguishes an active edit (user typing in "Your name") from a
  // passive load (restored from storage / reclaim). Active edits push
  // unconditionally; passive loads only fill in a default host name.
  const customNameEditedRef = useRef(false);
  const customNameKey =
    code && claimedSlot !== null
      ? `companion:name:${code}:${claimedSlot}`
      : null;
  useEffect(() => {
    if (!customNameKey) {
      setCustomName("");
      return;
    }
    try {
      setCustomName(window.localStorage.getItem(customNameKey) ?? "");
    } catch {
      setCustomName("");
    }
  }, [customNameKey]);
  const saveCustomName = (next: string) => {
    setCustomName(next);
    customNameEditedRef.current = true;
    if (!customNameKey) return;
    try {
      if (next) window.localStorage.setItem(customNameKey, next);
      else window.localStorage.removeItem(customNameKey);
    } catch {
      // localStorage unavailable — name simply won't persist.
    }
  };

  // Propagate the companion's name to the host so the main screen shows
  // it too — not just this device. Two triggers:
  //   • active edit ("Your name") → push immediately, overriding
  //     whatever the host currently has for our seat;
  //   • (re)claiming a seat whose host-side name is still a default
  //     "Player N" → fill in our remembered name. This is the new-game
  //     case: the host resets seat names, but we still remember "Jon".
  // A non-default host name we didn't just edit is left alone, so a
  // name the host deliberately set isn't clobbered. Routed as a seating
  // rename during setup, or RENAME_PLAYER once the game is running.
  useEffect(() => {
    const name = customName.trim();
    const activeEdit = customNameEditedRef.current;
    customNameEditedRef.current = false;
    if (!name || claimedSlot === null) return;
    const isDefaultName = (n: string | undefined) =>
      n === undefined || /^Player \d+$/.test(n);
    if (state?.players) {
      const hostName = state.players[claimedSlot]?.name;
      if (hostName === undefined || hostName === name) return;
      if (activeEdit || isDefaultName(hostName)) {
        send({
          type: "RENAME_PLAYER",
          protocolVersion: PEER_PROTOCOL_VERSION,
          name,
        } satisfies CompanionToHostMessage);
      }
    } else if (pendingSeating) {
      const seatName = pendingSeating.seats[claimedSlot]?.name;
      if (seatName === undefined || seatName === name) return;
      if (activeEdit || isDefaultName(seatName)) {
        send({
          type: "SEATING_REQUEST",
          protocolVersion: PEER_PROTOCOL_VERSION,
          stepId: pendingSeating.stepId,
          action: { kind: "rename", seatIndex: claimedSlot, name },
        } satisfies CompanionToHostMessage);
      }
    }
  }, [customName, claimedSlot, state, pendingSeating, send]);

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

  // Follow our claim across host-driven seat reorders. Whenever a
  // fresh SETUP_SEATING arrives, scan claimedBy[] for our own peer
  // id; if we find ourselves at a different index than `claimedSlot`,
  // sync local state to that index. This makes the companion's UI
  // follow its seat when the host moves it up/down in the seating
  // step.
  useEffect(() => {
    if (!pendingSeating || !peerId) return;
    const mineAt = pendingSeating.claimedBy.indexOf(peerId);
    if (mineAt !== -1 && mineAt !== claimedSlot) setClaimedSlot(mineAt);
  }, [pendingSeating, peerId, claimedSlot]);

  // Auto-reclaim during setup: when SETUP_SEATING arrives and the
  // companion has a stored claim but the host hasn't yet recorded it
  // (e.g. on first connect after a page refresh), ask the host to
  // honour the claim again. Skipped if our peer id is already
  // somewhere in claimedBy[] — the index-follow effect above
  // handles syncing claimedSlot in that case, and re-issuing here
  // would race against host-driven seat reorders.
  useEffect(() => {
    if (!pendingSeating || claimedSlot === null) return;
    if (peerId && pendingSeating.claimedBy.includes(peerId)) return;
    if (claimedSlot < 0 || claimedSlot >= pendingSeating.seats.length) return;
    const currentClaim = pendingSeating.claimedBy[claimedSlot];
    if (currentClaim !== null) return;
    send({
      type: "SEATING_REQUEST",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: pendingSeating.stepId,
      action: { kind: "claim", seatIndex: claimedSlot },
    } satisfies CompanionToHostMessage);
  }, [pendingSeating, claimedSlot, peerId, send]);

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

  // Optimistic lock: when the user taps End my turn, we disable
  // the button immediately and don't re-enable until the host's
  // STATE confirms we're no longer the active player. Without
  // this the button stays highlighted for the round-trip and
  // can be clicked multiple times in rapid succession.
  const [endingTurn, setEndingTurn] = useState(false);
  const endTurn = () => {
    setEndingTurn(true);
    send({
      type: "END_TURN",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);
  };
  // Clear the lock once the host has rotated us off the active
  // seat (STATE has arrived with a new currentPlayerIndex).

  const bumpScore = (delta: number) =>
    send({
      type: "INCREMENT_SCORE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      delta,
    } satisfies CompanionToHostMessage);

  const seizeInitiative = () =>
    send({
      type: "SEIZE",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);

  // Wizard-time pick response. Sent in answer to a SETUP_TURN from
  // the host; the host applies it to the wizard's setupContext.
  // Player-pick is identity-bound: the companion can only pick for
  // the seat they've claimed, so we route the message through
  // claimedSlot rather than the SETUP_TURN's seatIndex hint.
  const sendSetupPick = (optionId: string) => {
    if (!pendingTurn) return;
    if (claimedSlot === null || claimedSlot !== pendingTurn.seatIndex) return;
    send({
      type: "SETUP_PICK",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: pendingTurn.stepId,
      seatIndex: claimedSlot,
      optionId,
    } satisfies CompanionToHostMessage);
    // Show a "submitting…" state rather than blanking the picker.
    // Cleared (or resent) when the host's next SETUP_TURN/SETUP_DONE
    // arrives — see the message effect above. This is what makes a
    // dropped pick recover gracefully instead of leaving the player
    // staring at an empty screen.
    submittedPickRef.current = {
      stepId: pendingTurn.stepId,
      seatIndex: claimedSlot,
      optionId,
    };
    setSubmitting(true);
  };

  // Seating-step edits — the companion can claim, rename, add, and
  // remove seats from the host's wizard during early setup. The host
  // validates each request against the step's min/max bounds before
  // re-broadcasting fresh SETUP_SEATING to every connected peer.
  const sendSeating = (
    action:
      | { kind: "add"; name: string }
      | { kind: "rename"; seatIndex: number; name: string }
      | { kind: "remove"; seatIndex: number }
      | { kind: "claim"; seatIndex: number },
  ) => {
    if (!pendingSeating) return;
    send({
      type: "SEATING_REQUEST",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: pendingSeating.stepId,
      action,
    } satisfies CompanionToHostMessage);
  };

  const tapTimer = () =>
    send({
      type: "TAP_TIMER",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);

  const dismissMilestone = () =>
    send({
      type: "DISMISS_MILESTONE",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);

  // Escape-hatch player-option swap — lets a player whose seat is
  // wired to the wrong (or no) option fix it mid-game without
  // re-setting up. Same wire format as a mid-game change-of-mind:
  // SET_PLAYER_OPTION is routed by the host's claim-map, so the
  // swap lands on the seat that THIS companion has claimed.
  const sendSetPlayerOption = (stepId: string, optionId: string) =>
    send({
      type: "SET_PLAYER_OPTION",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId,
      optionId,
    } satisfies CompanionToHostMessage);

  // Mid-game rename — needed because (a) the old SET_PLAYER_OPTION
  // bug wrote the option label over the player's display name, so
  // sessions in the wild need a repair path, and (b) renaming on the
  // fly is just nice to have. Host routes by the claiming peer's
  // seat so a companion can only rename its own player.
  const sendRenamePlayer = (name: string) =>
    send({
      type: "RENAME_PLAYER",
      protocolVersion: PEER_PROTOCOL_VERSION,
      name,
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

  const visualKey = definition?.playerVisualFrom;
  const subheadingKey = definition?.playerSubheadingFrom;
  const activePlayerIndex = state ? selectCurrentPlayerIndex(state) : null;
  const playerViews =
    state?.players?.map((p, i) => ({
      name: p.name,
      color: playerColor(p, i, visualKey),
      headIconSrc: playerHeadIcon(p, visualKey),
      iconSrc: playerIcon(p, visualKey),
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
      ? {
          ...playerViews[claimedSlot],
          // Local override beats the host-supplied name in the
          // companion UI.
          name: customName.trim() || playerViews[claimedSlot].name,
        }
      : undefined;
  const isMyTurn =
    claimedSlot !== null && activePlayerIndex === claimedSlot && !victorPlayer;
  // Seize is offered to the active seat under lead-relative turn order,
  // while it's still available this round. The host re-validates.
  const seizeLabel =
    state?.turnOrder?.mode === "lead-relative"
      ? (state.turnOrder.interrupt?.label ?? null)
      : null;
  const canSeize =
    isMyTurn && seizeLabel !== null && !!state && selectCanSeize(state);
  // Lift the End-my-turn optimistic lock once the host has
  // rotated us off the active seat.
  useEffect(() => {
    if (!isMyTurn) setEndingTurn(false);
  }, [isMyTurn]);
  // The host treats the very first tap of the timer container as
  // "start the timer." If a companion fires END_TURN before then,
  // it accidentally doubles as the start, which is confusing UX.
  // We gate the End-Turn affordance until the host has recorded at
  // least one turn — meaning the timer is genuinely running.
  const gameStarted = (state?.turns.length ?? 0) > 0;
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
        <CodeEntryPanel />
      </div>
    );
  }

  return (
    <FullScreen>
      <div className={styles.container}>
        <div className={styles.header}>
          <span
            className={`${styles.statusDot} ${
              status === "connecting" || status === "reconnecting"
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
            {status === "reconnecting" && (
              <>
                Reconnecting to <span className={styles.hostCode}>{code}</span>…
              </>
            )}
            {status === "disconnected" && (
              <>
                Disconnected from{" "}
                <span className={styles.hostCode}>{code}</span>
              </>
            )}
            {status === "error" && <>{describePeerError(error)}</>}
          </span>
          {claimedPlayer && (
            <span className={styles.claimedAs}>
              {/* Silhouette (body meeple) rather than the head crest:
                  for the Vagabond the head is a single generic crest
                  shared by every character, so the distinguishing art
                  is the per-character body meeple. Matches the host
                  timer's active-player banner. */}
              <PlayerMeeple
                iconSrc={claimedPlayer.iconSrc}
                color={claimedPlayer.color}
                headClassName={styles.claimHead}
                silhouetteClassName={styles.claimMeeple}
                fallback={
                  <span
                    className={styles.claimSwatch}
                    style={{ background: claimedPlayer.color }}
                    aria-hidden
                  />
                }
              />
              {claimedPlayer.name}
              <button
                type="button"
                onClick={release}
                className={styles.changeButton}
              >
                change seat
              </button>
              {/* Only show the swap link when the active definition
                  actually has a player-pick step (Generic doesn't,
                  so the swap would be a no-op). The button label
                  pulls from the step's own label so the wording
                  matches the game's vocabulary — no game-specific
                  noun in app code. */}
              {definition &&
                (() => {
                  const pickInfo = findPlayerPickStep(definition);
                  if (!pickInfo) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setChangePreviewId(null);
                        setChangingPlayerOption(true);
                      }}
                      className={styles.changeButton}
                    >
                      change {pickInfo.step.label.toLowerCase()}
                    </button>
                  );
                })()}
            </span>
          )}
        </div>

        {claimedPlayer && (
          <label className={styles.nameField}>
            <span className={styles.nameFieldLabel}>Your name</span>
            <input
              type="text"
              value={customName}
              onChange={(e) => saveCustomName(e.target.value)}
              placeholder={
                claimedSlot !== null
                  ? (playerViews[claimedSlot]?.name ?? "Your name")
                  : "Your name"
              }
              className={styles.nameInput}
            />
          </label>
        )}

        {pendingTurn && (
          <SetupTurnPanel
            pendingTurn={pendingTurn}
            claimedSlot={claimedSlot}
            onPick={sendSetupPick}
            submitting={submitting}
          />
        )}

        {!pendingTurn && pendingSeating && !state?.players && (
          <SetupSeatingPanel
            seating={pendingSeating}
            claimedSlot={claimedSlot}
            onClaim={(seatIndex) => {
              // Optimistically update local state so the UI reflects
              // the claim immediately; host will broadcast fresh
              // SETUP_SEATING to confirm (or reject if taken).
              setClaimedSlot(seatIndex);
              if (code) {
                try {
                  window.localStorage.setItem(
                    claimStorageKey(code),
                    String(seatIndex),
                  );
                } catch {
                  // best-effort
                }
              }
              sendSeating({ kind: "claim", seatIndex });
            }}
            onRename={(seatIndex, name) =>
              sendSeating({ kind: "rename", seatIndex, name })
            }
            onAdd={(name) => sendSeating({ kind: "add", name })}
            onRemove={(seatIndex) => sendSeating({ kind: "remove", seatIndex })}
          />
        )}

        {!state &&
          !pendingTurn &&
          !pendingSeating &&
          status === "connected" && (
            <div className={styles.empty}>
              Waiting for the host to share state…
            </div>
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
                  <PlayerMeeple
                    iconSrc={activePlayer.iconSrc}
                    color={activePlayer.color}
                    headClassName={styles.activePlayerHead}
                    silhouetteClassName={styles.activePlayerMeeple}
                    fallback={
                      <span
                        className={styles.activePlayerSwatch}
                        style={{ background: activePlayer.color }}
                        aria-hidden
                      />
                    }
                  />
                  <span className={styles.activePlayerText}>
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

            {playerViews.length === 0 &&
              gameStarted &&
              !pendingSeating &&
              !pendingTurn && (
                <>
                  <div className={styles.empty}>
                    The host is running a game without per-player tracking, so
                    there&apos;s nothing to claim or score from here. Tap below
                    to advance the timer.
                  </div>
                  <div className={styles.endTurnSlot}>
                    <button
                      type="button"
                      onClick={tapTimer}
                      className={styles.endTurnButton}
                    >
                      Next turn
                    </button>
                  </div>
                </>
              )}

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

            {/* Mid-game faction picker removed — faction selection
              happens during the host's wizard via the SETUP_TURN /
              SetupTurnPanel flow, not after the game has started. */}

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
                  firedMilestones={state.firedMilestones}
                />
              )}
              {stats.length > 0 && (
                <PlayerTimeShare stats={stats} players={playerViews} />
              )}
            </div>

            {/* End-Turn (or pending state) sits AFTER the score panel
              + time-share so other content can flow above it. The
              auto margin pushes it to the viewport bottom when there
              IS spare room. */}
            {claimedPlayer && !victorPlayer && (
              <div className={styles.endTurnSlot}>
                {gameStarted && canSeize && seizeLabel && (
                  <button
                    type="button"
                    onClick={seizeInitiative}
                    className={styles.seizeButton}
                  >
                    {seizeLabel}
                  </button>
                )}
                {gameStarted ? (
                  <button
                    type="button"
                    onClick={endTurn}
                    disabled={!isMyTurn || endingTurn}
                    className={styles.endTurnButton}
                  >
                    {isMyTurn ? "End my turn" : "Waiting for your turn…"}
                  </button>
                ) : (
                  <div className={styles.endTurnPending}>
                    Waiting for the host to start the timer…
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {changingPlayerOption && definition && claimedSlot !== null && (
        <ChangePlayerOptionModal
          definition={definition}
          claimedSlot={claimedSlot}
          players={state?.players ?? []}
          previewId={changePreviewId}
          onPreviewChange={setChangePreviewId}
          onConfirm={(stepId, optionId) => {
            sendSetPlayerOption(stepId, optionId);
            setChangingPlayerOption(false);
            setChangePreviewId(null);
          }}
          onRename={sendRenamePlayer}
          onClose={() => {
            setChangingPlayerOption(false);
            setChangePreviewId(null);
          }}
        />
      )}
      {state?.pendingMilestones && state.pendingMilestones.length > 0 && (
        <EventDialog
          milestone={state.pendingMilestones[0]}
          playerName={
            playerViews[state.pendingMilestones[0].playerIndex]?.name ??
            `Player ${state.pendingMilestones[0].playerIndex + 1}`
          }
          playerColor={
            playerViews[state.pendingMilestones[0].playerIndex]?.color ??
            "var(--color-border)"
          }
          playerHeadIconSrc={
            playerViews[state.pendingMilestones[0].playerIndex]?.headIconSrc
          }
          playerIconSrc={
            playerViews[state.pendingMilestones[0].playerIndex]?.iconSrc
          }
          onDismiss={dismissMilestone}
        />
      )}
    </FullScreen>
  );
}

function SetupTurnPanel({
  pendingTurn,
  claimedSlot,
  onPick,
  submitting,
}: {
  pendingTurn: Extract<HostToCompanionMessage, { type: "SETUP_TURN" }>;
  claimedSlot: number | null;
  onPick: (optionId: string) => void;
  submitting: boolean;
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

  // Two-step pick — mirrors the host's PlayerPickScreen. Tap a card
  // to open a full-screen confirm view; tap Confirm to send
  // SETUP_PICK; Back returns to the card list.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);

  // Cancel any open preview if the host moves the turn off this seat
  // (e.g. host took over and confirmed remotely) or if the previewed
  // option becomes unavailable.
  useEffect(() => {
    if (!myTurn) {
      setPreviewCardId(null);
      return;
    }
    if (previewCardId && excluded.has(previewCardId)) {
      setPreviewCardId(null);
    }
  }, [myTurn, previewCardId, excluded]);

  if (!myTurn) {
    return (
      <div className={styles.empty}>
        Waiting for seat {pendingTurn.seatIndex + 1} to pick a{" "}
        {pick?.step.label.toLowerCase() ?? "card"}…
      </div>
    );
  }

  const pickLabel = pick?.step.label.toLowerCase() ?? "card";

  // We've sent a pick and are waiting for the host to confirm by
  // advancing the turn. Show a quiet pending state rather than the
  // picker — if the pick was dropped the host's heartbeat re-arrives
  // and we resend (see the message effect), so this resolves itself.
  if (submitting) {
    return (
      <div className={styles.empty} aria-live="polite">
        Submitting your {pickLabel}…
      </div>
    );
  }

  if (previewCardId != null) {
    const previewOption =
      visible.find((o) => o.id === previewCardId) ??
      allOptions.find((o) => o.id === previewCardId) ??
      null;
    const previewAdset = previewOption
      ? (previewOption as unknown as { adsetSteps?: string[] }).adsetSteps
      : undefined;
    const previewMeeple = previewOption
      ? (
          previewOption as unknown as {
            assets?: { meepleSvg?: { appPath?: string } };
          }
        ).assets?.meepleSvg?.appPath
      : undefined;
    const previewColor = previewOption?.color ?? "var(--color-border)";
    const previewLabel = previewOption?.label ?? previewCardId;
    return (
      <div
        className={styles.heroPreview}
        role="region"
        aria-label={`Confirm ${previewLabel}`}
      >
        <div className={styles.heroPreviewInstruction}>
          <span className={styles.heroPreviewSubtle}>
            Your turn — confirm your pick
          </span>
          <span className={styles.heroPreviewTitle}>{previewLabel}</span>
        </div>
        <div
          className={styles.heroPreviewCard}
          style={
            {
              background: `color-mix(in srgb, ${previewColor} 18%, var(--color-surface))`,
              borderColor: previewColor,
            } as React.CSSProperties
          }
        >
          {previewMeeple && (
            <img
              src={previewMeeple}
              alt=""
              aria-hidden
              className={styles.heroPreviewMeeple}
              style={{
                background: previewColor,
                WebkitMaskImage: `url(${previewMeeple})`,
                maskImage: `url(${previewMeeple})`,
              }}
            />
          )}
          {previewAdset && previewAdset.length > 0 && (
            <ol className={styles.heroPreviewSteps}>
              {previewAdset.map((s, i) => (
                <li key={i}>
                  <span className={styles.heroCardAdsetIndex}>{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className={styles.heroPreviewActions}>
          <button
            type="button"
            onClick={() => setPreviewCardId(null)}
            className={styles.heroPreviewSecondary}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              onPick(previewCardId);
              setPreviewCardId(null);
            }}
            className={styles.heroPreviewPrimary}
          >
            Confirm setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.heroPicker}
      role="region"
      aria-label={`Your turn to pick a ${pickLabel}`}
    >
      <div className={styles.heroPickerHeader}>
        Your turn — choose a {pickLabel}
      </div>
      <div className={styles.heroCardColumn}>
        {visible.map((option) => {
          const isBlocked = excluded.has(option.id);
          const adsetSteps = (option as unknown as { adsetSteps?: string[] })
            .adsetSteps;
          const meepleSrc = (
            option as unknown as {
              assets?: { meepleSvg?: { appPath?: string } };
            }
          ).assets?.meepleSvg?.appPath;
          return (
            <button
              key={option.id}
              type="button"
              disabled={isBlocked}
              onClick={() => setPreviewCardId(option.id)}
              className={styles.heroCard}
              // Accessible name is just the option label, not the
              // computed text of all child nodes (which would
              // include every ADSET step).
              aria-label={option.label}
              style={
                {
                  ["--faction-color" as string]:
                    option.color ?? "var(--color-border)",
                } as React.CSSProperties
              }
            >
              <span className={styles.heroCardLabel}>{option.label}</span>
              {adsetSteps && adsetSteps.length > 0 && (
                <ol className={styles.heroCardAdset}>
                  {adsetSteps.map((s, i) => (
                    <li key={i}>
                      <span className={styles.heroCardAdsetIndex}>
                        {i + 1}.
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              )}
              {meepleSrc && (
                <img
                  src={meepleSrc}
                  alt=""
                  aria-hidden
                  className={styles.heroCardMeeple}
                  style={{
                    background: option.color ?? "var(--color-text)",
                    WebkitMaskImage: `url(${meepleSrc})`,
                    maskImage: `url(${meepleSrc})`,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Code-entry fallback for users who land on /companion without a
// ?code= in the URL (e.g. typed the address by hand, or shared the
// page URL not the QR link). Lets them paste / type a session code
// and navigate to ?code=… so the normal connect path takes over.
// Escape-hatch player-option swap modal — fullscreen, mirrors the
// wizard's PlayerPickScreen UX (tap card → preview → Confirm).
// Excludes options already claimed by other seats so the
// SET_PLAYER_OPTION peer message doesn't get rejected on the host.
// The host's mutex constraints still apply server-side — we only
// filter the obvious taken-by-someone-else case in the picker.
function ChangePlayerOptionModal({
  definition,
  claimedSlot,
  players,
  previewId,
  onPreviewChange,
  onConfirm,
  onRename,
  onClose,
}: {
  definition: GameDefinition;
  claimedSlot: number;
  players: Player[];
  previewId: string | null;
  onPreviewChange: (id: string | null) => void;
  onConfirm: (stepId: string, optionId: string) => void;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  // Seed the rename input with the current host-side name so the
  // user can edit it as text. Tracks edits locally; "Save" fires
  // the peer message. NOT debounced — explicit Save matches the
  // explicit-action vibe of the rest of the modal.
  const currentName = players[claimedSlot]?.name ?? "";
  const [nameDraft, setNameDraft] = useState(currentName);
  useEffect(() => {
    setNameDraft(currentName);
  }, [currentName]);

  // Keyboard dismissal — Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renameDirty = nameDraft.trim().length > 0 && nameDraft !== currentName;
  const pick = findPlayerPickStep(definition);
  if (!pick) return null;
  // The step's own `label` is the game-vocab noun ("Faction" for
  // Root, "Class" for a hypothetical class-based game). All
  // user-visible swap strings derive from it so this component
  // stays game-agnostic.
  const stepLabel = pick.step.label;
  const visualKey = definition.playerVisualFrom;
  // Build the set of optionIds taken by *other* claimed seats so we
  // can grey them out in the grid (the host would reject them too).
  const takenIds = new Set<string>();
  if (visualKey) {
    players.forEach((p, i) => {
      if (i === claimedSlot) return;
      const m = p.metadata[visualKey];
      if (m && m.type === "selected-option") takenIds.add(m.optionId);
    });
  }

  if (previewId) {
    const option = pick.options.find((o) => o.id === previewId);
    if (!option) {
      onPreviewChange(null);
      return null;
    }
    const adset = (option as unknown as { adsetSteps?: string[] }).adsetSteps;
    const meeple = (
      option as unknown as { assets?: { meepleSvg?: { appPath?: string } } }
    ).assets?.meepleSvg?.appPath;
    const color = option.color ?? "var(--color-border)";
    return (
      <div
        className={styles.swapOverlay}
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm ${stepLabel.toLowerCase()} swap`}
      >
        <div
          className={styles.heroPreview}
          style={{ padding: 20, maxWidth: 480, width: "100%" }}
        >
          <div className={styles.heroPreviewInstruction}>
            <span className={styles.heroPreviewSubtle}>
              Confirm {stepLabel.toLowerCase()} swap
            </span>
            <span className={styles.heroPreviewTitle}>{option.label}</span>
          </div>
          <div
            className={styles.heroPreviewCard}
            style={
              {
                background: `color-mix(in srgb, ${color} 18%, var(--color-surface))`,
                borderColor: color,
              } as React.CSSProperties
            }
          >
            {meeple && (
              <img
                src={meeple}
                alt=""
                aria-hidden
                className={styles.heroPreviewMeeple}
                style={{
                  background: color,
                  WebkitMaskImage: `url(${meeple})`,
                  maskImage: `url(${meeple})`,
                }}
              />
            )}
            {adset && adset.length > 0 && (
              <ol className={styles.heroPreviewSteps}>
                {adset.map((s, i) => (
                  <li key={i}>
                    <span className={styles.heroCardAdsetIndex}>{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className={styles.heroPreviewActions}>
            <button
              type="button"
              onClick={() => onPreviewChange(null)}
              className={styles.heroPreviewSecondary}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => onConfirm(pick.step.id, option.id)}
              className={styles.heroPreviewPrimary}
            >
              Confirm swap
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.swapOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Change ${stepLabel.toLowerCase()}`}
    >
      <div className={styles.swapPanel}>
        <header className={styles.swapHeader}>
          <span className={styles.swapTitle}>
            Change {stepLabel.toLowerCase()}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={styles.swapClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        {/* Rename row — repairs sessions where the old buggy
            SET_PLAYER_OPTION wrote the option label over the
            human's display name. Independent of the option pick:
            Save fires only the rename. */}
        <div className={styles.renameRow}>
          <label className={styles.renameLabel} htmlFor="swap-rename">
            Player name
          </label>
          <input
            id="swap-rename"
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className={styles.renameInput}
            placeholder="Player name"
            autoComplete="off"
          />
          <button
            type="button"
            disabled={!renameDirty}
            onClick={() => {
              onRename(nameDraft.trim());
            }}
            className={styles.renameSave}
          >
            Save
          </button>
        </div>
        <div className={styles.heroCardColumn}>
          {pick.options.map((option) => {
            const blocked = takenIds.has(option.id);
            const adset = (option as unknown as { adsetSteps?: string[] })
              .adsetSteps;
            const meeple = (
              option as unknown as {
                assets?: { meepleSvg?: { appPath?: string } };
              }
            ).assets?.meepleSvg?.appPath;
            return (
              <button
                key={option.id}
                type="button"
                disabled={blocked}
                onClick={() => onPreviewChange(option.id)}
                className={styles.heroCard}
                aria-label={option.label}
                style={
                  {
                    ["--faction-color" as string]:
                      option.color ?? "var(--color-border)",
                  } as React.CSSProperties
                }
              >
                <span className={styles.heroCardLabel}>{option.label}</span>
                {adset && adset.length > 0 && (
                  <ol className={styles.heroCardAdset}>
                    {adset.map((s, i) => (
                      <li key={i}>
                        <span className={styles.heroCardAdsetIndex}>
                          {i + 1}.
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {meeple && (
                  <img
                    src={meeple}
                    alt=""
                    aria-hidden
                    className={styles.heroCardMeeple}
                    style={{
                      background: option.color ?? "var(--color-text)",
                      WebkitMaskImage: `url(${meeple})`,
                      maskImage: `url(${meeple})`,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Pre-game collaborative seating: the host's wizard publishes its
// seating list whenever it changes; this panel lets the companion
// claim a seat (binding their peer identity to it), rename their
// seat so everyone sees the same name, and add/remove seats.
function SetupSeatingPanel({
  seating,
  claimedSlot,
  onClaim,
  onRename,
  onAdd,
  onRemove,
}: {
  seating: Extract<HostToCompanionMessage, { type: "SETUP_SEATING" }>;
  claimedSlot: number | null;
  onClaim: (seatIndex: number) => void;
  onRename: (seatIndex: number, name: string) => void;
  onAdd: (name: string) => void;
  onRemove: (seatIndex: number) => void;
}) {
  const { seats, claimedBy, minPlayers, maxPlayers } = seating;
  const canAdd = seats.length < maxPlayers;
  const canRemove = seats.length > minPlayers;

  return (
    <div className={styles.claimPanel}>
      <span className={styles.claimTitle}>Take a seat</span>
      <ul className={styles.claimList}>
        {seats.map((seat, i) => {
          const claimedByPeer = claimedBy[i];
          const isMine = claimedSlot === i;
          const isTakenByOther = !isMine && claimedByPeer !== null;
          if (isMine) {
            return (
              <li key={i} className={styles.claimRow}>
                <label className={styles.nameField} style={{ flex: 1 }}>
                  <span className={styles.nameFieldLabel}>
                    Seat {i + 1} (you)
                  </span>
                  <input
                    type="text"
                    value={seat.name}
                    onChange={(e) => onRename(i, e.target.value)}
                    className={styles.nameInput}
                    aria-label={`Rename seat ${i + 1}`}
                  />
                </label>
              </li>
            );
          }
          return (
            <li
              key={i}
              className={styles.claimRow}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <button
                type="button"
                onClick={() => onClaim(i)}
                disabled={isTakenByOther}
                style={{ all: "unset", cursor: "pointer", flex: 1 }}
                aria-label={
                  isTakenByOther ? `Seat ${i + 1} taken` : `Claim seat ${i + 1}`
                }
              >
                Seat {i + 1} — {seat.name}
                {isTakenByOther && (
                  <em
                    style={{
                      marginLeft: 8,
                      opacity: 0.7,
                      fontStyle: "italic",
                    }}
                  >
                    (taken)
                  </em>
                )}
              </button>
              {canRemove && !isTakenByOther && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className={styles.changeButton}
                  aria-label={`Remove seat ${i + 1}`}
                >
                  remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canAdd && (
        <button
          type="button"
          onClick={() => onAdd(`Player ${seats.length + 1}`)}
          className={styles.changeButton}
        >
          + Add seat
        </button>
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
