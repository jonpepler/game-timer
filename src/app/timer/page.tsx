"use client";

import styles from "./page.module.css";
import { CircularProgressbar } from "react-circular-progressbar";

import "react-circular-progressbar/dist/styles.css";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Footer } from "@/components/timer/Footer";
import { FullScreen } from "@/components/FullScreen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTimer } from "@/hooks/useTimer";
import { PlayerArcs } from "@/components/timer/PlayerArcs";
import { useGameSetup } from "@/hooks/useGameSetupModal";
import {
  type GameConfig,
  type GameSetupWizardHandle,
} from "@/components/GameSetupWizard";
import { getPlayerStats } from "@/utils/getPlayerStats";
import { PlayerTimeShare } from "@/components/PlayerTimeShare";
import { ScorePanel } from "@/components/ScorePanel";
import { VictoryBanner } from "@/components/VictoryBanner";
import { EventDialog } from "@/components/EventDialog";
import { findDefinition } from "@/state/definitionRegistry";
import { Plus } from "lucide-react";
import { ShareSessionMenu } from "@/components/ShareSessionMenu";
import { SharePanel } from "@/components/SharePanel";
import {
  playerColor,
  playerHeadIcon,
  playerIcon,
  playerSubheading,
} from "@/lib/playerVisual";
import { useSessionHost } from "@/hooks/useSessionHost";
import {
  PEER_PROTOCOL_VERSION,
  type CompanionToHostMessage,
  type HostToCompanionMessage,
} from "@/state/peerProtocol";
import { createLogger } from "@/lib/logger";

const peerLog = createLogger("host-protocol");
const playersLog = createLogger("host-players");
const stateLog = createLogger("host-state");

const initialTime = 5 * 60;
const defaultExpectedTurns = 90;

