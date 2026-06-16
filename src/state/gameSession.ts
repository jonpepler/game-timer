import { createLogger } from "@/lib/logger";
import type { ScoreConfig, TurnOrder } from "./gameDefinition";

const log = createLogger("session");

// Open-ended metadata bag a setup step can attach to a player. The
// app code never reads specific keys directly — renderers consult
// definition.playerVisualFrom (a string declared in the JSON) to find
// where to source the player's colour / label. Future steps can stash
// any data they need under their step id.
export type PlayerMetadataValue =
  | {
      type: "selected-option";
      optionId: string;
      label: string;
      color?: string;
      description?: string;
      // Optional path to a per-option icon (e.g. faction meeple SVG)
      // relative to the deployment's basePath. Renderers project this
      // onto an <img src>. Carried in the metadata bag so the runtime
      // Player keeps all the visual data the option supplied.
      iconSrc?: string;
      // Optional path to a per-option HEAD icon (portrait crop, used
      // by the score panel + victory hero where the full-body
      // silhouette is too tall). Falls back to `iconSrc` when
      // unavailable.
      headIconSrc?: string;
    }
  | { type: "scalar"; value: string | number | boolean };

export interface Player {
  // The player's chosen display name. Defaults to "Player N", may be
  // overridden by a setup step (e.g. a side-pick step sets it to the
  // picked option's label) or edited at any time by the user.
  name: string;
  // Generic metadata bag keyed by setup-step id. Renderers don't read
  // specific keys directly — they look up the key declared by the
  // active GameDefinition.playerVisualFrom and similar config fields.
  metadata: Record<string, PlayerMetadataValue>;
}

export interface TurnRecord {
  // Round-robin player index at the time the turn ended; null when
  // player tracking is disabled.
  playerIndex: number | null;
  elapsedSeconds: number;
  // Epoch ms when the turn began.
  startedAt: number;
}

export interface GameSessionState {
  started: boolean;
  turns: TurnRecord[];
  // Countdown length used for the next turn, in seconds.
  averageSeconds: number;
  // The starting countdown length. Used as the fallback when undoing back
  // to zero turns — without it, undo-to-empty would freeze whatever
  // average was last computed instead of returning to the original setup.
  initialAverageSeconds: number;
  expectedTurns: number;
  players?: Player[];
  currentTurnStartedAt: number | null;
  // Scores keyed by playerIndex. Missing entries treated as the score
  // config's `min` (or 0 when no config is set).
  scores: Record<number, number>;
  // Active score rules. Undefined when the current definition opts out
  // of score tracking.
  scoreConfig?: ScoreConfig;
  // Player index of the winner once a victory condition fires, else null.
  victor: number | null;
  // Active game definition id. Lets the page (and companions, via the
  // STATE broadcast) resolve the full definition for faction lookups,
  // setup-schema rendering, etc.
  definitionId?: string;
  // Score milestones that have already fired for each player —
  // playerIndex → list of atScore values. A milestone fires at most
  // once per (player, atScore) pair; re-crossing after a fire is
  // silent.
  firedMilestones: Record<number, number[]>;
  // FIFO queue of unfilled milestone dialogs. The first entry is
  // rendered as a fullscreen modal on host + companion screens; once
  // dismissed the queue advances. Persisted so a reload doesn't drop
  // a milestone that fired but wasn't acknowledged.
  pendingMilestones: PendingMilestone[];

  // ── Lead-relative turn order (optional) ─────────────────────────
  // Only meaningful when `turnOrder.mode === "lead-relative"`; absent /
  // ignored for the default round-robin. All optional so older
  // persisted sessions (and round-robin games) load without migration.
  turnOrder?: TurnOrder;
  // The seat that leads the CURRENT round. Active seat is computed
  // relative to it (see activePlayerIndex).
  leadIndex?: number;
  // turns.length at the moment the current round began. Active offset
  // within the round is turns.length - roundStartTurnCount.
  roundStartTurnCount?: number;
  // The seat that has claimed the lead for the NEXT round via the
  // interrupt (Arcs' seize). Null until someone seizes; locks the round
  // when turnOrder.interrupt.oncePerRound is set.
  seizedNextLead?: number | null;
  // True when a round completed with no seize and the definition asks
  // to prompt the table for who took the lead. The page renders a
  // full-screen picker; resolving it dispatches SET_LEAD.
  pendingLeadPrompt?: boolean;
  // One level of lead-anchor history, captured when a round advances,
  // so a single UNDO across a round boundary restores the prior lead.
  prevLeadAnchor?: { leadIndex: number; roundStartTurnCount: number } | null;
}

