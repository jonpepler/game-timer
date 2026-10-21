"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { useSessionCompanion } from "@/hooks/useSessionCompanion";
import { describePeerError } from "@/lib/peerTransport";
import { CodeEntryPanel } from "./CodeEntryPanel";
import { selectPrediction } from "@/state/prediction";
import {
  PEER_PROTOCOL_VERSION,
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { ScorePanel } from "@/components/ScorePanel";
import { TurnOrderPanel } from "@/components/TurnOrderPanel";
import { PeerNotice } from "@/components/PeerNotice";
import { PlayersSheet } from "@/components/PlayersSheet";
import { SeatList } from "@/components/SeatList";
import { CommitTextInput } from "@/components/CommitTextInput";
import { MAX_SEAT_NAME } from "@/state/seating";
import { PhaseBar } from "@/components/timer/PhaseBar";
import { useTurnEntryControls } from "@/hooks/useTurnEntryControls";
import { authorizeCommand, type SessionCommand } from "@/state/sessionCommands";
import { Pause, Play, Undo2 } from "lucide-react";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { VictoryBanner } from "@/components/VictoryBanner";
import { PlayerMeeple } from "@/components/PlayerMeeple";
import { EventDialog } from "@/components/EventDialog";
import { FullScreen } from "@/components/FullScreen";
import { SchemeToggle } from "@/components/SchemeToggle";
import { useColourScheme, useGameTheme } from "@/hooks/useGameTheme";
import { getPlayerStats } from "@/utils/getPlayerStats";
import {
  createInitialGameSessionState,
  selectAvailableControls,
  selectCurrentPlayerIndex,
  selectTurnOrder,
  selectTurnPhases,
  selectUntimedTurnLabel,
} from "@/state/gameSession";
import {
  playerColor,
  playerHeadIcon,
  playerIcon,
  playerSubheading,
} from "@/lib/playerVisual";
import { TurnActions } from "@/components/TurnActions";
import { TurnEntryBanner } from "@/components/identity/EntryBanner";
import { createLogger } from "@/lib/logger";
import type {
  GameDefinition,
  SetupConstraint,
  SetupOption,
  SetupStep,
} from "@/state/gameDefinition";
import type { Player } from "@/state/gameSession";
import {
  Button,
  Disc,
  Field,
  IconButton,
  ListRow,
  SectionLabel,
  Sheet,
  Stepper,
  VisuallyHidden,
} from "@/components/ui";

const stateLog = createLogger("companion-state");

// Stands in for the host's state before the first STATE arrives, so the
// turn-entry hook can run unconditionally.
const NO_STATE = createInitialGameSessionState({
  initialAverageSeconds: 0,
  expectedTurns: 0,
});
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

  const { status, lastMessage, error, send, reconnect, peerId } =
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
  // optimistically blanking the picker, and lets us resend if the
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
  // changes (name/metadata): turn ticks shouldn't spam.
  const lastPlayersSigRef = useRef<string>("");
  // The host and this page disagree on the protocol: nothing sent or
  // received can be trusted until both are reloaded.
  const [versionMismatch, setVersionMismatch] = useState(false);
  // Why the host refused this page's last command, shown until dismissed.
  const [refusal, setRefusal] = useState<string | null>(null);
  // Commands awaiting the host's COMMAND_RESULT, by id.
  const sentCommandsRef = useRef(new Map<string, SessionCommand>());
  // A refusal is news, not a state: it clears itself so it never sits
  // over the turn controls.
  useEffect(() => {
    if (refusal === null) return;
    const id = window.setTimeout(() => setRefusal(null), 6000);
    return () => window.clearTimeout(id);
  }, [refusal]);
  // Read by the message effect without making it re-run on connect.
  const peerIdRef = useRef(peerId);
  peerIdRef.current = peerId;
  // Optimistic lock: when the user taps End my turn, we disable
  // the button immediately and don't re-enable until the host's
  // STATE confirms we're no longer the active player (or refuses).
  const [endingTurn, setEndingTurn] = useState(false);
  // The state revision the last Undo tap cited, while it is in flight.
  const [undoSentAt, setUndoSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.protocolVersion !== PEER_PROTOCOL_VERSION) {
      stateLog.warn("host speaks another protocol version", {
        version: lastMessage.protocolVersion,
      });
      setVersionMismatch(true);
      return;
    }
    if (lastMessage.type === "PROTOCOL_MISMATCH") {
      if (lastMessage.peerId === peerIdRef.current) setVersionMismatch(true);
      return;
    }
    if (lastMessage.type === "COMMAND_RESULT") {
      const command = sentCommandsRef.current.get(lastMessage.commandId);
      if (!command) return;
      sentCommandsRef.current.delete(lastMessage.commandId);
      if (!lastMessage.ok) {
        setRefusal(lastMessage.reason ?? "The host did not apply that");
        if (command.type === "END_TURN") setEndingTurn(false);
        if (command.type === "UNDO") setUndoSentAt(null);
      }
      return;
    }
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
      // Roster snapshot: fires when the players[] identity changes
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
          // Host is still on the seat we picked for: our SETUP_PICK
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
          // Host advanced to a different seat/step: our pick landed.
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
    else if (lastMessage.type === "SETUP_SEATING_CLOSED") {
      setPendingSeating(null);
      seatConfirmedRef.current = false;
    }
  }, [lastMessage, send]);

  // First-sync safety net. The host pushes STATE the moment we connect,
  // but that push is best-effort: the WebRTC data channel carrying it
  // may not be open yet at that instant, so the snapshot is dropped,
  // and once the game has started the host has no STATE heartbeat to
  // recover it, leaving us stuck on "connecting" with no claim UI. So
  // once connected we pull the snapshot ourselves, retrying on a short
  // cadence until one actually arrives. Stops on the first STATE; resets
  // per (re)connection so a dropped re-sync after a reconnect also heals.
  //
  // Escalation: relay presence can be live (we received the host's role
  // announce → status "connected") while the data channel is actually
  // dead in the host→companion direction: our REQUEST_STATEs reach the
  // host and it re-broadcasts, but nothing comes back. Pulling forever
  // can't fix a dead channel, so after a few unanswered attempts we
  // force a transport reconnect, which tears the peer connection down
  // and re-pairs with a fresh channel. Counted per connection.
  const ATTEMPTS_BEFORE_RECONNECT = 4;
  const stateSeenRef = useRef(false);
  useEffect(() => {
    if (lastState) stateSeenRef.current = true;
  }, [lastState]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastState is a deliberate re-run trigger, when STATE finally arrives the effect re-evaluates, sees stateSeenRef set, and clears the pull interval at once rather than on its next tick.
  useEffect(() => {
    if (status !== "connected") {
      // A fresh (re)connection must re-establish state from scratch.
      stateSeenRef.current = false;
      return;
    }
    if (stateSeenRef.current) return;
    let attempts = 0;
    const requestState = () =>
      send({ type: "REQUEST_STATE", protocolVersion: PEER_PROTOCOL_VERSION });
    requestState(); // ask immediately on connect
    const id = window.setInterval(() => {
      if (stateSeenRef.current) {
        window.clearInterval(id);
        return;
      }
      attempts += 1;
      if (attempts % ATTEMPTS_BEFORE_RECONNECT === 0) {
        // Pulls are going unanswered: the channel is likely dead.
        // Rebuild it; the fresh connection's onConnect re-pushes STATE
        // and our pulls resume against a live channel.
        stateLog.warn("no STATE after repeated requests: forcing reconnect", {
          attempts,
        });
        reconnect();
        return;
      }
      requestState();
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [status, lastState, send, reconnect]);

  const state = lastState?.state ?? null;
  const definition = pendingTurn?.definition ?? lastState?.definition;

  // Have we received anything usable from the host yet: a game snapshot,
  // a seating list, or a setup turn? Until we have, there's nothing to
  // show regardless of what the raw transport status says.
  const hasSynced =
    Boolean(state) || Boolean(pendingSeating) || Boolean(pendingTurn);

  // Display status, distinct from the raw transport status. The first
  // sync can churn under the hood: relay presence lands ("connected")
  // before any data arrives, and a dead-channel recovery briefly flips
  // back to "reconnecting", but to the user that's all still one
  // "getting set up" phase. So until we've synced, we always present
  // "connecting" (one steady state, no green→grey→green flicker). Once
  // synced, we report the real status honestly, so a genuine mid-game
  // drop still surfaces as "reconnecting".
  const displayStatus: typeof status = hasSynced
    ? status
    : status === "error" || status === "disconnected"
      ? status
      : "connecting";

  // After a while still unsynced, surface a gentle hint. We never give
  // up (the pull + reconnect keep running in the background), but a
  // first sync that drags past ~12s usually means the host isn't
  // sharing, so we nudge the user rather than leave them watching a
  // silent "Setting up…". Clears the moment we sync.
  const [slowToSync, setSlowToSync] = useState(false);
  useEffect(() => {
    if (hasSynced || displayStatus !== "connecting") {
      setSlowToSync(false);
      return;
    }
    const id = window.setTimeout(() => setSlowToSync(true), 12_000);
    return () => window.clearTimeout(id);
  }, [hasSynced, displayStatus]);

  const [claimedSlot, setClaimedSlot] = useState<number | null>(null);
  // When true, the player-option swap modal is open. Lets the
  // claimant pick a new option from the definition's player-pick
  // step without re-running setup.
  const [changingPlayerOption, setChangingPlayerOption] = useState(false);
  // The players sheet: rename anyone at the table mid-game, as the host can.
  const [renamingPlayers, setRenamingPlayers] = useState(false);
  // Two-step preview inside the swap modal, same pattern as the
  // wizard's PlayerPickScreen. Tap card → confirm screen → Confirm.
  const [changePreviewId, setChangePreviewId] = useState<string | null>(null);

  // Companion-chosen display name, persisted per (code, slot) in
  // localStorage so it survives refreshes, and, crucially, across the
  // host starting a *new* game (which resets seat names to "Player N").
  // It's the companion's local source of truth and is propagated to the
  // host (see the sync effect below) so the shared main screen shows
  // the same name rather than a stale "Player 1".
  const [customName, setCustomName] = useState<string>("");
  // Distinguishes an active edit (a submitted "Your name") from a
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
      // localStorage unavailable: name simply won't persist.
    }
  };

  // Propagate the companion's name to the host so the main screen shows
  // it too, not just this device. Two triggers:
  //   • active edit ("Your name", once submitted) → push, overriding
  //     whatever the host currently has for our seat;
  //   • (re)claiming a seat whose host-side name is still a default
  //     "Player N" → fill in our remembered name. This is the new-game
  //     case: the host resets seat names, but we still remember "Jon".
  // A non-default host name we didn't just edit is left alone, so a
  // name the host deliberately set isn't clobbered. Sent as a rename
  // command against the setup seat list while it is open, else the game.
  useEffect(() => {
    const name = customName.trim();
    const activeEdit = customNameEditedRef.current;
    customNameEditedRef.current = false;
    if (!name || claimedSlot === null) return;
    const isDefaultName = (n: string | undefined) =>
      n === undefined || /^Player \d+$/.test(n);
    const seat = pendingSeating
      ? pendingSeating.seats[claimedSlot]
      : state?.players?.[claimedSlot];
    if (!seat || seat.name === name) return;
    if (!activeEdit && !isDefaultName(seat.name)) return;
    // During setup, wait until the host has given us the seat.
    if (pendingSeating && pendingSeating.claimedBy[claimedSlot] !== peerId)
      return;
    sendCommandRef.current({
      type: "RENAME_PLAYER",
      playerIndex: claimedSlot,
      ...(pendingSeating
        ? { seatId: pendingSeating.seats[claimedSlot].id }
        : {}),
      name,
    });
  }, [customName, claimedSlot, state, pendingSeating, peerId]);

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
      // localStorage unavailable: claim simply won't persist.
    }
  }, [code]);

  const rememberClaim = (slot: number | null) => {
    setClaimedSlot(slot);
    if (!code) return;
    try {
      if (slot === null) window.localStorage.removeItem(claimStorageKey(code));
      else window.localStorage.setItem(claimStorageKey(code), String(slot));
    } catch {
      // Persistence is best-effort.
    }
  };
  const sendClaim = (playerIndex: number) =>
    send({
      type: "CLAIM",
      protocolVersion: PEER_PROTOCOL_VERSION,
      playerIndex,
    } satisfies CompanionToHostMessage);

  // Re-announce a remembered seat on every (re)connection. Only here
  // and on a tap: re-sending on every local change would race the
  // host's own claim bookkeeping when seats move.
  const claimedSlotRef = useRef(claimedSlot);
  claimedSlotRef.current = claimedSlot;
  // Whether the host's seat list has shown this phone on a seat since
  // it connected. Losing the seat after that means it was removed or
  // released; before it, the remembered seat is still being asked for.
  const seatConfirmedRef = useRef(false);
  useEffect(() => {
    if (status !== "connected") return;
    seatConfirmedRef.current = false;
    const slot = claimedSlotRef.current;
    if (slot !== null)
      send({
        type: "CLAIM",
        protocolVersion: PEER_PROTOCOL_VERSION,
        playerIndex: slot,
      } satisfies CompanionToHostMessage);
  }, [status, send]);

  /**
   * During setup the host's seat list is the truth about which seat is
   * ours: the claim follows its seat through reorders on any screen,
   * and a removed seat takes the claim with it. A remembered seat the
   * host has not confirmed yet is asked for again while it is free.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: rememberClaim and sendClaim only close over stable values
  useEffect(() => {
    if (!pendingSeating || !peerId) return;
    const mineAt = pendingSeating.claimedBy.indexOf(peerId);
    if (mineAt !== -1) {
      seatConfirmedRef.current = true;
      if (mineAt !== claimedSlot) rememberClaim(mineAt);
      return;
    }
    if (claimedSlot === null) return;
    if (seatConfirmedRef.current) {
      seatConfirmedRef.current = false;
      rememberClaim(null);
      return;
    }
    if (
      claimedSlot < pendingSeating.seats.length &&
      pendingSeating.claimedBy[claimedSlot] === null
    )
      sendClaim(claimedSlot);
    else rememberClaim(null);
  }, [pendingSeating, peerId, claimedSlot]);

  // While setup is seating players the host confirms the claim through
  // its seat list; mid-game the claim shows at once.
  const claim = (playerIndex: number) => {
    if (!pendingSeating) rememberClaim(playerIndex);
    sendClaim(playerIndex);
  };

  const release = () => {
    rememberClaim(null);
    seatConfirmedRef.current = false;
    send({
      type: "RELEASE",
      protocolVersion: PEER_PROTOCOL_VERSION,
    } satisfies CompanionToHostMessage);
  };

  /**
   * Send a game action to the host, which checks it against this page's
   * claimed seat and answers with COMMAND_RESULT. The same commands the
   * host's own UI runs.
   */
  const commandSeqRef = useRef(0);
  const sendCommand = (command: SessionCommand) => {
    if (versionMismatch) return;
    commandSeqRef.current += 1;
    const commandId = `${peerId ?? "companion"}:${commandSeqRef.current}`;
    sentCommandsRef.current.set(commandId, command);
    if (command.type === "END_TURN") setEndingTurn(true);
    send({
      type: "COMMAND",
      protocolVersion: PEER_PROTOCOL_VERSION,
      commandId,
      command,
    } satisfies CompanionToHostMessage);
  };
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;

  const bumpScore = (delta: number) => {
    if (claimedSlot === null) return;
    sendCommand({ type: "INCREMENT_SCORE", playerIndex: claimedSlot, delta });
  };

  const triggerControl = (controlId: string) =>
    sendCommand({ type: "TRIGGER_CONTROL", controlId });

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
    // arrives: see the message effect above. This is what makes a
    // dropped pick recover gracefully instead of leaving the player
    // staring at an empty screen.
    submittedPickRef.current = {
      stepId: pendingTurn.stepId,
      seatIndex: claimedSlot,
      optionId,
    };
    setSubmitting(true);
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

  // Escape-hatch player-option swap: lets a player whose seat is
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

  const stats = useMemo(
    () =>
      state
        ? getPlayerStats(
            state.turns
              .filter((t) => t.playerIndex !== null)
              .map((t) => ({
                playerIndex: t.playerIndex as number,
                elapsedSeconds: t.elapsedSeconds,
                untimed: t.untimed,
              })),
          )
        : [],
    [state],
  );

  const visualKey = definition?.playerVisualFrom;
  const colorKey = definition?.playerColorFrom ?? visualKey;
  // The phone takes the look of the host's game.
  useGameTheme(definition?.id);
  const scheme = useColourScheme();
  const subheadingKey = definition?.playerSubheadingFrom;
  const activePlayerIndex = state ? selectCurrentPlayerIndex(state) : null;
  // Variable turn order travels inside STATE; a seated companion edits
  // it (reorders included) through the same commands as the host.
  const turnOrderView = state ? selectTurnOrder(state) : null;
  const playerViews =
    state?.players?.map((p, i) => ({
      name: p.name,
      color: playerColor(p, i, colorKey, scheme),
      headIconSrc: playerHeadIcon(p, visualKey),
      iconSrc: playerIcon(p, visualKey),
    })) ?? [];
  // A labelled turn entry heads the banner with its own name and colour,
  // its owner as the subheading, as on the host.
  const activeEntry = turnOrderView?.entries.find(
    (e) => e.id === turnOrderView.activeId,
  );
  const ownerView =
    activePlayerIndex !== null ? playerViews[activePlayerIndex] : undefined;
  const activeSubheading =
    activeEntry?.label !== undefined
      ? ownerView?.name
      : state?.players && activePlayerIndex !== null
        ? playerSubheading(state.players[activePlayerIndex], subheadingKey)
        : undefined;
  const activePlayer =
    activeEntry?.label !== undefined
      ? {
          name: activeEntry.label,
          color: activeEntry.color ?? ownerView?.color ?? "var(--color-text)",
          iconSrc: undefined,
          headIconSrc: undefined,
        }
      : ownerView;
  const victorPlayer =
    state?.victor !== undefined && state?.victor !== null
      ? playerViews[state.victor]
      : undefined;
  const prediction = state ? selectPrediction(state) : null;
  const remaining = Math.max(0, prediction?.turns ?? 0);
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
  // The host's own rule decides, so a shared turn no seat owns can be
  // ended from any seated phone.
  const canEndTurn =
    !!state &&
    claimedSlot !== null &&
    !victorPlayer &&
    authorizeCommand(
      state,
      { type: "END_TURN" },
      { kind: "seat", seatIndex: claimedSlot },
    ).ok;
  // A running game with no players has no seats to claim, so this
  // screen speaks for the table without one, as the host allows.
  const seatless =
    !!state?.started && playerViews.length === 0 && !pendingSeating;
  const actsForTable =
    (claimedSlot !== null || seatless) && !victorPlayer && !versionMismatch;
  const revision = state?.revision ?? 0;
  // A sent undo locks the button until the host's state moves on (or it
  // refuses), so a double tap cannot read as a second undo.
  const canUndo =
    actsForTable && lastState?.canUndo === true && undoSentAt !== revision;
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is a deliberate re-run trigger, any change of the host's state ends the lock
  useEffect(() => {
    setUndoSentAt(null);
  }, [revision]);
  const undo = () => {
    setUndoSentAt(revision);
    sendCommand({ type: "UNDO", atRevision: revision });
  };
  // Absent from a host that does not share its clock.
  const hostPaused = lastState?.paused;
  const untimedTurn = state ? selectUntimedTurnLabel(state) !== null : false;
  const canPause = actsForTable && !!state?.started && !untimedTurn;
  const setPaused = (paused: boolean) =>
    sendCommand({ type: "SET_PAUSED", paused });
  const setTurnsLeft = (left: number) => {
    if (!state) return;
    sendCommand({
      type: "SET_EXPECTED_TURNS",
      expectedTurns: state.turns.length + left,
    });
  };
  // Controls available to this companion's seat right now. The host
  // re-validates every trigger.
  const availableControlIds =
    state && claimedSlot !== null && !victorPlayer
      ? selectAvailableControls(state, claimedSlot).map((c) => c.id)
      : [];
  // Lift the End-my-turn optimistic lock once the host has
  // rotated us off the active seat.
  // An owner of several entries can be up twice in a row, so a new
  // acting entry or a new recorded turn also lifts the lock.
  const turnsRecorded = state?.turns.length ?? 0;
  const actingEntryId = turnOrderView?.activeId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: isMyTurn, turnsRecorded and actingEntryId are deliberate re-run triggers
  useEffect(() => {
    setEndingTurn(false);
  }, [isMyTurn, turnsRecorded, actingEntryId]);

  // The host's turn-entry UI: the turn order with its actions, the value
  // question, the end-of-phase prompts and the combine sheet. A screen
  // without a seat only watches.
  const canAct = claimedSlot !== null && !victorPlayer && !versionMismatch;
  const entryControls = useTurnEntryControls({
    state: state ?? NO_STATE,
    players: playerViews,
    run: sendCommand,
    disabled: !canAct,
  });
  const turnPhases = state ? selectTurnPhases(state) : null;
  const currentPhaseLabel =
    turnPhases?.phases.find((p) => p.id === turnPhases.activeId)?.label ?? "";
  // The host's first tap starts the clock rather than ending a turn, so
  // a phone offers End turn only once the clock has started; an END_TURN
  // sent before then would double as the start.
  const gameStarted = !!state?.started;
  const myScore =
    claimedSlot !== null && state
      ? (state.scores[claimedSlot] ?? state.scoreConfig?.min ?? 0)
      : 0;
  const scoreMin = state?.scoreConfig?.min ?? 0;
  const scoreMax = state?.scoreConfig?.max;
  const scoreStep = state?.scoreConfig?.increment ?? 1;
  const atMin = myScore <= scoreMin;
  const atMax = scoreMax !== undefined ? myScore >= scoreMax : false;

  // Undo and the clock, as on the host's footer, beside the turn button.
  const clockControls = (
    <>
      <IconButton
        label="Undo"
        tooltip="Undo the last action"
        tooltipPlacement="top"
        tooltipAlign="start"
        size="lg"
        onClick={undo}
        disabled={!canUndo}
      >
        <Undo2 aria-hidden />
      </IconButton>
      {hostPaused !== undefined && (
        <IconButton
          label={hostPaused ? "Resume timer" : "Pause timer"}
          tooltip={untimedTurn ? "This turn is untimed" : undefined}
          tooltipPlacement="top"
          size="lg"
          onClick={() => setPaused(!hostPaused)}
          disabled={!canPause}
        >
          {hostPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </IconButton>
      )}
    </>
  );

  if (!code) {
    return (
      <div className={styles.container}>
        <CodeEntryPanel />
      </div>
    );
  }

  return (
    <FullScreen menuExtras={<SchemeToggle />}>
      <div className={styles.container}>
        <div className={styles.header}>
          <span
            className={`${styles.statusDot} ${
              displayStatus === "connecting" || displayStatus === "reconnecting"
                ? styles.statusDotConnecting
                : displayStatus === "connected"
                  ? styles.statusDotConnected
                  : displayStatus === "disconnected"
                    ? styles.statusDotDisconnected
                    : styles.statusDotError
            }`}
            aria-hidden
          />
          <span>
            {displayStatus === "connecting" && (
              <>
                Connecting to <span className={styles.hostCode}>{code}</span>…
              </>
            )}
            {displayStatus === "connected" && (
              <>
                Connected to <span className={styles.hostCode}>{code}</span>
              </>
            )}
            {displayStatus === "reconnecting" && (
              <>
                Reconnecting to <span className={styles.hostCode}>{code}</span>…
              </>
            )}
            {displayStatus === "disconnected" && (
              <>
                Disconnected from{" "}
                <span className={styles.hostCode}>{code}</span>
              </>
            )}
            {displayStatus === "error" && <>{describePeerError(error)}</>}
          </span>
          {claimedPlayer && (
            <span className={styles.claimedAs}>
              {/* Silhouette (body meeple) rather than the head crest:
                  an option with dealt characters may share one generic
                  crest across all of them, so the distinguishing art
                  is the per-character body meeple. Matches the host
                  timer's active-player banner. */}
              <PlayerMeeple
                iconSrc={claimedPlayer.iconSrc}
                color={claimedPlayer.color}
                headClassName={styles.claimHead}
                silhouetteClassName={styles.claimMeeple}
                fallback={<Disc color={claimedPlayer.color} />}
              />
              {claimedPlayer.name}
              <Button variant="ghost" size="sm" onClick={release}>
                Change seat
              </Button>
              {canAct && !pendingSeating && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRenamingPlayers(true)}
                >
                  Rename players
                </Button>
              )}
              {/* Only show the swap link when the active definition
                  actually has a player-pick step (Generic doesn't,
                  so the swap would be a no-op). The button label
                  pulls from the step's own label so the wording
                  matches the game's vocabulary, no game-specific
                  noun in app code. */}
              {definition &&
                (() => {
                  const pickInfo = findPlayerPickStep(definition);
                  if (!pickInfo) return null;
                  return (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setChangePreviewId(null);
                        setChangingPlayerOption(true);
                      }}
                    >
                      Change {pickInfo.step.label.toLowerCase()}
                    </Button>
                  );
                })()}
            </span>
          )}
        </div>

        {claimedPlayer && (
          <label className={styles.nameField} htmlFor="your-name">
            <SectionLabel as="span">Your name</SectionLabel>
            <CommitTextInput
              id="your-name"
              value={customName}
              onCommit={saveCustomName}
              maxLength={MAX_SEAT_NAME}
              autoComplete="off"
              placeholder={
                claimedSlot !== null
                  ? (playerViews[claimedSlot]?.name ?? "Your name")
                  : "Your name"
              }
              framed
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

        {!pendingTurn && pendingSeating && (
          <SetupSeatingPanel
            seating={pendingSeating}
            mySeat={peerId ? pendingSeating.claimedBy.indexOf(peerId) : -1}
            onClaim={claim}
            run={sendCommand}
          />
        )}

        {/* Pre-sync placeholder. Shown for the whole "getting set up"
            window: through relay pairing, the STATE pull, and any
            dead-channel recovery, so the body doesn't blank out while
            the connection heals. displayStatus is "connecting" exactly
            until the first snapshot arrives (see its derivation). */}
        {displayStatus === "connecting" && (
          <div className={styles.empty}>
            {slowToSync
              ? "Still connecting… check the host still has this session open. Keep this page open (it'll connect on its own) or refresh to retry."
              : "Setting up your connection…"}
          </div>
        )}

        {state && (
          <>
            {victorPlayer ? (
              <VictoryBanner victor={victorPlayer} />
            ) : activeEntry?.label !== undefined && turnOrderView ? (
              <div className={styles.activePlayer}>
                <TurnEntryBanner
                  entry={activeEntry}
                  prominentKinds={turnOrderView.prominentKinds}
                  fallbackColor={ownerView?.color ?? "var(--color-text)"}
                  subheading={activeSubheading}
                />
              </div>
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
                    fallback={<Disc color={activePlayer.color} size="lg" />}
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
              {actsForTable && !prediction?.modelled ? (
                <Stepper
                  value={
                    <span className={styles.bigStatValue}>{remaining}</span>
                  }
                  valueLabel="Turns remaining"
                  onDecrement={() => setTurnsLeft(remaining - 1)}
                  onIncrement={() => setTurnsLeft(remaining + 1)}
                  canDecrement={remaining > 0}
                  decrementLabel="One turn fewer"
                  incrementLabel="One turn more"
                />
              ) : (
                <span className={styles.bigStatValue}>
                  {prediction?.remaining?.count ?? remaining}
                </span>
              )}
              <SectionLabel as="span">
                {prediction?.remaining?.label ??
                  (prediction?.modelled
                    ? "Turns remaining, roughly"
                    : "Turns remaining")}
              </SectionLabel>
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
                    <div className={styles.turnRow}>
                      {clockControls}
                      <Button variant="primary" fullWidth onClick={tapTimer}>
                        Next turn
                      </Button>
                    </div>
                  </div>
                </>
              )}

            {playerViews.length > 0 &&
              claimedSlot === null &&
              !pendingSeating && (
                <div className={styles.claimPanel}>
                  <SectionLabel as="span">Claim a player</SectionLabel>
                  <ul className={styles.claimList}>
                    {playerViews.map((p, i) => (
                      <li key={i}>
                        <ListRow
                          color={p.color}
                          lead={<Disc color={p.color} />}
                          label={p.name}
                          onClick={() => claim(i)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {/* No mid-game option picker: picks happen during the host's wizard via the SETUP_TURN /
              SetupTurnPanel flow, not after the game has started. */}

            {claimedPlayer && state.scoreConfig && (
              <Stepper
                size="wide"
                className={styles.scoreControls}
                value={
                  <span className={styles.scoreBlock}>
                    <SectionLabel as="span">My score</SectionLabel>
                    <span>{myScore}</span>
                  </span>
                }
                onDecrement={() => bumpScore(-scoreStep)}
                onIncrement={() => bumpScore(scoreStep)}
                canDecrement={!atMin}
                canIncrement={!atMax}
                decrementLabel="Decrease my score"
                incrementLabel="Increase my score"
              />
            )}

            <div className={styles.bottomStack}>
              {turnPhases && turnPhases.phases.length > 1 && (
                <PhaseBar
                  phaseLabel={currentPhaseLabel}
                  onEnd={canAct ? entryControls.endPhase : undefined}
                />
              )}
              {entryControls.turnOrderPanel && playerViews.length > 0 && (
                <TurnOrderPanel
                  players={playerViews}
                  turnOrder={entryControls.turnOrderPanel}
                  scores={state.scores}
                  scoreConfig={scoresVisible ? state.scoreConfig : undefined}
                  readOnly={!canAct}
                />
              )}
              {(scoresVisible || entryControls.turnOrderPanel?.chart) &&
                playerViews.length > 0 && (
                  <ScorePanel
                    players={playerViews}
                    scores={state.scores}
                    scoreConfig={state.scoreConfig}
                    readOnly={!canAct}
                    firedMilestones={state.firedMilestones}
                    chart={entryControls.turnOrderPanel?.chart}
                    catchUp={!entryControls.turnOrderPanel}
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
                <TurnActions
                  controls={state.controls ?? []}
                  availableIds={availableControlIds}
                  onTrigger={triggerControl}
                />
                <div className={styles.turnRow}>
                  {clockControls}
                  {gameStarted ? (
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={entryControls.advance}
                      disabled={!canEndTurn || endingTurn}
                    >
                      {!canEndTurn
                        ? "Waiting for your turn…"
                        : activeEntry?.label !== undefined
                          ? `End ${activeEntry.label}’s turn`
                          : isMyTurn
                            ? "End my turn"
                            : "End turn"}
                    </Button>
                  ) : (
                    <div className={styles.endTurnPending}>
                      Waiting for the host to start the timer…
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {state && entryControls.overlays}
      {versionMismatch ? (
        <PeerNotice
          tone="alert"
          message="This phone and the host are running different versions of Game Timer. Reload both pages to keep playing."
          onDismiss={() => setVersionMismatch(false)}
        />
      ) : (
        refusal && (
          <PeerNotice
            tone="status"
            message={`Not applied: ${refusal}`}
            onDismiss={() => setRefusal(null)}
          />
        )
      )}
      {renamingPlayers && canAct && !pendingSeating && state?.players && (
        <PlayersSheet
          players={state.players}
          onRename={(playerIndex, name) =>
            sendCommand({ type: "RENAME_PLAYER", playerIndex, name })
          }
          canEdit={(playerIndex) => playerIndex === claimedSlot}
          onClose={() => setRenamingPlayers(false)}
        />
      )}
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
          onRename={(name) => {
            if (name && claimedSlot !== null)
              sendCommand({
                type: "RENAME_PLAYER",
                playerIndex: claimedSlot,
                name,
              });
          }}
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

  // Two-step pick: mirrors the host's PlayerPickScreen. Tap a card
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
  // picker, if the pick was dropped the host's heartbeat re-arrives
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
    const previewSteps = previewOption?.setupInstructions ?? [];
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
          <SectionLabel as="span">Your turn — confirm your pick</SectionLabel>
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
          {previewSteps.length > 0 && (
            <ol className={styles.heroPreviewSteps}>
              {previewSteps.map((s, i) => (
                <li key={i}>
                  <span className={styles.heroCardStepsIndex}>{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className={styles.heroPreviewActions}>
          <Button fullWidth onClick={() => setPreviewCardId(null)}>
            Back
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={() => {
              onPick(previewCardId);
              setPreviewCardId(null);
            }}
          >
            Confirm setup
          </Button>
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
        Your turn: choose a {pickLabel}
      </div>
      <div className={styles.heroCardColumn}>
        {visible.map((option) => {
          const isBlocked = excluded.has(option.id);
          const setupSteps = option.setupInstructions ?? [];
          const meepleSrc = (
            option as unknown as {
              assets?: { meepleSvg?: { appPath?: string } };
            }
          ).assets?.meepleSvg?.appPath;
          return (
            <ListRow
              key={option.id}
              disabled={isBlocked}
              onClick={() => setPreviewCardId(option.id)}
              // The name is the option label, not every setup step.
              aria-label={option.label}
              color={option.color}
              lead={
                meepleSrc && (
                  <img
                    src={meepleSrc}
                    alt=""
                    aria-hidden
                    className={styles.optionMeeple}
                    style={{
                      background: option.color ?? "var(--color-text)",
                      WebkitMaskImage: `url(${meepleSrc})`,
                      maskImage: `url(${meepleSrc})`,
                    }}
                  />
                )
              }
              label={option.label}
              hint={setupSteps.length > 0 && <OptionSteps steps={setupSteps} />}
            />
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
// Escape-hatch player-option swap modal: fullscreen, mirrors the
// wizard's PlayerPickScreen UX (tap card → preview → Confirm).
// Excludes options already claimed by other seats so the
// SET_PLAYER_OPTION peer message doesn't get rejected on the host.
// The host's mutex constraints still apply server-side: we only
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
  // the peer message. NOT debounced: explicit Save matches the
  // explicit-action vibe of the rest of the modal.
  const currentName = players[claimedSlot]?.name ?? "";
  const [nameDraft, setNameDraft] = useState(currentName);
  useEffect(() => {
    setNameDraft(currentName);
  }, [currentName]);

  // Keyboard dismissal: Escape closes the modal.
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
  // The step's own `label` is the game-vocab noun (e.g. "Class" for a
  // class-based game). All
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
    const setupSteps = option.setupInstructions ?? [];
    const meeple = (
      option as unknown as { assets?: { meepleSvg?: { appPath?: string } } }
    ).assets?.meepleSvg?.appPath;
    const color = option.color ?? "var(--color-border)";
    return (
      <Sheet
        title={option.label}
        subtitle={`Confirm ${stepLabel.toLowerCase()} swap`}
        onDismiss={() => onPreviewChange(null)}
        actions={
          <>
            <Button onClick={() => onPreviewChange(null)}>Back</Button>
            <Button
              variant="primary"
              onClick={() => onConfirm(pick.step.id, option.id)}
            >
              Confirm swap
            </Button>
          </>
        }
      >
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
          {setupSteps.length > 0 && (
            <ol className={styles.heroPreviewSteps}>
              {setupSteps.map((s, i) => (
                <li key={i}>
                  <span className={styles.heroCardStepsIndex}>{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={`Change ${stepLabel.toLowerCase()}`}
      onDismiss={onClose}
      width="wide"
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {/* Rename row: repairs sessions where the old buggy
            SET_PLAYER_OPTION wrote the option label over the
            human's display name. Independent of the option pick:
            Save fires only the rename. */}
      <div className={styles.renameRow}>
        <VisuallyHidden as="label" htmlFor="swap-rename">
          Player name
        </VisuallyHidden>
        <Field
          id="swap-rename"
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="Player name"
          autoComplete="off"
        />
        <Button
          variant="primary"
          disabled={!renameDirty}
          onClick={() => onRename(nameDraft.trim())}
        >
          Save
        </Button>
      </div>
      <div className={styles.heroCardColumn}>
        {pick.options.map((option) => {
          const blocked = takenIds.has(option.id);
          const setupSteps = option.setupInstructions ?? [];
          const meeple = (
            option as unknown as {
              assets?: { meepleSvg?: { appPath?: string } };
            }
          ).assets?.meepleSvg?.appPath;
          return (
            <ListRow
              key={option.id}
              disabled={blocked}
              onClick={() => onPreviewChange(option.id)}
              aria-label={option.label}
              color={option.color}
              lead={
                meeple && (
                  <img
                    src={meeple}
                    alt=""
                    aria-hidden
                    className={styles.optionMeeple}
                    style={{
                      background: option.color ?? "var(--color-text)",
                      WebkitMaskImage: `url(${meeple})`,
                      maskImage: `url(${meeple})`,
                    }}
                  />
                )
              }
              label={option.label}
              hint={setupSteps.length > 0 && <OptionSteps steps={setupSteps} />}
            />
          );
        })}
      </div>
    </Sheet>
  );
}

/**
 * The setup seat list, as the host's wizard shows it. A phone that has
 * taken a seat arranges the list like the host does (order, adding and
 * removing) but names and colours only its own seat; one without a seat
 * can only take one.
 */
function SetupSeatingPanel({
  seating,
  mySeat,
  onClaim,
  run,
}: {
  seating: Extract<HostToCompanionMessage, { type: "SETUP_SEATING" }>;
  // Index of this phone's seat, or -1.
  mySeat: number;
  onClaim: (seatIndex: number) => void;
  run: (command: SessionCommand) => void;
}) {
  const { seats, claimedBy, minPlayers, maxPlayers, colorOptions } = seating;
  const seated = mySeat !== -1;
  const heldByOther = (i: number) => claimedBy[i] !== null && i !== mySeat;
  const ref = (i: number) => ({ playerIndex: i, seatId: seats[i].id });
  const edits = seated
    ? {
        onRename: (i: number, name: string) =>
          run({ type: "RENAME_PLAYER", ...ref(i), name }),
        onMove: (from: number, to: number) =>
          run({ type: "REORDER_SEATS", ...ref(from), toIndex: to }),
        onRemove: (i: number) => run({ type: "REMOVE_SEAT", ...ref(i) }),
        canRemove: (i: number) => !heldByOther(i),
        onAdd: () => run({ type: "ADD_SEAT" }),
        onColor: (i: number, colorId: string) =>
          run({ type: "SET_SEAT_COLOR", ...ref(i), colorId }),
        canEdit: (i: number) => i === mySeat,
      }
    : {};

  return (
    <section className={styles.claimPanel} aria-label="Seats">
      <SectionLabel as="span">{seated ? "Seats" : "Take a seat"}</SectionLabel>
      <SeatList
        seats={seats}
        label="Seats"
        colorOptions={colorOptions}
        minPlayers={minPlayers}
        maxPlayers={maxPlayers}
        {...edits}
        seatNote={(i) =>
          i === mySeat ? (
            <span className={styles.seatNote}>You</span>
          ) : heldByOther(i) ? (
            <span className={styles.seatNote}>Taken</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClaim(i)}
              aria-label={`Claim seat ${i + 1}`}
            >
              Claim
            </Button>
          )
        }
      />
    </section>
  );
}

export default function CompanionPage() {
  return (
    <Suspense fallback={null}>
      <CompanionScreen />
    </Suspense>
  );
}

/** An option's setup steps, numbered, under its name in a row. */
function OptionSteps({ steps }: { steps: string[] }) {
  return (
    <ol className={styles.optionSteps}>
      {steps.map((s, i) => (
        <li key={i}>
          <span className={styles.heroCardStepsIndex}>{i + 1}.</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
