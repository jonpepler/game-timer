"use client";

import styles from "./page.module.css";

import { useWindowSize } from "@/hooks/useWindowSize";
import { Footer } from "@/components/timer/Footer";
import { FullScreen } from "@/components/FullScreen";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTimer } from "@/hooks/useTimer";
import { useTurnEntryControls } from "@/hooks/useTurnEntryControls";
import { TimerRing } from "@/components/timer/TimerRing";
import { useGameSetup } from "@/hooks/useGameSetupModal";
import type {
  GameConfig,
  GameSetupWizardHandle,
  SeatingInfo,
} from "@/components/GameSetupWizard";
import { getPlayerStats } from "@/utils/getPlayerStats";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { ScorePanel } from "@/components/ScorePanel";
import { TurnOrderPanel } from "@/components/TurnOrderPanel";
import {
  type GameSessionState,
  selectNeedsValueStep,
} from "@/state/gameSession";
import {
  applySeatCommand,
  type CommandActor,
  checkCommand,
  DEFAULT_COMMAND_POLICY,
  isSeatCommand,
  projectCommand,
  resolveSeatCommand,
  type SessionCommand,
  SessionCommandSchema,
  type TableContext,
  canUndo as canUndoState,
  type Verdict,
} from "@/state/sessionCommands";
import { TurnActions } from "@/components/TurnActions";
import { PhaseBar } from "@/components/timer/PhaseBar";
import { VictoryBanner } from "@/components/VictoryBanner";
import { PlayerMeeple } from "@/components/PlayerMeeple";
import { TurnEntryBanner } from "@/components/identity/EntryBanner";
import { EventDialog } from "@/components/EventDialog";
import { LeadPrompt } from "@/components/LeadPrompt";
import { findDefinition } from "@/state/definitionRegistry";
import { effectiveScoreMax, turnOrderForSetup } from "@/state/gameDefinition";
import { Plus, Users } from "lucide-react";
import { IconButton } from "@/components/ui";
import { SchemeToggle } from "@/components/SchemeToggle";
import { ShareSessionMenu } from "@/components/ShareSessionMenu";
import { PeerNotice } from "@/components/PeerNotice";
import { PlayersSheet } from "@/components/PlayersSheet";
import { SharePanel } from "@/components/SharePanel";
import {
  playerColor,
  playerHeadIcon,
  playerIcon,
  playerSubheading,
} from "@/lib/playerVisual";
import { useColourScheme, useGameTheme } from "@/hooks/useGameTheme";
import { useSessionHost } from "@/hooks/useSessionHost";
import {
  PEER_PROTOCOL_VERSION,
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { createLogger } from "@/lib/logger";
import { followSeats, makeSeatId, type Seat } from "@/state/seating";

const peerLog = createLogger("host-protocol");
const playersLog = createLogger("host-players");
const stateLog = createLogger("host-state");

/**
 * Starting values before any game is set up. Setting one up replaces
 * them with the game definition's own defaults.
 */
const initialTime = 5 * 60;
const defaultExpectedTurns = 90;

type PanelId = "turnActions" | "phase" | "turnOrder" | "scores" | "timeShare";

type PanelRegion = "left" | "right" | "bottom";

/**
 * The panels around the ring, in reading order. On a phone they flow
 * below the ring in this order; on a wide screen each sits in the
 * region named by PANEL_PLACEMENT, keeping this order within it.
 */
const PANEL_ORDER: readonly PanelId[] = [
  "turnActions",
  "phase",
  "turnOrder",
  "scores",
  "timeShare",
];

/**
 * Where each panel sits on a wide screen. The bottom row spans the full
 * width under the three columns and holds the scores (or the value
 * chart that stands in for them) above the time share. The right column
 * holds the turn order; it takes its share of the width whether or not
 * there is one, so the ring stays centred.
 */
const PANEL_PLACEMENT: Record<PanelId, PanelRegion> = {
  turnActions: "left",
  phase: "left",
  turnOrder: "right",
  scores: "bottom",
  timeShare: "bottom",
};

const PANEL_REGIONS: readonly PanelRegion[] = ["left", "right", "bottom"];

export default function Home() {
  const { height, width } = useWindowSize();

  const {
    getTimerString,
    getStopwatchString,
    pause,
    unpause,
    resetTimer,
    undo,
    inUndoGroup,
    canUndo,
    paused,
    timerTotalSeconds,
    stopwatchTotalSeconds,
    averageTime,
    timerFinished,
    untimedLabel,
    state,
    remainingTurns,
    remainingCount,
    remainingSeconds,
    turnsModelled,
    currentPlayerIndex,
    setExpectedTurns,
    setStartingAverage,
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
    dismissMilestone,
    pendingMilestones,
    setTurnOrder,
    setLead,
    setControls,
    triggerControl,
    turnOrder,
    pendingLeadPrompt,
    availableControls,
    turnOrderView,
    turnPhases,
    reorderTurnEntry,
    activateTurnEntry,
    deactivateTurnEntry,
    setPhase,
    dismissPhasePrompt,
    setEntryValue,
    combineEntries,
    setTurnEntryPlayer,
  } = useTimer({
    initialTime,
    initialExpectedTurns: defaultExpectedTurns,
    height,
    width,
  });

  const players = state.players;
  /**
   * peerId to claimed seat index, released when the companion
   * disconnects. The ref is the truth and changes synchronously, so a
   * second seat change or message landing before React re-renders sees
   * the first one's claims; the state copy only drives re-broadcasts.
   */
  const claimsRef = useRef<Record<string, number>>({});
  const [claimMap, setClaimMapState] = useState(claimsRef.current);
  /**
   * The setup wizard's seating list while it is seating players, else
   * null. Seat commands act on it rather than the running game, and
   * claims are indices into it. Kept in step synchronously by seat
   * commands and by the wizard's own edits (onSeatingChange).
   */
  const seatingSnapshotRef = useRef<SeatingInfo | null>(null);
  const setClaimMap = useCallback(
    (
      change: (prev: Record<string, number>) => Record<string, number>,
    ): void => {
      const next = change(claimsRef.current);
      if (next === claimsRef.current) return;
      claimsRef.current = next;
      setClaimMapState(next);
    },
    [],
  );

  // Forward-declared wizard handle so peer SETUP_PICK messages can
  // call applyPick before useGameSetup() runs further down. The
  // wizard <ref> is set when it mounts; before then this is null
  // and SETUP_PICK is a no-op.
  const wizardHandleRef = useRef<GameSetupWizardHandle | null>(null);

  // The SETUP_TURN currently in flight (the seat whose pick we're
  // waiting on), or null between turns. Held so we can RE-broadcast it:
  // a setup message dropped in either direction (host→companion
  // SETUP_TURN, or companion→host SETUP_PICK) otherwise wedges the
  // wizard — the companion clears its picker optimistically and the
  // host never re-emits. Re-sending on a heartbeat + on every fresh
  // connect lets a dropped turn self-heal.
  const pendingSetupTurnRef = useRef<HostToCompanionMessage | null>(null);

  // Re-send the full snapshot (STATE + seating + any in-flight setup
  // turn) to all peers. Wired further down once broadcastState /
  // broadcastSeating exist; called both on a peer connecting and when a
  // peer explicitly asks via REQUEST_STATE (its first-sync safety net).
  const resyncPeersRef = useRef<() => void>(() => {});

  // Set when a companion speaks another protocol version, so the host
  // says so instead of ignoring its taps without a word.
  const [mismatchedPeerVersion, setMismatchedPeerVersion] = useState<
    number | null
  >(null);

  /**
   * The state the next command is checked against. Reset to the real
   * state on every commit and advanced by projection after each command,
   * so two commands landing before React re-renders (two screens
   * answering one prompt) are checked in order rather than both against
   * the same snapshot.
   */
  const commandStateRef = useRef(state);
  useEffect(() => {
    commandStateRef.current = state;
  }, [state]);

  /**
   * The one path every game action takes, from this screen's UI or from
   * a companion: check it against the policy and the current state, then
   * carry it out through the timer's own actions.
   */
  const runCommand = (
    command: SessionCommand,
    actor: CommandActor,
    // Prefixed to the command's undo group, so one screen's flow can
    // never join another's.
    groupScope = "host",
  ): Verdict => {
    const seating = seatingSnapshotRef.current;
    const table: TableContext = {
      seating,
      claimedSeats: new Set(Object.values(claimsRef.current)),
    };
    const resolved = resolveSeatCommand(command, table);
    const against = commandStateRef.current;
    const verdict = resolved.ok
      ? checkCommand(
          against,
          resolved.command,
          actor,
          DEFAULT_COMMAND_POLICY,
          table,
        )
      : resolved;
    if (!resolved.ok || !verdict.ok) {
      peerLog.info("command refused", {
        type: command.type,
        actor: actor.kind,
        reason: verdict.ok ? "" : verdict.reason,
      });
      return verdict;
    }
    const checked = resolved.command;
    if (seating && isSeatCommand(checked)) {
      const newSeatId = makeSeatId();
      const change = (seats: Seat[]) =>
        applySeatCommand(seats, checked, seating.colorOptions, newSeatId);
      wizardHandleRef.current?.updateSeats(seating.stepId, change);
      updateSeatingRef.current({ ...seating, seats: change(seating.seats) });
      return verdict;
    }
    commandStateRef.current = projectCommand(
      against,
      checked,
      Date.now(),
      table,
    );
    if (checked.undoGroup !== undefined)
      inUndoGroup(`${groupScope}:${checked.undoGroup}`, () =>
        executeCommand(checked, against),
      );
    else executeCommand(checked, against);
    return verdict;
  };
  const executeCommand = (
    command: SessionCommand,
    against: GameSessionState,
  ) => {
    switch (command.type) {
      case "END_TURN":
        // The step only applies when the running phase asks for one.
        resetTimer(
          command.valueStepId !== undefined && selectNeedsValueStep(against)
            ? { valueStepId: command.valueStepId }
            : {},
        );
        break;
      case "ACTIVATE_ENTRY":
        activateTurnEntry({
          id: command.entryId,
          ...(command.playerIndex !== undefined
            ? { playerIndex: command.playerIndex }
            : {}),
          ...(command.value !== undefined ? { value: command.value } : {}),
        });
        break;
      case "DEACTIVATE_ENTRY":
        deactivateTurnEntry(command.entryId);
        break;
      case "REORDER_ENTRY":
        reorderTurnEntry(command.entryId, command.toIndex);
        break;
      case "SET_ENTRY_OWNER":
        setTurnEntryPlayer(command.entryId, command.playerIndex);
        break;
      case "SET_ENTRY_VALUE":
        setEntryValue(command.entryId, command.value);
        break;
      case "COMBINE_ENTRIES": {
        const { type: _, undoGroup: __, ...combine } = command;
        combineEntries(combine);
        break;
      }
      case "SET_PHASE":
        setPhase(command.phaseId, {
          ...(command.firstEntryId !== undefined
            ? { firstEntryId: command.firstEntryId }
            : {}),
          ...(command.exitFirstEntryId !== undefined
            ? { exitFirstEntryId: command.exitFirstEntryId }
            : {}),
        });
        break;
      case "DISMISS_PHASE_PROMPT":
        dismissPhasePrompt();
        break;
      case "INCREMENT_SCORE":
        incrementScore(command.playerIndex, command.delta);
        break;
      case "TRIGGER_CONTROL":
        triggerControl(command.controlId);
        break;
      case "UNDO":
        undo();
        break;
      case "SET_PAUSED":
        if (command.paused && !paused) pause();
        else if (!command.paused && paused) unpause();
        break;
      case "SET_EXPECTED_TURNS":
        setExpectedTurns(command.expectedTurns);
        break;
      case "RENAME_PLAYER": {
        const player = against.players?.[command.playerIndex];
        if (player)
          setPlayer(command.playerIndex, { ...player, name: command.name });
        break;
      }
      // Seat changes only run during setup, through the wizard.
      default:
        break;
    }
  };
  const runHostCommand = (command: SessionCommand) => {
    runCommand(command, { kind: "host" });
  };

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
      const peerVersion =
        typeof msg.protocolVersion === "number" ? msg.protocolVersion : null;
      setMismatchedPeerVersion(peerVersion ?? -1);
      sessionHostSendRefForState.current({
        type: "PROTOCOL_MISMATCH",
        protocolVersion: PEER_PROTOCOL_VERSION,
        peerId,
        peerVersion,
      } satisfies HostToCompanionMessage);
      return;
    }
    switch (msg.type) {
      case "CLAIM": {
        const seating = seatingSnapshotRef.current;
        const seatCount = seating
          ? seating.seats.length
          : (commandStateRef.current.players?.length ?? 0);
        const index = msg.playerIndex;
        const holder = Object.entries(claimsRef.current).find(
          ([otherPeer, i]) => i === index && otherPeer !== peerId,
        );
        // During setup a seat belongs to the first phone to claim it.
        // Mid-game a phone reconnecting under a new peer id may still
        // be listed against its old one, so a held seat stays open.
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= seatCount ||
          (seating && holder)
        ) {
          peerLog.warn("claim rejected", { peerId, playerIndex: index });
          // The seat list tells the phone which seats are free.
          broadcastSeatingRef.current();
          return;
        }
        setClaimMap((prev) => ({ ...prev, [peerId]: index }));
        peerLog.info("claim accepted", { peerId, playerIndex: index });
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
      case "REQUEST_STATE": {
        // A (re)connecting companion didn't receive our connect-time
        // push (data channel wasn't open yet). Re-send the snapshot.
        peerLog.info("REQUEST_STATE — resyncing peer", { peerId });
        resyncPeersRef.current();
        return;
      }
      case "COMMAND": {
        const reply = (verdict: Verdict) =>
          sessionHostSendRefForState.current({
            type: "COMMAND_RESULT",
            protocolVersion: PEER_PROTOCOL_VERSION,
            commandId: String(msg.commandId),
            ok: verdict.ok,
            ...(verdict.ok ? {} : { reason: verdict.reason }),
          } satisfies HostToCompanionMessage);
        const parsed = SessionCommandSchema.safeParse(msg.command);
        if (!parsed.success) {
          peerLog.warn("dropping malformed command", { peerId });
          reply({ ok: false, reason: "The host did not understand that" });
          return;
        }
        const claimed = claimsRef.current[peerId];
        const actor: CommandActor =
          claimed === undefined
            ? { kind: "guest" }
            : { kind: "seat", seatIndex: claimed };
        reply(runCommand(parsed.data, actor, peerId));
        return;
      }
      case "SET_PLAYER_OPTION": {
        const claimed = claimsRef.current[peerId];
        if (claimed === undefined) {
          peerLog.warn("SET_PLAYER_OPTION rejected — no claim", { peerId });
          return;
        }
        const def = definitionId ? findDefinition(definitionId) : undefined;
        // Resolve the player-pick step that owns the option list.
        const pickStep = def?.setupSteps?.find(
          (s) => s.kind.type === "player-pick",
        );
        if (pickStep?.kind.type !== "player-pick") {
          peerLog.warn("SET_PLAYER_OPTION rejected — no player-pick step", {
            peerId,
          });
          return;
        }
        const option = pickStep.kind.options.find((o) => o.id === msg.optionId);
        if (!option) {
          peerLog.warn("SET_PLAYER_OPTION rejected — unknown optionId", {
            peerId,
            optionId: msg.optionId,
          });
          return;
        }
        const visualKey = def?.playerVisualFrom;
        if (!visualKey) {
          peerLog.warn(
            "SET_PLAYER_OPTION rejected — definition declares no playerVisualFrom",
            { peerId },
          );
          return;
        }
        const optionOf = (p: { metadata: Record<string, unknown> }) => {
          const m = p.metadata[visualKey];
          if (
            m &&
            typeof m === "object" &&
            (m as { type?: unknown }).type === "selected-option"
          ) {
            return m as { optionId: string };
          }
          return undefined;
        };
        const takenBy = state.players?.findIndex(
          (p, i) => i !== claimed && optionOf(p)?.optionId === option.id,
        );
        if (takenBy !== undefined && takenBy !== -1) {
          peerLog.warn(
            "SET_PLAYER_OPTION rejected — option taken by another slot",
            {
              peerId,
              optionId: option.id,
            },
          );
          return;
        }
        // Mutex constraints live on the player-pick step itself.
        const mutex = (pickStep.kind.constraints ?? [])
          .filter((c) => c.type === "mutually-exclusive")
          .map((c) => c.optionIds);
        const blockedByMutex = state.players?.some((p, i) => {
          if (i === claimed) return false;
          const oid = optionOf(p)?.optionId;
          if (!oid) return false;
          return mutex.some(
            ([a, b]) =>
              (a === oid && b === option.id) || (b === oid && a === option.id),
          );
        });
        if (blockedByMutex) {
          peerLog.warn("SET_PLAYER_OPTION rejected — mutex with another slot", {
            peerId,
            optionId: option.id,
          });
          return;
        }
        // Pull asset paths through the same passthrough route the
        // wizard uses at submit time, so the new metadata carries
        // iconSrc / headIconSrc and the renderer keeps showing the
        // option's meeple + head crop after the swap.
        const assets = (
          option as unknown as {
            assets?: {
              meepleSvg?: { appPath?: string };
              headIcon?: Array<{ appPath?: string }>;
            };
          }
        ).assets;
        const meeple = assets?.meepleSvg?.appPath;
        const head = assets?.headIcon?.[0]?.appPath;
        // Preserve the existing seat name. Earlier code overwrote
        // player.name with the option's label, which clobbered the
        // human's display name with the option label every time
        // anyone switched.
        const existing = state.players?.[claimed];
        const preservedName = existing?.name ?? option.label;
        // Diagnostic — confirms what got written to the player's
        // metadata after a swap. The deployed bundle in the wild
        // dropped iconSrc / headIconSrc until very recently; this
        // log lets us spot regressions without having to dig
        // through STATE on the wire.
        peerLog.info("SET_PLAYER_OPTION applied", {
          claimed,
          optionId: option.id,
          color: option.color,
          meeple,
          head,
          preservedName,
        });
        setPlayer(claimed, {
          name: preservedName,
          metadata: {
            ...(existing?.metadata ?? {}),
            [visualKey]: {
              type: "selected-option",
              optionId: option.id,
              label: option.label,
              color: option.color,
              description: option.description,
              ...(meeple ? { iconSrc: meeple } : {}),
              ...(head ? { headIconSrc: head } : {}),
            },
          },
        });
        return;
      }
      case "SETUP_PICK": {
        // Wizard-time picker pick from a seated companion. Both
        // `player-pick` and `dealt-resolve` use this message —
        // routed by looking up the named step's kind on the
        // active definition. Identity-bound: a peer can only
        // pick for the seat they've claimed.
        const handle = wizardHandleRef.current;
        if (!handle) {
          peerLog.warn("SETUP_PICK dropped — wizard not mounted", { peerId });
          return;
        }
        let claimed = claimsRef.current[peerId];
        if (claimed === undefined) {
          // The peer's earlier CLAIM / SEATING_REQUEST may have been
          // dropped (e.g. on a flaky link during the brief seating
          // window). Rather than wedge the pick — leaving the host
          // stuck on this seat forever — honour an implicit claim when
          // the seat it's picking for is free. If the seat is held by
          // someone else, still reject (identity protection).
          const seatCount = seatingSnapshotRef.current?.seats.length;
          if (
            msg.seatIndex < 0 ||
            (seatCount !== undefined && msg.seatIndex >= seatCount)
          ) {
            peerLog.warn("SETUP_PICK rejected — seatIndex out of range", {
              peerId,
              seatIndex: msg.seatIndex,
            });
            return;
          }
          const seatTaken = Object.entries(claimsRef.current).some(
            ([otherPeer, idx]) => idx === msg.seatIndex && otherPeer !== peerId,
          );
          if (seatTaken) {
            peerLog.warn("SETUP_PICK rejected — seat claimed by another peer", {
              peerId,
              seatIndex: msg.seatIndex,
            });
            return;
          }
          peerLog.info("SETUP_PICK implicit-claim — recovering dropped claim", {
            peerId,
            seatIndex: msg.seatIndex,
          });
          setClaimMap((prev) => ({ ...prev, [peerId]: msg.seatIndex }));
          claimed = msg.seatIndex;
        }
        if (claimed !== msg.seatIndex) {
          peerLog.warn("SETUP_PICK rejected — seatIndex mismatch with claim", {
            peerId,
            claimed,
            requested: msg.seatIndex,
          });
          return;
        }
        // Route by the WIZARD's current step kind, not the timer
        // page's `definitionId` — the wizard's selection isn't
        // committed to the timer state until submit.
        if (handle.getStepKind(msg.stepId) === "dealt-resolve") {
          handle.applyResolve(msg.stepId, msg.seatIndex, msg.optionId);
        } else {
          handle.applyPick(msg.stepId, msg.seatIndex, msg.optionId);
        }
        return;
      }
      case "TAP_TIMER": {
        // The companion-side equivalent of tapping the timer
        // container. Always allowed — Generic + no-tracking is the
        // primary case but it's harmless in any mode.
        entryControls.advance();
        return;
      }
      case "DISMISS_MILESTONE": {
        // Any connected screen can acknowledge the milestone — the
        // dialog is fullscreen on every device, so whoever taps
        // Acknowledge first wins. The next STATE broadcast clears
        // the dialog on every other screen automatically.
        dismissMilestone();
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

  // Latest state + definition kept in refs so the synchronous
  // onConnect callback below can broadcast the freshest snapshot
  // without depending on React's render timing. Without this, a
  // companion connecting at the same instant another disconnects
  // (e.g. Strict Mode's double-mount of useSessionCompanion) can
  // miss the first-connection STATE: peerCount oscillates 1→2→1
  // within a single render pass, so the peerCount-keyed useEffect
  // below never sees a changed dep and skips re-broadcasting.
  const latestStateRef = useRef(state);
  const latestDefinitionIdRef = useRef(definitionId);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);
  useEffect(() => {
    latestDefinitionIdRef.current = definitionId;
  }, [definitionId]);
  // The clock is not game state, so its paused flag travels beside it.
  const latestPausedRef = useRef(paused);
  latestPausedRef.current = paused;

  // The host's send function is held in a ref so the onConnect
  // callback below can reach the latest sender without re-creating
  // itself every render (which would re-subscribe useSessionHost).
  const sessionHostSendRefForState = useRef<(data: unknown) => void>(() => {});

  const lastStateSentAtRef = useRef<number>(0);
  // Build + broadcast a STATE message. Used both by the
  // peerCount-keyed useEffect below and by onConnect (where it
  // bypasses the React render race noted above).
  const broadcastState = useCallback((peerCountHint: number) => {
    const def = latestDefinitionIdRef.current
      ? findDefinition(latestDefinitionIdRef.current)
      : undefined;
    const now = Date.now();
    const message: HostToCompanionMessage = {
      type: "STATE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      // Undo snapshots stay on the host; companions only need to know
      // whether there is anything to undo.
      state: { ...latestStateRef.current, undoStack: undefined },
      canUndo: canUndoState(latestStateRef.current),
      paused: latestPausedRef.current,
      definition: def,
      sentAt: now,
    };
    sessionHostSendRefForState.current(message);
    const bytes = JSON.stringify(message).length;
    const dt = lastStateSentAtRef.current
      ? now - lastStateSentAtRef.current
      : null;
    lastStateSentAtRef.current = now;
    stateLog.debug("broadcast", {
      bytes,
      intervalMs: dt,
      peers: peerCountHint,
      turns: latestStateRef.current.turns.length,
    });
  }, []);

  // Forward declaration — broadcastSeating is defined further down
  // but the onConnect callback below needs to call it. We thread
  // through a ref so we can wire the reference once the function
  // is defined, without re-creating the onConnect closure (which
  // would re-subscribe useSessionHost).
  const broadcastSeatingRef = useRef<() => void>(() => {});

  const sessionHost = useSessionHost({
    onMessage: handleCompanionMessage,
    onDisconnect: handleCompanionDisconnect,
    // Sync-broadcast STATE + seating the moment a peer connects,
    // bypassing the React render race (see latestStateRef comment
    // above). The real/fake host's send() fans out to every open
    // conn, so the freshly-attached peer gets it alongside
    // existing peers.
    onConnect: () => {
      resyncPeersRef.current();
    },
  });

  // Single resync routine, shared by onConnect (push) and REQUEST_STATE
  // (companion pull). Re-sends STATE + seating + any in-flight setup
  // turn. The real/fake host's send() fans out to every open conn, so
  // the freshly-attached peer gets it alongside existing peers.
  useEffect(() => {
    resyncPeersRef.current = () => {
      broadcastState(-1);
      broadcastSeatingRef.current();
      // A companion connecting mid-pick (or reconnecting after a drop)
      // needs the active turn re-sent or it can't pick.
      if (pendingSetupTurnRef.current) {
        sessionHostSendRefForState.current(pendingSetupTurnRef.current);
      }
    };
  }, [broadcastState]);

  // Keep the broadcastState's send-ref pointed at the latest
  // sessionHost.send so onConnect always sees the live sender.
  useEffect(() => {
    sessionHostSendRefForState.current = sessionHost.send;
  }, [sessionHost.send]);

  // Broadcast on state change too. peerCount stays in the dep array
  // as a best-effort backstop (covers the common, race-free path);
  // the onConnect callback above is what guarantees delivery to a
  // newly-arrived peer under React batching. `state` + `definitionId`
  // are deliberate change-triggers — broadcastState reads them via
  // refs (so the deps are otherwise unused inside the effect body).
  const peerCount = sessionHost.connectedPeers.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: state + definitionId are deliberate broadcast triggers; their values come from refs inside broadcastState
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    broadcastState(peerCount);
  }, [
    state,
    paused,
    peerCount,
    sessionHost.status,
    definitionId,
    broadcastState,
  ]);

  // Player-metadata diagnostic — emit a snapshot whenever the roster
  // identity changes (names + metadata), gated on a content hash so
  // turn ticks don't fire it. Lets the debug overlay confirm whether
  // each player carries the expected color + asset paths on the
  // live player array.
  const lastPlayersSigRef = useRef<string>("");
  useEffect(() => {
    if (!state.players || state.players.length === 0) return;
    const slim = state.players.map((p, i) => ({
      i,
      name: p.name,
      metadata: p.metadata,
    }));
    const sig = JSON.stringify(slim);
    if (sig === lastPlayersSigRef.current) return;
    lastPlayersSigRef.current = sig;
    playersLog.info("roster", { players: slim });
  }, [state.players]);

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
    setStartingAverage(definition?.defaultAverageSeconds ?? initialTime);
    // Score is only meaningful when player tracking is on — clear the
    // subsystem otherwise so victories can't fire against an empty roster.
    // Resolve any per-seat-count victory threshold into a concrete `max`
    // up front so the score/victory logic and the score track work
    // unchanged.
    const baseScore = incoming.players ? definition?.score : undefined;
    const seatCount = incoming.players?.length ?? 0;
    setScoreConfig(
      baseScore
        ? { ...baseScore, max: effectiveScoreMax(baseScore, seatCount) }
        : undefined,
    );
    // Install the turn-order model and seed the opening lead from the
    // select-lead setup step (if the game declared one). Round-robin
    // games pass undefined and keep the default rotation.
    // A definition marked `selectable` lets the wizard override the mode
    // (Generic's "Fixed rotation" vs "Variable" setting).
    // Entries and phases gated on modules the table left out are dropped.
    const declaredOrder =
      definition?.turnOrder && incoming.setupContext
        ? turnOrderForSetup(definition.turnOrder, incoming.setupContext)
        : definition?.turnOrder;
    const turnOrder =
      declaredOrder?.selectable && incoming.turnOrderMode
        ? { ...declaredOrder, mode: incoming.turnOrderMode }
        : declaredOrder;
    setTurnOrder(incoming.players ? turnOrder : undefined);
    // Controls act for seats, so they need player tracking too.
    setControls(incoming.players ? definition?.controls : undefined);
    const leadChoice = incoming.setupContext
      ? Object.values(incoming.setupContext).find(
          (c) => c.kind === "select-lead",
        )
      : undefined;
    if (leadChoice?.kind === "select-lead" && incoming.players?.length)
      setLead(Math.min(leadChoice.seatIndex, incoming.players.length - 1));
    // When the wizard sets autoStart (last seat just confirmed
    // their pick), start the clock so the table doesn't have to tap
    // the screen to begin.
    if (incoming.autoStart) setStartPending(true);
  };

  /**
   * Starts the clock once the new game's state has committed. Calling
   * resetTimer straight from applyConfig would read the previous game's
   * state, so it would start the wrong countdown (or record a turn when
   * that game was running).
   */
  const [startPending, setStartPending] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetTimer is recreated every render; this runs once per pending start, after the new game's state has committed
  useEffect(() => {
    if (!startPending) return;
    setStartPending(false);
    resetTimer();
  }, [startPending]);

  // Peer hooks: forward the wizard's turn-based picker events to the
  // peer broker so seated companions can pick on their own screens.
  // Incoming SETUP_PICK messages route back into the wizard via
  // wizardRef.applyPick (wired below in handleCompanionMessage).
  const sessionHostSendRef = useRef(sessionHost.send);
  useEffect(() => {
    sessionHostSendRef.current = sessionHost.send;
  }, [sessionHost.send]);

  const broadcastSeating = useCallback(() => {
    const snapshot = seatingSnapshotRef.current;
    if (!snapshot) {
      sessionHostSendRef.current({
        type: "SETUP_SEATING_CLOSED",
        protocolVersion: PEER_PROTOCOL_VERSION,
      } satisfies HostToCompanionMessage);
      return;
    }
    // Project the peerId to seat index claim map onto a per-seat list
    // of claiming peer ids, with `null` for unclaimed seats.
    const claimedBy: Array<string | null> = snapshot.seats.map(() => null);
    for (const [peerId, seatIndex] of Object.entries(claimsRef.current)) {
      if (seatIndex >= 0 && seatIndex < claimedBy.length) {
        claimedBy[seatIndex] = peerId;
      }
    }
    sessionHostSendRef.current({
      type: "SETUP_SEATING",
      protocolVersion: PEER_PROTOCOL_VERSION,
      stepId: snapshot.stepId,
      seats: snapshot.seats,
      claimedBy,
      minPlayers: snapshot.minPlayers,
      maxPlayers: snapshot.maxPlayers,
      ...(snapshot.colorOptions ? { colorOptions: snapshot.colorOptions } : {}),
    } satisfies HostToCompanionMessage);
  }, []);

  /**
   * Replace the seating snapshot (null once setup stops seating), carry
   * claims across the change and tell every companion. Claims follow
   * their seat by id, so a reorder or removal on any screen keeps each
   * phone on the seat it took. A list sharing no seat with the last one
   * (the wizard reopened, or another game picked) is a fresh list, and
   * claims keep their index on it.
   */
  const updateSeating = useCallback(
    (info: SeatingInfo | null) => {
      const before = seatingSnapshotRef.current;
      if (!info && !before) return;
      if (info) {
        const ids = new Set(info.seats.map((seat) => seat.id));
        const continues = before?.seats.some((seat) => ids.has(seat.id));
        setClaimMap((claims) =>
          followSeats(
            claims,
            continues ? (before?.seats ?? null) : null,
            info.seats,
          ),
        );
      }
      seatingSnapshotRef.current = info;
      broadcastSeating();
    },
    [broadcastSeating, setClaimMap],
  );
  const updateSeatingRef = useRef(updateSeating);
  updateSeatingRef.current = updateSeating;

  // Re-broadcast whenever the claim map changes, so every companion
  // sees fresh `claimedBy`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: claimMap is the change trigger; broadcastSeating reads claimsRef
  useEffect(() => {
    broadcastSeating();
  }, [claimMap, broadcastSeating]);

  // Expose the latest broadcastSeating to the onConnect closure
  // installed above. See note next to broadcastSeatingRef.
  useEffect(() => {
    broadcastSeatingRef.current = broadcastSeating;
  }, [broadcastSeating]);

  // Newly-connected companions also need the current seating snapshot
  // so they can see the seat list + render claim/rename/add controls
  // before the game starts. peerCount is the best-effort backstop;
  // the onConnect callback in useSessionHost above is the
  // race-proof path that handles React batching of connect+disconnect
  // events under Strict Mode's double-mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: peerCount is a deliberate re-run trigger — re-broadcast when a companion connects
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    broadcastSeating();
  }, [peerCount, sessionHost.status, broadcastSeating]);

  // Heartbeat: while a turn-based pick is in flight, re-broadcast it on
  // a low cadence so a dropped SETUP_TURN (or a dropped companion
  // SETUP_PICK that left the host stuck on the same seat) self-heals —
  // the companion re-receives the turn and can pick again. No-ops
  // between turns (ref is null) and once the game starts (onTurnEnd
  // clears it). Re-sending an identical turn is safe: the companion
  // keeps any open preview, and a duplicate pick is idempotent on the
  // host. The 2s cadence only runs during the short setup window.
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    const id = window.setInterval(() => {
      if (pendingSetupTurnRef.current) {
        sessionHostSendRef.current(pendingSetupTurnRef.current);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [sessionHost.status]);

  const wizardPeerHooks = useMemo(
    () => ({
      onTurnStart: (info: {
        stepId: string;
        seatIndex: number;
        seatName: string;
        optionIds: string[];
        excludedOptionIds: string[];
        definition: ReturnType<typeof findDefinition>;
      }) => {
        if (!info.definition) return;
        const message: HostToCompanionMessage = {
          type: "SETUP_TURN",
          protocolVersion: PEER_PROTOCOL_VERSION,
          stepId: info.stepId,
          seatIndex: info.seatIndex,
          optionIds: info.optionIds,
          excludedOptionIds: info.excludedOptionIds,
          definition: info.definition,
        };
        // Remember the in-flight turn so the heartbeat / onConnect can
        // re-send it if it (or the companion's reply) is dropped.
        pendingSetupTurnRef.current = message;
        sessionHostSendRef.current(message);
      },
      onTurnEnd: (info: { stepId: string }) => {
        pendingSetupTurnRef.current = null;
        sessionHostSendRef.current({
          type: "SETUP_DONE",
          protocolVersion: PEER_PROTOCOL_VERSION,
          stepId: info.stepId,
        });
      },
      onSeatingChange: updateSeating,
    }),
    [updateSeating],
  );
  // Track the wizard's current screen so the Share-session side
  // panel can be visible only on screen 0 (the Game-picker), and
  // the peer session can be auto-opened as the wizard appears.
  const [wizardScreen, setWizardScreen] = useState(0);
  // Sticky flag: once the user explicitly stops the share session
  // during the wizard, don't auto-restart it on subsequent screen
  // changes. The chrome's Share button stays available to opt back
  // in manually.
  const [shareOptedOut, setShareOptedOut] = useState(false);
  const sharePanelNode = (
    <SharePanel
      status={sessionHost.status}
      sessionCode={sessionHost.sessionCode}
      connectedPeers={sessionHost.connectedPeers}
      error={sessionHost.error}
      onClose={() => {
        setShareOptedOut(true);
        sessionHost.close();
      }}
      onRetry={sessionHost.open}
    />
  );
  const { open, isOpen, modal } = useGameSetup({
    onSubmit: applyConfig,
    peerHooks: wizardPeerHooks,
    wizardRef: wizardHandleRef,
    sidePanel: sharePanelNode,
    onScreenChange: setWizardScreen,
  });

  // Auto-open the peer session whenever the wizard is mounted on
  // its first screen. This is the moment companions can be most
  // useful (they can claim seats before any choices are made), so
  // the QR + code surface as part of that screen rather than
  // requiring a separate Share click.
  useEffect(() => {
    if (!isOpen) return;
    if (wizardScreen !== 0) return;
    if (sessionHost.status !== "idle") return;
    if (shareOptedOut) return;
    sessionHost.open();
  }, [
    isOpen,
    wizardScreen,
    sessionHost.status,
    sessionHost.open,
    shareOptedOut,
  ]);

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
  /**
   * Whether a tap on the ring is held back: while the setup modal is
   * open, or while a field elsewhere asks for it. The modal is read
   * directly rather than copied into the flag by an effect, because the
   * copy lags a commit behind and on a slow render it swallowed the
   * first tap after the wizard closed.
   */
  const ringGuarded = preventClickCapture || isOpen;

  const playerStats = useMemo(
    () =>
      getPlayerStats(
        state.turns
          .filter((t) => t.playerIndex !== null)
          .map((t) => ({
            playerIndex: t.playerIndex as number,
            elapsedSeconds: t.elapsedSeconds,
            untimed: t.untimed,
          })),
      ),
    [state.turns],
  );

  const activeDef = definitionId ? findDefinition(definitionId) : undefined;
  useGameTheme(definitionId);
  const scheme = useColourScheme();
  const visualKey = activeDef?.playerVisualFrom;
  const colorKey = activeDef?.playerColorFrom ?? visualKey;
  const subheadingKey = activeDef?.playerSubheadingFrom;

  // Subheading text for the active player ("Marquise de Cat" under
  // "Jon"). Suppressed when it'd duplicate the player's display name.
  const activeSubheading =
    players && currentPlayerIndex !== null
      ? playerSubheading(players[currentPlayerIndex], subheadingKey)
      : undefined;

  // Project players to a renderable view with resolved colour + icon,
  // since the runtime Player carries metadata not a top-level colour.
  // `iconSrc` is the full-body silhouette (used on the active-player
  // banner + faction picker); `headIconSrc` is the portrait crop
  // used on the score panel + victory hero where the long meeple
  // doesn't fit.
  const playerViews = useMemo(
    () =>
      players?.map((p, i) => ({
        name: p.name,
        color: playerColor(p, i, colorKey, scheme),
        iconSrc: playerIcon(p, visualKey),
        headIconSrc: playerHeadIcon(p, visualKey),
      })),
    [players, visualKey, colorKey, scheme],
  );

  // A labelled turn entry (not a seat) heads the banner with its own
  // name and colour; its linked player, if any, becomes the subheading.
  const activeEntry = turnOrderView?.entries.find(
    (e) => e.id === turnOrderView.activeId,
  );
  const activeSeatView =
    playerViews && currentPlayerIndex !== null
      ? playerViews[currentPlayerIndex]
      : undefined;
  const activePlayer = activeSeatView;
  const activeIsEntry = activeEntry?.label !== undefined;
  /**
   * Whether the ring is mostly scrolled out from under the header bar,
   * which only a phone's scrolling page can do. It brings in the
   * one-line readout of the turn and its time.
   */
  const ringRef = useRef<HTMLDivElement | null>(null);
  const [ringOutOfView, setRingOutOfView] = useState(false);
  useEffect(() => {
    const el = ringRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setRingOutOfView(entry.intersectionRatio < 0.4),
      // The header bar and the readout's own line cover the top.
      { rootMargin: "-96px 0px 0px 0px", threshold: [0, 0.4] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activeBannerSubheading =
    activeEntry?.label !== undefined ? activeSeatView?.name : activeSubheading;

  const victorPlayer =
    victor !== null && playerViews ? playerViews[victor] : undefined;

  // Dismissable victory hero. The user can tap-anywhere / X / Esc
  // to close the celebratory overlay and reveal the timer view
  // again (e.g. to check the final scoreboard or undo). Reset
  // whenever a new victor is declared so the banner re-fires.
  const [victorDismissed, setVictorDismissed] = useState(false);
  useEffect(() => {
    if (victor === null) setVictorDismissed(false);
  }, [victor]);

  // Stop the timer the moment a victor is declared so the banner
  // doesn't sit over a still-running countdown.
  useEffect(() => {
    if (victor !== null) pause();
  }, [victor, pause]);

  const showVictoryHero = victorPlayer != null && !victorDismissed;

  const hasPlayers = (players?.length ?? 0) > 0;
  const [renamingPlayers, setRenamingPlayers] = useState(false);
  const scoresVisible = scoreConfig !== undefined && hasPlayers;

  const entryControls = useTurnEntryControls({
    state,
    players: playerViews ?? [],
    run: runHostCommand,
    disabled: victor !== null,
    domainTurns: state.turns.length + Math.max(0, remainingTurns),
  });

  const turnOrderPanel = entryControls.turnOrderPanel;

  // Phase controls for games with several phases, placed by PANEL_PLACEMENT.
  // The end-of-phase prompts live in useTurnEntryControls.
  const showPhaseBar = (turnPhases?.phases.length ?? 0) > 1;
  const currentPhaseLabel =
    turnPhases?.phases.find((p) => p.id === turnPhases.activeId)?.label ?? "";

  const declaredControls = state.controls ?? [];
  const panelNodes: Record<PanelId, ReactNode> = {
    turnActions:
      declaredControls.length > 0 ? (
        <TurnActions
          controls={declaredControls}
          availableIds={availableControls.map((c) => c.id)}
          onTrigger={(controlId) =>
            runHostCommand({ type: "TRIGGER_CONTROL", controlId })
          }
        />
      ) : null,
    phase:
      showPhaseBar && turnPhases ? (
        <PhaseBar
          phaseLabel={currentPhaseLabel}
          onEnd={entryControls.endPhase}
        />
      ) : null,
    turnOrder:
      turnOrderPanel && playerViews ? (
        <TurnOrderPanel
          players={playerViews}
          turnOrder={turnOrderPanel}
          scores={scores}
          scoreConfig={scoresVisible ? scoreConfig : undefined}
          onIncrement={(playerIndex, delta) =>
            runHostCommand({ type: "INCREMENT_SCORE", playerIndex, delta })
          }
        />
      ) : null,
    scores:
      (scoresVisible || turnOrderPanel?.chart) && playerViews ? (
        <ScorePanel
          players={playerViews}
          scores={scores}
          scoreConfig={scoreConfig}
          onIncrement={(playerIndex, delta) =>
            runHostCommand({ type: "INCREMENT_SCORE", playerIndex, delta })
          }
          activePlayerIndex={currentPlayerIndex}
          firedMilestones={state.firedMilestones}
          chart={turnOrderPanel?.chart}
          catchUp={!turnOrderPanel}
        />
      ) : null,
    // The slot is reserved from the start so the bar appearing after
    // the first turn moves nothing.
    timeShare: hasPlayers ? (
      <div className={styles.timeShareSlot}>
        {playerStats.length > 0 && (
          <PlayerTimeShare stats={playerStats} players={playerViews || []} />
        )}
      </div>
    ) : null,
  };

  return (
    <FullScreen
      pinnedBar
      menuExtras={
        <>
          <IconButton label="Start a new game" shape="square" onClick={open}>
            <Plus aria-hidden />
          </IconButton>
          {/* Mid-game only: while setup is open its seat list is the
              place to rename. */}
          {hasPlayers && !isOpen && (
            <IconButton
              label="Players"
              shape="square"
              onClick={() => setRenamingPlayers(true)}
            >
              <Users aria-hidden />
            </IconButton>
          )}
          {/* Not during setup: the wizard previews the theme it is
              setting up, and a switch there would change a look the table
              has not chosen yet. */}
          {!isOpen && <SchemeToggle />}
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
      {/*
        Tap-to-advance lives on the timer ring wrapper only, so the
        panels around it (controls, phase bar, scores, footer) can never
        advance a turn. preventClickCapture still guards the ring while
        the setup modal or an editable field is open.

        Layout: the ring and its banner own the centre column. The
        panels are placed in the side columns and the full-width bottom
        row by PANEL_PLACEMENT and page.module.css; on a phone the
        regions dissolve and every panel flows below the ring in a
        scrolling page.
      */}
      <div className={styles.container}>
        {modal}
        <main className={styles.centre}>
          <div className={styles.bannerRow}>
            {activeIsEntry && activeEntry && turnOrderView ? (
              <div className={styles.activePlayer}>
                <TurnEntryBanner
                  entry={activeEntry}
                  prominentKinds={turnOrderView.prominentKinds}
                  fallbackColor={activeSeatView?.color ?? "var(--color-text)"}
                  subheading={activeBannerSubheading}
                />
              </div>
            ) : activePlayer ? (
              <div
                className={styles.activePlayer}
                style={{ color: activePlayer.color }}
              >
                {/* Player meeple, tinted to the player colour via
                  mask-image. When there's no icon (Generic / no
                  setup), the player's name itself carries the
                  colour. */}
                <PlayerMeeple
                  iconSrc={activePlayer.iconSrc}
                  color={activePlayer.color}
                  silhouetteClassName={styles.activePlayerMeeple}
                />

                <span className={styles.activePlayerText}>
                  <span className={styles.activePlayerName}>
                    {activePlayer.name}
                    <span className={styles.activePlayerSuffix}>
                      {"’s turn"}
                    </span>
                  </span>
                  {activeBannerSubheading && (
                    <span className={styles.activePlayerSubheading}>
                      {activeBannerSubheading}
                    </span>
                  )}
                </span>
              </div>
            ) : (
              turnOrderView && (
                <div className={`${styles.activePlayer} ${styles.activeEmpty}`}>
                  {`Nothing in ${turnOrderView.listLabel} yet`}
                </div>
              )
            )}
          </div>
          <div className={styles.ringStage}>
            <div
              ref={ringRef}
              className={styles.timerRingWrapper}
              role="button"
              tabIndex={0}
              aria-label="Advance turn"
              onClick={() => {
                if (!ringGuarded) entryControls.advance();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !ringGuarded) {
                  e.preventDefault();
                  entryControls.advance();
                }
              }}
            >
              <TimerRing
                players={
                  playerViews && currentPlayerIndex !== null
                    ? playerViews
                    : undefined
                }
                activeIndex={currentPlayerIndex ?? undefined}
                value={(timerTotalSeconds / averageTime) * 100}
                text={
                  timerFinished ? `+${getStopwatchString()}` : getTimerString()
                }
                paused={paused}
                overtimeOpacity={
                  timerFinished ? stopwatchTotalSeconds / averageTime : 0
                }
                untimedLabel={untimedLabel}
              />
            </div>
          </div>
        </main>
        {ringOutOfView && (activeEntry || activePlayer) && (
          <div className={styles.readout} role="timer" aria-label="Turn time">
            <span className={styles.readoutName}>
              {`${activeIsEntry && activeEntry ? activeEntry.label : activePlayer?.name}’s turn`}
            </span>
            <span className={styles.readoutTime}>
              {untimedLabel ??
                (timerFinished ? `+${getStopwatchString()}` : getTimerString())}
            </span>
          </div>
        )}
        {PANEL_REGIONS.map((region) => {
          const panels = PANEL_ORDER.filter(
            (panel) => PANEL_PLACEMENT[panel] === region && panelNodes[panel],
          );
          return (
            <div key={region} className={styles.column} data-column={region}>
              {panels.map((panel) => (
                <div
                  key={panel}
                  className={styles.panel}
                  data-panel={panel}
                  // Only takes effect on a phone, where the columns
                  // dissolve and every panel shares one flow.
                  style={{ order: PANEL_ORDER.indexOf(panel) + 1 }}
                >
                  {panelNodes[panel]}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {showVictoryHero && (
        // Full-screen overlay variant — sits above the timer
        // view, dismissable via the X button, tap-anywhere, or
        // Escape key. The underlying view stays mounted so when
        // dismissed the user sees the final state.
        <VictoryBanner
          victor={{
            ...victorPlayer!,
            iconSrc: victorPlayer!.headIconSrc ?? victorPlayer!.iconSrc,
          }}
          laurelSrc={activeDef?.vpLaurelPath}
          onDismiss={() => setVictorDismissed(true)}
        />
      )}
      {pendingMilestones.length > 0 &&
        (() => {
          // Render the FIRST pending milestone — dismissal pops the
          // queue and the next one (if any) takes over on the next
          // render. Looking up the player view by index gives us
          // name + color + icon paths without re-querying metadata.
          const m = pendingMilestones[0];
          const pv = playerViews?.[m.playerIndex];
          const name = pv?.name ?? `Player ${m.playerIndex + 1}`;
          const color = pv?.color ?? "var(--color-border)";
          return (
            <EventDialog
              milestone={m}
              playerName={name}
              playerColor={color}
              playerHeadIconSrc={pv?.headIconSrc}
              playerIconSrc={pv?.iconSrc}
              onDismiss={dismissMilestone}
            />
          );
        })()}
      {pendingLeadPrompt &&
        !victor &&
        turnOrder?.roundEnd &&
        playerViews &&
        playerViews.length > 0 && (
          <LeadPrompt
            label={turnOrder.roundEnd.label}
            players={playerViews.map((pv) => ({
              name: pv.name,
              color: pv.color,
              headIconSrc: pv.headIconSrc,
              iconSrc: pv.iconSrc,
            }))}
            onPick={(seatIndex) => setLead(seatIndex)}
          />
        )}
      {entryControls.overlays}
      {renamingPlayers && !isOpen && players && (
        <PlayersSheet
          players={players}
          onRename={(playerIndex, name) =>
            runHostCommand({ type: "RENAME_PLAYER", playerIndex, name })
          }
          onClose={() => setRenamingPlayers(false)}
        />
      )}
      {mismatchedPeerVersion !== null && (
        <PeerNotice
          tone="alert"
          message="A connected phone is running a different version of Game Timer, so its taps are ignored. Reload it."
          onDismiss={() => setMismatchedPeerVersion(null)}
        />
      )}
      {!victorPlayer && (
        <Footer
          {...{
            remainingTurns,
            // The footer edits turns left; the game keeps the total.
            setExpectedTurns: (left: number) => {
              if (Number.isInteger(left) && left >= 0)
                runHostCommand({
                  type: "SET_EXPECTED_TURNS",
                  expectedTurns: state.turns.length + left,
                });
            },
            setPreventClickCapture,
            paused,
            untimed: untimedLabel !== null,
            pause: () => runHostCommand({ type: "SET_PAUSED", paused: true }),
            unpause: () =>
              runHostCommand({ type: "SET_PAUSED", paused: false }),
            remainingSeconds,
            undo: () => runHostCommand({ type: "UNDO" }),
            canUndo,
            turnsEditable: !turnsModelled,
            remainingCount,
          }}
        />
      )}
    </FullScreen>
  );
}