export interface PendingMilestone {
  playerIndex: number;
  atScore: number;
  label: string;
}

export type GameSessionAction =
  | { type: "START"; at: number }
  | { type: "NEXT_TURN"; elapsedSeconds: number; at: number }
  | { type: "UNDO" }
  | { type: "SET_EXPECTED_TURNS"; expectedTurns: number }
  | { type: "SET_PLAYERS"; players: Player[] | undefined }
  | { type: "SET_PLAYER"; playerIndex: number; player: Player }
  | { type: "SET_SCORE_CONFIG"; scoreConfig: ScoreConfig | undefined }
  | { type: "SET_SCORE"; playerIndex: number; value: number }
  | { type: "INCREMENT_SCORE"; playerIndex: number; delta: number }
  | { type: "END_GAME"; victor: number | null }
  | { type: "SET_DEFINITION_ID"; definitionId: string | undefined }
  | { type: "DISMISS_MILESTONE" }
  // Lead-relative turn order. SET_TURN_ORDER installs the mode (and
  // resets round state); SEIZE_LEAD claims the next round for the
  // acting seat; SET_LEAD resolves the round-end prompt (or seeds the
  // initial lead) by naming the seat that now leads.
  | { type: "SET_TURN_ORDER"; turnOrder: TurnOrder | undefined }
  | { type: "SEIZE_LEAD" }
  | { type: "SET_LEAD"; seatIndex: number }
  | { type: "RESET" };

export interface GameSessionInit {
  initialAverageSeconds: number;
  expectedTurns: number;
  players?: Player[];
  scoreConfig?: ScoreConfig;
  definitionId?: string;
  turnOrder?: TurnOrder;
  // Seat chosen to lead the opening round (Arcs' initial initiative).
  leadIndex?: number;
}

export const createInitialGameSessionState = (
  params: GameSessionInit,
): GameSessionState => ({
  started: false,
  turns: [],
  averageSeconds: params.initialAverageSeconds,
  initialAverageSeconds: params.initialAverageSeconds,
  expectedTurns: params.expectedTurns,
  players: params.players,
  currentTurnStartedAt: null,
  scores: {},
  scoreConfig: params.scoreConfig,
  victor: null,
  definitionId: params.definitionId,
  firedMilestones: {},
  pendingMilestones: [],
  turnOrder: params.turnOrder,
  leadIndex: params.leadIndex ?? 0,
  roundStartTurnCount: 0,
  seizedNextLead: null,
  pendingLeadPrompt: false,
  prevLeadAnchor: null,
});

const averageOf = (turns: TurnRecord[], fallback: number): number => {
  if (turns.length === 0) return fallback;
  const total = turns.reduce((sum, t) => sum + t.elapsedSeconds, 0);
  return Math.floor(total / turns.length);
};

const nextPlayerIndexFor = (
  turnsTaken: number,
  playerCount: number | undefined,
): number | null => {
  if (!playerCount) return null;
  return turnsTaken % playerCount;
};

// Whose turn it is right now. Round-robin (the default) is purely
// positional: turns taken modulo seat count. Lead-relative anchors each
// round to a movable lead seat — the active seat is the lead plus the
// number of turns already taken in the current round. Game-agnostic:
// driven by state.turnOrder, which the definition supplies.
const activePlayerIndex = (state: GameSessionState): number | null => {
  const playerCount = state.players?.length;
  if (!playerCount) return null;
  if (state.turnOrder?.mode === "lead-relative") {
    const lead = state.leadIndex ?? 0;
    const offset = state.turns.length - (state.roundStartTurnCount ?? 0);
    return (((lead + offset) % playerCount) + playerCount) % playerCount;
  }
  return nextPlayerIndexFor(state.turns.length, playerCount);
};