export default function Home() {
  const { height, width } = useWindowSize();

  const {
    getTimerString,
    getStopwatchString,
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
    dismissMilestone,
    pendingMilestones,
  } = useTimer({
    initialTime,
    initialExpectedTurns: defaultExpectedTurns,
    height,
    width,
  });

  const players = state.players;
  // peerId → claimed playerIndex. Released when the companion disconnects.
  const [claimMap, setClaimMap] = useState<Record<string, number>>({});

  // Forward-declared wizard handle so peer SETUP_PICK messages can
  // call applyPick before useGameSetup() runs further down. The
  // wizard <ref> is set when it mounts; before then this is null
  // and SETUP_PICK is a no-op.
  const wizardHandleRef = useRef<GameSetupWizardHandle | null>(null);

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
      case "SET_PLAYER_OPTION": {
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("SET_PLAYER_OPTION rejected — no claim", { peerId });
          return;
        }
        const def = definitionId ? findDefinition(definitionId) : undefined;
        // Resolve the player-pick step that owns the option list.
        const pickStep = def?.setupSteps?.find(
          (s) => s.kind.type === "player-pick",
        );
        if (!pickStep || pickStep.kind.type !== "player-pick") {
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
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("SETUP_PICK rejected — peer hasn't claimed a seat", {
            peerId,
          });
          return;
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
      case "SEATING_REQUEST": {
        const handle = wizardHandleRef.current;
        if (!handle) {
          peerLog.warn("SEATING_REQUEST dropped — wizard not mounted", {
            peerId,
          });
          return;
        }
        // For claims, the peer is binding their identity to a seat —
        // first-come-first-served. Reject if the seat is already
        // claimed by someone else.
        if (msg.action.kind === "claim") {
          const seatIndex = msg.action.seatIndex;
          const existing = Object.entries(claimMap).find(
            ([otherPeer, idx]) => idx === seatIndex && otherPeer !== peerId,
          );
          if (existing) {
            peerLog.warn("claim rejected — seat already taken", {
              peerId,
              seatIndex,
              by: existing[0],
            });
            return;
          }
        }
        const ok = handle.applySeatingChange(msg.stepId, msg.action);
        if (!ok) {
          peerLog.warn("SEATING_REQUEST rejected by wizard", { peerId });
          return;
        }
        if (msg.action.kind === "claim") {
          setClaimMap((prev) => ({
            ...prev,
            [peerId]: (msg.action as { seatIndex: number }).seatIndex,
          }));
        } else if (msg.action.kind === "remove") {
          // The removed seat takes any claim against it with it, and
          // claims above it shift down by one so they still point at
          // the same identity.
          const removed = msg.action.seatIndex;
          setClaimMap((prev) => {
            const next: Record<string, number> = {};
            for (const [pid, idx] of Object.entries(prev)) {
              if (idx === removed) continue;
              next[pid] = idx > removed ? idx - 1 : idx;
            }
            return next;
          });
        }
        return;
      }
      case "TAP_TIMER": {
        // The companion-side equivalent of tapping the timer
        // container. Always allowed — Generic + no-tracking is the
        // primary case but it's harmless in any mode.
        resetTimer();
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
      case "RENAME_PLAYER": {
        const claimed = claimMap[peerId];
        if (claimed === undefined) {
          peerLog.warn("RENAME_PLAYER rejected — no claim", { peerId });
          return;
        }
        const existing = state.players?.[claimed];
        if (!existing) {
          peerLog.warn("RENAME_PLAYER rejected — no such player", {
            peerId,
            claimed,
          });
          return;
        }
        // Empty / whitespace-only names rejected — every other place
        // assumes player.name is something humans can show.
        const trimmed = msg.name.trim();
        if (trimmed.length === 0) {
          peerLog.warn("RENAME_PLAYER rejected — empty name", { peerId });
          return;
        }
        setPlayer(claimed, { ...existing, name: trimmed });
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
  const lastStateSentAtRef = useRef<number>(0);
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    const def = definitionId ? findDefinition(definitionId) : undefined;
    const now = Date.now();
    const message: HostToCompanionMessage = {
      type: "STATE",
      protocolVersion: PEER_PROTOCOL_VERSION,
      state,
      definition: def,
      sentAt: now,
    };
    sessionHost.send(message);
    // Diagnostic — log size and inter-broadcast interval at debug
    // level so we can spot STATE flooding without spamming the
    // default info+ filter. Serialize cost is small (one extra
    // JSON.stringify per emission); reads in the overlay.
    const bytes = JSON.stringify(message).length;
    const dt = lastStateSentAtRef.current
      ? now - lastStateSentAtRef.current
      : null;
    lastStateSentAtRef.current = now;
    stateLog.debug("broadcast", {
      bytes,
      intervalMs: dt,
      peers: peerCount,
      turns: state.turns.length,
    });
  }, [state, peerCount, sessionHost.status, sessionHost.send, definitionId]);

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
    // Score is only meaningful when player tracking is on — clear the
    // subsystem otherwise so victories can't fire against an empty roster.
    setScoreConfig(incoming.players ? definition?.score : undefined);
    // When the wizard sets autoStart (last seat just confirmed
    // their faction pick), kick the timer running immediately so
    // the table doesn't have to tap the screen to begin.
    // resetTimer() on the un-started state == start the timer.
    if (incoming.autoStart) {
      // Defer one frame so the reset above has flushed before we
      // call resetTimer, which itself reads state.
      queueMicrotask(() => resetTimer());
    }
  };

  // Peer hooks: forward the wizard's turn-based picker events to the
  // peer broker so seated companions can pick on their own screens.
  // Incoming SETUP_PICK messages route back into the wizard via
  // wizardRef.applyPick (wired below in handleCompanionMessage).
  const sessionHostSendRef = useRef(sessionHost.send);
  useEffect(() => {
    sessionHostSendRef.current = sessionHost.send;
  }, [sessionHost.send]);
  // Latest seating snapshot from the wizard — kept here so we can
  // re-broadcast SETUP_SEATING when the claim map changes (peers
  // joining/leaving a claimed seat) without waiting for the wizard
  // to re-emit. `seats` carries stable per-seat ids so we can
  // detect reorders and rewrite `claimMap` accordingly.
  const seatingSnapshotRef = useRef<{
    stepId: string;
    seats: Array<{ id: string; name: string }>;
    minPlayers: number;
    maxPlayers: number;
  } | null>(null);
  const claimMapRef = useRef(claimMap);

  const broadcastSeating = useCallback(() => {
    const snapshot = seatingSnapshotRef.current;
    if (!snapshot) return;
    // Project the peerId→seatIndex claim map onto a per-seat list of
    // claiming peer ids, with `null` for unclaimed seats.
    const claimedBy: Array<string | null> = snapshot.seats.map(() => null);
    for (const [peerId, seatIndex] of Object.entries(claimMapRef.current)) {
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
    });
  }, []);

  // Mirror claimMap into the ref so broadcastSeating reads the latest
  // value, and re-broadcast whenever the claim map changes (so other
  // companions see fresh `claimedBy`).
  useEffect(() => {
    claimMapRef.current = claimMap;
    broadcastSeating();
  }, [claimMap, broadcastSeating]);

  // Newly-connected companions also need the current seating snapshot
  // so they can see the seat list + render claim/rename/add controls
  // before the game starts.
  useEffect(() => {
    if (sessionHost.status !== "open") return;
    broadcastSeating();
  }, [peerCount, sessionHost.status, broadcastSeating]);

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
        sessionHostSendRef.current({
          type: "SETUP_TURN",
          protocolVersion: PEER_PROTOCOL_VERSION,
          stepId: info.stepId,
          seatIndex: info.seatIndex,
          optionIds: info.optionIds,
          excludedOptionIds: info.excludedOptionIds,
          definition: info.definition,
        });
      },
      onTurnEnd: (info: { stepId: string }) => {
        sessionHostSendRef.current({
          type: "SETUP_DONE",
          protocolVersion: PEER_PROTOCOL_VERSION,
          stepId: info.stepId,
        });
      },
      onSeatingChange: (info: {
        stepId: string;
        seats: Array<{ id: string; name: string }>;
        minPlayers: number;
        maxPlayers: number;
      }) => {
        // Detect seat-index permutation by comparing each new seat's
        // id to its old index. When a peer's claim points at an
        // index that no longer holds the same seat, rewrite the
        // claim to follow the seat to its new position. Skipped
        // when the previous snapshot is missing ids (first mount).
        const prevSeats = seatingSnapshotRef.current?.seats;
        if (prevSeats && prevSeats.length > 0 && info.seats.length > 0) {
          const oldIndexById = new Map<string, number>();
          prevSeats.forEach((s, i) => oldIndexById.set(s.id, i));
          const newIndexById = new Map<string, number>();
          info.seats.forEach((s, i) => newIndexById.set(s.id, i));
          let needsRewrite = false;
          for (const [, oldIdx] of Object.entries(claimMapRef.current)) {
            const stillThere = prevSeats[oldIdx]
              ? newIndexById.get(prevSeats[oldIdx].id)
              : undefined;
            if (stillThere !== oldIdx) {
              needsRewrite = true;
              break;
            }
          }
          if (needsRewrite) {
            setClaimMap((prev) => {
              const next: Record<string, number> = {};
              for (const [peerId, oldIdx] of Object.entries(prev)) {
                const seatAtOldIdx = prevSeats[oldIdx];
                if (!seatAtOldIdx) continue; // seat was removed
                const newIdx = newIndexById.get(seatAtOldIdx.id);
                if (newIdx !== undefined) next[peerId] = newIdx;
              }
              return next;
            });
          }
        }
        seatingSnapshotRef.current = info;
        broadcastSeating();
      },
    }),
    [broadcastSeating],
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

  const activeDef = definitionId ? findDefinition(definitionId) : undefined;
  const visualKey = activeDef?.playerVisualFrom;
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
        color: playerColor(p, i, visualKey),
        iconSrc: playerIcon(p, visualKey),
        headIconSrc: playerHeadIcon(p, visualKey),
      })),
    [players, visualKey],
  );

  const activePlayer =
    playerViews && currentPlayerIndex !== null
      ? playerViews[currentPlayerIndex]
      : undefined;

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
      {/*
        Tap-to-advance lives on the timer ring wrapper only — not the
        whole container — so off-ring chrome (score panel, footer,
        editable fields, banner) can't accidentally advance turns.
        preventClickCapture is now dead defence: the score buttons and
        the wizard modal aren't children of the ring, so they don't
        bubble into the handler. Kept the state in place for now in
        case a future surface ends up inside the ring and needs to
        opt out.
      */}
      <div className={styles.container}>
        {modal}
        <main className={styles.main}>
          <>
            {activePlayer && (
              <div
                className={styles.activePlayer}
                style={{ color: activePlayer.color }}
              >
                {activePlayer.iconSrc && (
                  // Faction meeple, tinted to the faction colour
                  // via mask-image. When there's no icon
                  // (Generic / no setup), the player's name
                  // itself carries the colour — no swatch needed.
                  <span
                    className={styles.activePlayerMeeple}
                    style={{
                      background: activePlayer.color,
                      WebkitMaskImage: `url(${activePlayer.iconSrc})`,
                      maskImage: `url(${activePlayer.iconSrc})`,
                    }}
                    aria-hidden
                  />
                )}
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
            )}
            <div
              className={styles.timerRingWrapper}
              role="button"
              tabIndex={0}
              aria-label="Advance turn"
              onClick={() => {
                if (!preventClickCapture) resetTimer();
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  !preventClickCapture
                ) {
                  e.preventDefault();
                  resetTimer();
                }
              }}
            >
              {playerViews && currentPlayerIndex !== null && (
                <PlayerArcs
                  players={playerViews}
                  activeIndex={currentPlayerIndex}
                />
              )}
              <CircularProgressbar
                value={(timerTotalSeconds / averageTime) * 100}
                background
                styles={{
                  // Cleaner stroke: solid (no dashes), thicker
                  // path so the ring reads with weight against
                  // the dark surface. Matches the rest of the
                  // app's chrome.
                  path: {
                    stroke: paused
                      ? "var(--color-timer-paused)"
                      : "var(--color-timer-active)",
                    strokeLinecap: "round",
                    strokeWidth: "3",
                  },
                  trail: {
                    stroke: "var(--color-border)",
                    strokeWidth: "1",
                  },
                  text: {
                    fontFamily: "inherit",
                    fontWeight: 600,
                    fill: paused
                      ? "var(--color-timer-paused)"
                      : "var(--color-text)",
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
          </>
        </main>
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
      {(scoresVisible || playerStats.length > 0) && (
        <div className={styles.playerOverlay}>
          {scoresVisible && playerViews && scoreConfig && (
            <ScorePanel
              players={playerViews}
              scores={scores}
              scoreConfig={scoreConfig}
              onIncrement={incrementScore}
              activePlayerIndex={currentPlayerIndex}
              firedMilestones={state.firedMilestones}
            />
          )}
          {playerStats.length > 0 && (
            <PlayerTimeShare stats={playerStats} players={playerViews || []} />
          )}
        </div>
      )}
      {!victorPlayer && (
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
      )}
    </FullScreen>
  );
}