// Pure helper exposed so the timer hook can compute the post-NEXT_TURN
// average synchronously (it needs the value for the imperative
// timer.restart side effect before React commits the new state).
export const projectAverageAfterTurn = (
  state: GameSessionState,
  elapsedSeconds: number,
): number => {
  const total =
    state.turns.reduce((sum, t) => sum + t.elapsedSeconds, 0) + elapsedSeconds;
  return Math.floor(total / (state.turns.length + 1));
};

// Apply score bounds + victory detection. Pure helper used by SET_SCORE
// and INCREMENT_SCORE; isolated so both branches stay in sync.
const applyScore = (
  state: GameSessionState,
  playerIndex: number,
  rawValue: number,
): GameSessionState => {
  const cfg = state.scoreConfig;
  const min = cfg?.min ?? 0;
  const max = cfg?.max;
  const clamped =
    max !== undefined
      ? Math.max(min, Math.min(max, rawValue))
      : Math.max(min, rawValue);
  const previous = state.scores[playerIndex] ?? min;
  const scores = { ...state.scores, [playerIndex]: clamped };
  let victor = state.victor;
  if (
    cfg?.victory?.type === "firstToMax" &&
    max !== undefined &&
    clamped >= max &&
    victor === null
  ) {
    victor = playerIndex;
    log.info("victory", { playerIndex, score: clamped });
  }

  // Walk any configured milestones and queue dialogs for the ones
  // newly crossed by this player. A milestone fires when the score
  // moves from below to >= atScore AND the (player, atScore) pair
  // hasn't been recorded as fired before. Decreases never fire and
  // they don't reset firedMilestones — a sequence 0 → 4 → 2 → 4
  // shows the dialog exactly once.
  let firedMilestones = state.firedMilestones;
  let pendingMilestones = state.pendingMilestones;
  const milestones = cfg?.milestones ?? [];
  if (milestones.length > 0 && clamped > previous) {
    const alreadyFiredByMe = new Set(firedMilestones[playerIndex] ?? []);
    // Pre-compute the set of atScores any player has fired so far,
    // for fire-once milestones that need game-level dedup instead
    // of the default per-player tracking.
    const firedByAnyone = new Set<number>();
    for (const arr of Object.values(firedMilestones)) {
      for (const v of arr) firedByAnyone.add(v);
    }
    const newlyFired: number[] = [];
    const newlyPending: PendingMilestone[] = [];
    for (const m of milestones) {
      if (m.atScore <= previous || m.atScore > clamped) continue;
      // fireOnce: any player crossing first locks the dialog out
      // for everyone else. Default (per-player) only blocks re-
      // fires for this specific player.
      const blocked = m.fireOnce
        ? firedByAnyone.has(m.atScore)
        : alreadyFiredByMe.has(m.atScore);
      if (blocked) continue;
      newlyFired.push(m.atScore);
      newlyPending.push({
        playerIndex,
        atScore: m.atScore,
        label: m.label,
      });
    }
    if (newlyFired.length > 0) {
      firedMilestones = {
        ...firedMilestones,
        [playerIndex]: [...(firedMilestones[playerIndex] ?? []), ...newlyFired],
      };
      pendingMilestones = [...pendingMilestones, ...newlyPending];
      log.info("milestones fired", { playerIndex, newlyFired });
    }
  }

  return {
    ...state,
    scores,
    victor,
    firedMilestones,
    pendingMilestones,
  };
};

export const gameSessionReducer = (
  state: GameSessionState,
  action: GameSessionAction,
): GameSessionState => {
  switch (action.type) {
    case "START": {
      if (state.started) return state;
      log.debug("session started", { averageSeconds: state.averageSeconds });
      return {
        ...state,
        started: true,
        currentTurnStartedAt: action.at,
      };
    }
    case "NEXT_TURN": {
      const playerIndex = activePlayerIndex(state);
      const turn: TurnRecord = {
        playerIndex,
        elapsedSeconds: action.elapsedSeconds,
        startedAt: state.currentTurnStartedAt ?? action.at,
      };
      const turns = [...state.turns, turn];
      const averageSeconds = averageOf(turns, state.averageSeconds);
      log.debug("turn recorded", {
        playerIndex,
        elapsedSeconds: action.elapsedSeconds,
        averageSeconds,
      });

      // Lead-relative round bookkeeping. A round is one turn per seat;
      // when it completes we either auto-advance the lead to whoever
      // seized, or (if no one did) flag a prompt for the table.
      const playerCount = state.players?.length;
      let leadIndex = state.leadIndex ?? 0;
      let roundStartTurnCount = state.roundStartTurnCount ?? 0;
      let seizedNextLead = state.seizedNextLead ?? null;
      let pendingLeadPrompt = state.pendingLeadPrompt ?? false;
      let prevLeadAnchor = state.prevLeadAnchor ?? null;
      if (
        state.turnOrder?.mode === "lead-relative" &&
        playerCount &&
        turns.length - roundStartTurnCount >= playerCount
      ) {
        if (seizedNextLead != null) {
          prevLeadAnchor = { leadIndex, roundStartTurnCount };
          leadIndex = seizedNextLead;
          roundStartTurnCount = turns.length;
          seizedNextLead = null;
        } else if (state.turnOrder.roundEnd) {
          // Pause for the table to name the next lead (the timer page
          // overlays a full-screen picker until SET_LEAD resolves it).
          pendingLeadPrompt = true;
        } else {
          // No interrupt fired and no prompt configured: lead stays,
          // round simply rolls over.
          prevLeadAnchor = { leadIndex, roundStartTurnCount };
          roundStartTurnCount = turns.length;
        }
      }

      return {
        ...state,
        started: true,
        turns,
        averageSeconds,
        currentTurnStartedAt: action.at,
        leadIndex,
        roundStartTurnCount,
        seizedNextLead,
        pendingLeadPrompt,
        prevLeadAnchor,
      };
    }
    case "UNDO": {
      if (state.turns.length === 0) return state;
      const turns = state.turns.slice(0, -1);
      const popped = state.turns[state.turns.length - 1];
      // Fall back to the original average when all turns are gone so the
      // session looks like it did at start, not "frozen at the last
      // rolling average."
      const averageSeconds = averageOf(turns, state.initialAverageSeconds);
      log.debug("turn undone", {
        restoredPlayerIndex: popped.playerIndex,
        averageSeconds,
      });

      // Lead-relative: a seize or round-end resolution that hadn't been
      // confirmed is reverted, and a single step back across a round
      // boundary restores the prior lead anchor (one level of history).
      let leadIndex = state.leadIndex ?? 0;
      let roundStartTurnCount = state.roundStartTurnCount ?? 0;
      let prevLeadAnchor = state.prevLeadAnchor ?? null;
      if (state.turnOrder?.mode === "lead-relative") {
        if (turns.length < roundStartTurnCount) {
          if (prevLeadAnchor) {
            leadIndex = prevLeadAnchor.leadIndex;
            roundStartTurnCount = prevLeadAnchor.roundStartTurnCount;
          } else {
            roundStartTurnCount = turns.length;
          }
          prevLeadAnchor = null;
        }
      }

      return {
        ...state,
        turns,
        averageSeconds,
        currentTurnStartedAt: popped.startedAt,
        leadIndex,
        roundStartTurnCount,
        seizedNextLead: null,
        pendingLeadPrompt: false,
        prevLeadAnchor,
      };
    }
    case "SET_EXPECTED_TURNS":
      return { ...state, expectedTurns: action.expectedTurns };
    case "SET_PLAYERS":
      return { ...state, players: action.players };
    case "SET_PLAYER": {
      if (!state.players) return state;
      if (action.playerIndex < 0 || action.playerIndex >= state.players.length)
        return state;
      const players = state.players.map((p, i) =>
        i === action.playerIndex ? action.player : p,
      );
      return { ...state, players };
    }
    case "SET_DEFINITION_ID":
      return { ...state, definitionId: action.definitionId };
    case "SET_SCORE_CONFIG":
      // Clearing the score subsystem also clears any in-flight scores
      // and victor — a different game's score is meaningless here.
      // Milestone state is config-bound too, so reset it.
      return {
        ...state,
        scoreConfig: action.scoreConfig,
        scores: {},
        victor: null,
        firedMilestones: {},
        pendingMilestones: [],
      };
    case "DISMISS_MILESTONE":
      if (state.pendingMilestones.length === 0) return state;
      return {
        ...state,
        pendingMilestones: state.pendingMilestones.slice(1),
      };
    case "SET_TURN_ORDER":
      // Installing a turn order resets all round state — a fresh
      // game's opening round starts from the seeded lead (seat 0
      // until a later SET_LEAD overrides it).
      return {
        ...state,
        turnOrder: action.turnOrder,
        leadIndex: 0,
        roundStartTurnCount: state.turns.length,
        seizedNextLead: null,
        pendingLeadPrompt: false,
        prevLeadAnchor: null,
      };
    case "SEIZE_LEAD": {
      if (state.turnOrder?.mode !== "lead-relative") return state;
      if (!state.turnOrder.interrupt) return state;
      // Once-per-round (the default): ignore a second seize this round.
      const oncePerRound = state.turnOrder.interrupt.oncePerRound ?? true;
      if (oncePerRound && state.seizedNextLead != null) return state;
      const active = activePlayerIndex(state);
      if (active == null) return state;
      log.info("lead seized", { seat: active });
      return { ...state, seizedNextLead: active };
    }
    case "SET_LEAD":
      // Resolves the round-end prompt (or seeds the opening lead):
      // the named seat leads from here, starting a fresh round.
      return {
        ...state,
        leadIndex: action.seatIndex,
        roundStartTurnCount: state.turns.length,
        seizedNextLead: null,
        pendingLeadPrompt: false,
        prevLeadAnchor: state.pendingLeadPrompt
          ? {
              leadIndex: state.leadIndex ?? 0,
              roundStartTurnCount: state.roundStartTurnCount ?? 0,
            }
          : (state.prevLeadAnchor ?? null),
      };
    case "SET_SCORE":
      return applyScore(state, action.playerIndex, action.value);
    case "INCREMENT_SCORE": {
      const min = state.scoreConfig?.min ?? 0;
      const current = state.scores[action.playerIndex] ?? min;
      return applyScore(state, action.playerIndex, current + action.delta);
    }
    case "END_GAME":
      log.info("game ended", { victor: action.victor });
      return { ...state, victor: action.victor };
    case "RESET":
      return createInitialGameSessionState({
        initialAverageSeconds: state.initialAverageSeconds,
        expectedTurns: state.expectedTurns,
        players: state.players,
        scoreConfig: state.scoreConfig,
        definitionId: state.definitionId,
        turnOrder: state.turnOrder,
      });
  }
};

// Selectors

export const selectRemainingTurns = (state: GameSessionState): number =>
  state.expectedTurns - state.turns.length;

export const selectCurrentPlayerIndex = (
  state: GameSessionState,
): number | null => activePlayerIndex(state);

// Whether the acting seat may still seize this round (interrupt
// configured, lead-relative, and not already seized when once-per-round).
export const selectCanSeize = (state: GameSessionState): boolean => {
  if (state.turnOrder?.mode !== "lead-relative") return false;
  const interrupt = state.turnOrder.interrupt;
  if (!interrupt) return false;
  if (state.pendingLeadPrompt) return false;
  const oncePerRound = interrupt.oncePerRound ?? true;
  return !(oncePerRound && state.seizedNextLead != null);
};

export const selectTurnElapsedSecondsList = (
  state: GameSessionState,
): number[] => state.turns.map((t) => t.elapsedSeconds);

export const selectScoreFor = (
  state: GameSessionState,
  playerIndex: number,
): number => state.scores[playerIndex] ?? state.scoreConfig?.min ?? 0;
