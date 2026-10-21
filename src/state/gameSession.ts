import { createLogger } from "@/lib/logger";
import { flatLabel, type NameParts } from "./entryIdentity";
import type { Control, ScoreConfig, TurnOrder } from "./gameDefinition";
import {
  actsInPhase,
  defaultNextPhaseId,
  entryAfter,
  findEntry,
  findPhase,
  floorToTrack,
  isValueOrdered,
  listContaining,
  listDecl,
  listForPhase,
  listIdForEntry,
  replaceList,
  resolveLists,
  phaseVisitsAfter,
  resolvePhases,
  seatEntryId,
  seedVariableOrder,
  stepAlongTrack,
  type TurnEntry,
  type TurnEntryInput,
  TurnEntrySchema,
  type TurnListState,
  type PhaseStart,
  type UndoSnapshot,
  type ValuePoint,
  valueOrderOf,
  reordersEqualValues,
  equalValueSpan,
  valueSlot,
  type VariableOrderState,
} from "./turnLists";

export {
  floorToTrack,
  seatEntryId,
  stepAlongTrack,
  type TurnEntry,
  type TurnEntryInput,
  type ValuePoint,
};

// Oldest undo snapshots are dropped beyond this, after which UNDO falls
// back to popping recorded turns.
const UNDO_LIMIT = 60;

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
  // The player the turn is attributed to: the active seat for
  // round-robin / lead-relative, or the acting entry's linked player for
  // variable order. Null when player tracking is disabled or the entry
  // has no player.
  playerIndex: number | null;
  elapsedSeconds: number;
  // Epoch ms when the turn began.
  startedAt: number;
  // Variable order only: the phase the turn was played in, the entry
  // that took it, and that list's order when the turn ended. UNDO
  // restores all three, which is what makes undo work across reorders,
  // activation changes and phase changes.
  phaseId?: string;
  entryId?: string;
  orderBefore?: string[];
  /**
   * Set when the acting entry's kind declares untimed turns. Such a turn
   * records zero seconds and is left out of every average, so it never
   * moves the countdown or anyone's time share.
   */
  untimed?: true;
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
  // The seat that has claimed the lead for the NEXT round through a
  // claim-next-lead control. Null until a seat claims it.
  claimedNextLead?: number | null;
  // True when a round completed with no claim and the definition asks
  // to prompt the table for who took the lead. The page renders a
  // full-screen picker; resolving it dispatches SET_LEAD.
  pendingLeadPrompt?: boolean;
  // One level of lead-anchor history, captured when a round advances,
  // so a single UNDO across a round boundary restores the prior lead.
  prevLeadAnchor?: { leadIndex: number; roundStartTurnCount: number } | null;

  // ── Controls (optional) ─────────────────────────────────────────
  // Turn actions the definition offers. Held in state (like turnOrder)
  // so the reducer and companions can check availability without the
  // definition. See selectAvailableControls.
  controls?: Control[];
  // Ids of controls used since the current round began, for the
  // once-per-round limit.
  controlsUsedThisRound?: string[];

  // ── Variable turn order (optional) ──────────────────────────────
  // Only meaningful when `turnOrder.mode === "variable"`. See
  // turnLists.ts for the rules.
  // Every entry the session knows about, active or not.
  turnEntries?: TurnEntry[];
  // Each declared list's current order and position.
  turnLists?: TurnListState[];
  // The running phase, which picks the list turns advance through.
  activePhaseId?: string;
  // True when a list declared `onRoundEnd: "prompt-phase"` just wrapped,
  // or every entry of a value-ordered list has played, so the table
  // should be asked which phase comes next.
  pendingPhasePrompt?: boolean;
  // This cycle's visits to the running phase, for its default successor,
  // and to every phase (see phaseVisitsAfter).
  phaseRun?: number;
  phaseVisits?: Record<string, number>;
  // Every phase started this game (see VariableOrderState.phaseLog).
  phaseLog?: PhaseStart[];
  // Every entry value set during the game, oldest first.
  valueHistory?: ValuePoint[];
  // Variable order only: the session as it stood before each undoable
  // action, newest last. UNDO restores the newest one.
  undoStack?: UndoSnapshot[];
  // Counts every change the reducer makes, so a command can name the
  // exact state it was built against. Absent until the first change.
  revision?: number;
}

export interface PendingMilestone {
  playerIndex: number;
  atScore: number;
  label: string;
}

/**
 * Undoable actions that carry the same `undoGroup` id, dispatched one
 * after another, form one undo event: only the first stores a snapshot,
 * so a single UNDO takes the whole group back. Actions without an id are
 * each their own event. Ids must be unique per group (see newUndoGroup).
 */
export interface UndoGroupTag {
  undoGroup?: string;
}

export type GameSessionAction = (
  | { type: "START"; at: number }
  // `valueStepId` names the declared value step that applies to the
  // entry whose turn is ending (phases with `valueStepOnTurnEnd`).
  | {
      type: "NEXT_TURN";
      elapsedSeconds: number;
      at: number;
      valueStepId?: string;
    }
  | { type: "UNDO" }
  | { type: "SET_EXPECTED_TURNS"; expectedTurns: number }
  // The countdown before any turn is recorded, and what undo back to no
  // turns returns to. A countdown already running is left alone.
  | { type: "SET_STARTING_AVERAGE"; seconds: number }
  | { type: "SET_PLAYERS"; players: Player[] | undefined }
  | { type: "SET_PLAYER"; playerIndex: number; player: Player }
  | { type: "SET_SCORE_CONFIG"; scoreConfig: ScoreConfig | undefined }
  | { type: "SET_SCORE"; playerIndex: number; value: number }
  | { type: "INCREMENT_SCORE"; playerIndex: number; delta: number }
  | { type: "END_GAME"; victor: number | null }
  | { type: "SET_DEFINITION_ID"; definitionId: string | undefined }
  | { type: "DISMISS_MILESTONE" }
  // Lead-relative turn order. SET_TURN_ORDER installs the mode (and
  // resets round state); SET_LEAD resolves the round-end prompt (or
  // seeds the initial lead) by naming the seat that now leads.
  | { type: "SET_TURN_ORDER"; turnOrder: TurnOrder | undefined }
  | { type: "SET_LEAD"; seatIndex: number }
  // Controls. SET_CONTROLS installs the definition's controls;
  // TRIGGER_CONTROL applies one control's effect on behalf of the active
  // seat, and is ignored unless the control is currently available.
  | { type: "SET_CONTROLS"; controls: Control[] | undefined }
  | { type: "TRIGGER_CONTROL"; controlId: string }
  // Variable turn order. Reorder moves one entry within its list; the
  // active entry never changes as a result. Activate puts an entry into
  // a list (its membership list unless `listId` is given), at the end
  // unless `toIndex` is given, registering it first when the id is new.
  // Deactivate takes an entry out of its list; if it was active the turn
  // passes to the entry after it. SET_TURN_ENTRY_PLAYER links an entry
  // to the player its turns are attributed to. SET_PHASE switches the
  // running phase, restarting its list from the top, or from
  // `firstEntryId` (rotated to the top) when given.
  // DISMISS_PHASE_PROMPT keeps the current phase going after its list
  // wrapped.
  | { type: "REORDER_TURN_ENTRY"; entryId: string; toIndex: number }
  | {
      type: "ACTIVATE_TURN_ENTRY";
      entry: TurnEntryInput;
      listId?: string;
      toIndex?: number;
    }
  | { type: "DEACTIVATE_TURN_ENTRY"; entryId: string }
  // `elapsedSeconds` is the running turn's time so far: when an entry is
  // mid-turn it is recorded as that entry's turn before switching.
  // `exitFirstEntryId` moves that entry to the top of the outgoing
  // phase's list, so its next visit starts there.
  | {
      type: "SET_PHASE";
      phaseId: string;
      at: number;
      firstEntryId?: string;
      elapsedSeconds?: number;
      exitFirstEntryId?: string;
    }
  | { type: "DISMISS_PHASE_PROMPT" }
  | {
      type: "SET_TURN_ENTRY_PLAYER";
      entryId: string;
      playerIndex: number | null;
    }
  // Sets an entry's value outside its turn; a value-ordered list
  // re-sorts at once.
  | { type: "SET_ENTRY_VALUE"; entryId: string; value: number }
  // Takes the source entries out of play and brings the target in with
  // the given owner and value, named after the sources in `sourceIds`
  // order (see combineEntries). A source that is mid-turn has its time
  // so far recorded first, like a phase switch.
  | {
      type: "COMBINE_TURN_ENTRIES";
      sourceIds: string[];
      targetId: string;
      playerIndex: number | null;
      value?: number;
      at: number;
      elapsedSeconds?: number;
    }
  | { type: "RESET" }
) &
  UndoGroupTag;

let undoGroupCounter = 0;

/** A fresh id for a group of actions that should undo as one. */
export const newUndoGroup = (): string =>
  `g${Date.now().toString(36)}-${(undoGroupCounter++).toString(36)}`;

export interface GameSessionInit {
  initialAverageSeconds: number;
  expectedTurns: number;
  players?: Player[];
  scoreConfig?: ScoreConfig;
  definitionId?: string;
  turnOrder?: TurnOrder;
  // Seat chosen to lead the opening round.
  leadIndex?: number;
  controls?: Control[];
}

const EMPTY_VARIABLE_SLICE = {
  turnEntries: undefined,
  turnLists: undefined,
  activePhaseId: undefined,
  pendingPhasePrompt: undefined,
  phaseRun: undefined,
  phaseVisits: undefined,
  phaseLog: undefined,
  valueHistory: undefined,
  undoStack: undefined,
};

// The variable-order fields to install for a turn order: seeded from
// the definition and seats in variable mode, cleared otherwise.
const seedSlice = (
  turnOrder: TurnOrder | undefined,
  players: Player[] | undefined,
  leadIndex = 0,
) =>
  turnOrder?.mode === "variable"
    ? {
        ...seedVariableOrder(turnOrder, players?.length ?? 0, leadIndex),
        pendingPhasePrompt: false,
        phaseRun: 1,
        valueHistory: [],
        undoStack: [],
      }
    : EMPTY_VARIABLE_SLICE;

export const createInitialGameSessionState = (
  params: GameSessionInit,
): GameSessionState =>
  withOpeningAverage(initialStateWithoutOpeningAverage(params));

const initialStateWithoutOpeningAverage = (
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
  claimedNextLead: null,
  pendingLeadPrompt: false,
  prevLeadAnchor: null,
  controls: params.controls,
  controlsUsedThisRound: [],
  ...seedSlice(params.turnOrder, params.players, params.leadIndex),
});

export const variableSlice = (
  state: GameSessionState,
): VariableOrderState | null => {
  if (state.turnOrder?.mode !== "variable") return null;
  const {
    turnEntries,
    turnLists,
    activePhaseId,
    phaseRun,
    phaseVisits,
    phaseLog,
  } = state;
  if (!turnEntries || !turnLists || activePhaseId === undefined) return null;
  return {
    turnEntries,
    turnLists,
    activePhaseId,
    phaseRun: phaseRun ?? 1,
    phaseVisits: phaseVisits ?? { [activePhaseId]: phaseRun ?? 1 },
    phaseLog: phaseLog ?? [{ phaseId: activePhaseId, atTurn: 0 }],
  };
};

export const averageOf = (turns: TurnRecord[], fallback: number): number => {
  const timed = turns.filter((t) => !t.untimed);
  if (timed.length === 0) return fallback;
  const total = timed.reduce((sum, t) => sum + t.elapsedSeconds, 0);
  return Math.floor(total / timed.length);
};

// Variable order keeps one running average per phase, because phases
// can have very different turn lengths. A phase with no turns yet uses
// its declared `averageSeconds`, else the session's starting value.
export const phaseAverage = (
  state: GameSessionState,
  turns: TurnRecord[],
  phaseId: string,
): number => {
  const declared =
    state.turnOrder && findPhase(state.turnOrder, phaseId)?.averageSeconds;
  return averageOf(
    turns.filter((t) => t.phaseId === phaseId),
    declared ?? state.initialAverageSeconds,
  );
};

/**
 * The countdown for a session's first turn: the opening phase's
 * declared average in variable order, else the starting average.
 */
const openingAverage = (state: GameSessionState): number => {
  const slice = variableSlice(state);
  return slice
    ? phaseAverage(state, [], slice.activePhaseId)
    : state.initialAverageSeconds;
};

/** Re-seeds the countdown from the opening average while it is not yet running. */
function withOpeningAverage(state: GameSessionState): GameSessionState {
  return state.started || state.turns.length > 0
    ? state
    : { ...state, averageSeconds: openingAverage(state) };
}

// Whose turn it is right now. Round-robin (the default) is purely
// positional: turns taken modulo seat count. Lead-relative anchors each
// round to a movable lead seat — the active seat is the lead plus the
// number of turns already taken in the current round. Game-agnostic:
// driven by state.turnOrder, which the definition supplies.
const activePlayerIndex = (state: GameSessionState): number | null => {
  const playerCount = state.players?.length;
  if (!playerCount) return null;
  const slice = variableSlice(state);
  if (slice && state.turnOrder) {
    const list = listForPhase(state.turnOrder, slice);
    return findEntry(slice, list?.activeEntryId)?.playerIndex ?? null;
  }
  // Round-robin and lead-relative both count turns from the lead's seat;
  // round-robin's lead only moves when setup names it.
  const lead = state.leadIndex ?? 0;
  const offset = state.turns.length - (state.roundStartTurnCount ?? 0);
  const step = state.turnOrder?.direction === "reverse-seat-order" ? -1 : 1;
  return (((lead + step * offset) % playerCount) + playerCount) % playerCount;
};

// Pure helper exposed so the timer hook can compute the post-NEXT_TURN
// average synchronously (it needs the value for the imperative
// timer.restart side effect before React commits the new state).
export const projectAverageAfterTurn = (
  state: GameSessionState,
  elapsedSeconds: number,
): number =>
  gameSessionReducer(state, { type: "NEXT_TURN", elapsedSeconds, at: 0 })
    .averageSeconds;

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

// Actions after which a turn-limit victory is re-judged.
const TURN_LIMIT_JUDGED = new Set<GameSessionAction["type"]>([
  "NEXT_TURN",
  "UNDO",
  "SET_EXPECTED_TURNS",
  "SET_SCORE",
  "INCREMENT_SCORE",
  "SET_PHASE",
  "COMBINE_TURN_ENTRIES",
]);

/**
 * The seat with the highest score, the earliest seat among equals.
 * Seats without a score count as the score config's `min`.
 */
const highestScorer = (state: GameSessionState, seatCount: number): number => {
  const min = state.scoreConfig?.min ?? 0;
  let best = 0;
  for (let i = 1; i < seatCount; i++) {
    if ((state.scores[i] ?? min) > (state.scores[best] ?? min)) best = i;
  }
  return best;
};

/**
 * Under a `highestAtTurnLimit` victory the game ends once the recorded
 * turns reach the expected turns, and the highest score wins. At the
 * limit a score correction re-ranks the victor; dropping back below it
 * (an undo, or more expected turns) reopens the game.
 */
const withTurnLimitVictory = (
  state: GameSessionState,
  action: GameSessionAction,
): GameSessionState => {
  if (state.scoreConfig?.victory?.type !== "highestAtTurnLimit") return state;
  if (!TURN_LIMIT_JUDGED.has(action.type)) return state;
  const seatCount = state.players?.length ?? 0;
  if (seatCount === 0) return state;
  const reached =
    state.expectedTurns > 0 && state.turns.length >= state.expectedTurns;
  const victor = reached ? highestScorer(state, seatCount) : null;
  if (victor === state.victor) return state;
  if (victor !== null) log.info("victory at turn limit", { victor });
  return { ...state, victor };
};

// Variable-order actions that UNDO can take back one at a time.
const UNDOABLE = new Set<GameSessionAction["type"]>([
  "NEXT_TURN",
  "REORDER_TURN_ENTRY",
  "ACTIVATE_TURN_ENTRY",
  "DEACTIVATE_TURN_ENTRY",
  "SET_TURN_ENTRY_PLAYER",
  "SET_PHASE",
  "SET_ENTRY_VALUE",
  "COMBINE_TURN_ENTRIES",
]);

const snapshotOf = (
  state: GameSessionState,
  slice: VariableOrderState,
  undoGroup: string | undefined,
): UndoSnapshot => ({
  ...slice,
  ...(undoGroup !== undefined ? { undoGroup } : {}),
  pendingPhasePrompt: state.pendingPhasePrompt ?? false,
  turnCount: state.turns.length,
  historyLength: state.valueHistory?.length ?? 0,
  currentTurnStartedAt: state.currentTurnStartedAt,
});

/**
 * Put the session back as it stood before the newest undoable action:
 * the variable-order slice wholesale, and any turns or value points
 * recorded since then dropped.
 */
const restoreSnapshot = (
  state: GameSessionState,
  snapshot: UndoSnapshot,
): GameSessionState => {
  const {
    turnCount,
    historyLength,
    pendingPhasePrompt,
    currentTurnStartedAt,
    undoGroup: _group,
    ...slice
  } = snapshot;
  const turns = state.turns.slice(0, turnCount);
  log.debug("undo", { turnCount, phaseId: slice.activePhaseId });
  return {
    ...state,
    ...slice,
    turns,
    pendingPhasePrompt,
    currentTurnStartedAt:
      turns.length === state.turns.length && state.started
        ? state.currentTurnStartedAt
        : currentTurnStartedAt,
    averageSeconds: phaseAverage(state, turns, slice.activePhaseId),
    valueHistory: (state.valueHistory ?? []).slice(0, historyLength),
    undoStack: (state.undoStack ?? []).slice(0, -1),
  };
};

export const gameSessionReducer = (
  state: GameSessionState,
  action: GameSessionAction,
): GameSessionState => {
  const next = withTurnLimitVictory(reduceWithUndo(state, action), action);
  return next === state
    ? state
    : { ...next, revision: (state.revision ?? 0) + 1 };
};

const reduceWithUndo = (
  state: GameSessionState,
  action: GameSessionAction,
): GameSessionState => {
  const next = reduceSession(state, action);
  if (next === state || !UNDOABLE.has(action.type)) return next;
  const slice = variableSlice(state);
  if (!slice) return next;
  const stack = state.undoStack ?? [];
  // A later action of the group already captured by the top snapshot.
  if (
    action.undoGroup !== undefined &&
    stack.at(-1)?.undoGroup === action.undoGroup
  )
    return next;
  return {
    ...next,
    undoStack: [...stack, snapshotOf(state, slice, action.undoGroup)].slice(
      -UNDO_LIMIT,
    ),
  };
};

const reduceSession = (
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
      const slice = variableSlice(state);
      const list =
        slice && state.turnOrder
          ? listForPhase(state.turnOrder, slice)
          : undefined;
      if (slice && list && state.turnOrder) {
        if (isValueOrdered(state.turnOrder, list.id)) {
          // Everyone has played: there is no turn to end, only the
          // question of what comes next.
          if (list.activeEntryId === null)
            return { ...state, pendingPhasePrompt: true };
          return endValueOrderedTurn(state, state.turnOrder, action);
        }
      }
      const recorded = recordTurn(state, action.elapsedSeconds, action.at);
      const { turns } = recorded;

      // Lead-relative round bookkeeping. A round is one turn per seat;
      // when it completes we either auto-advance the lead to whoever
      // claimed it, or (if no one did) flag a prompt for the table.
      const playerCount = state.players?.length;
      let leadIndex = state.leadIndex ?? 0;
      let roundStartTurnCount = state.roundStartTurnCount ?? 0;
      let claimedNextLead = state.claimedNextLead ?? null;
      let controlsUsedThisRound = state.controlsUsedThisRound ?? [];
      let pendingLeadPrompt = state.pendingLeadPrompt ?? false;
      let prevLeadAnchor = state.prevLeadAnchor ?? null;
      if (
        state.turnOrder?.mode === "lead-relative" &&
        playerCount &&
        turns.length - roundStartTurnCount >= playerCount
      ) {
        controlsUsedThisRound = [];
        if (claimedNextLead != null) {
          prevLeadAnchor = { leadIndex, roundStartTurnCount };
          leadIndex = claimedNextLead;
          roundStartTurnCount = turns.length;
          claimedNextLead = null;
        } else if (state.turnOrder.roundEnd) {
          // Pause for the table to name the next lead (the timer page
          // overlays a full-screen picker until SET_LEAD resolves it).
          pendingLeadPrompt = true;
        } else {
          // Nobody claimed the lead and no prompt is configured: lead stays,
          // round simply rolls over.
          prevLeadAnchor = { leadIndex, roundStartTurnCount };
          roundStartTurnCount = turns.length;
        }
      }

      return {
        ...recorded,
        leadIndex,
        roundStartTurnCount,
        claimedNextLead,
        controlsUsedThisRound,
        pendingLeadPrompt,
        prevLeadAnchor,
        ...(slice && list && state.turnOrder
          ? advanceList(state.turnOrder, slice, list)
          : {}),
      };
    }
    case "UNDO": {
      const snapshot = state.undoStack?.at(-1);
      if (snapshot && variableSlice(state))
        return restoreSnapshot(state, snapshot);
      if (state.turns.length === 0) return state;
      const turns = state.turns.slice(0, -1);
      const popped = state.turns[state.turns.length - 1];
      // Fall back to the original average when all turns are gone so the
      // session looks like it did at start, not "frozen at the last
      // rolling average."
      const slice = variableSlice(state);
      const averageSeconds =
        slice && popped.phaseId !== undefined
          ? phaseAverage(state, turns, popped.phaseId)
          : averageOf(turns, state.initialAverageSeconds);
      log.debug("turn undone", {
        restoredPlayerIndex: popped.playerIndex,
        averageSeconds,
      });

      // Lead-relative: a lead claim or round-end resolution that hadn't been
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
        claimedNextLead: null,
        controlsUsedThisRound: [],
        pendingLeadPrompt: false,
        prevLeadAnchor,
        ...(slice && state.turnOrder && popped.phaseId !== undefined
          ? restoreBefore(state.turnOrder, slice, popped)
          : {}),
      };
    }
    case "SET_EXPECTED_TURNS":
      return { ...state, expectedTurns: action.expectedTurns };
    case "SET_STARTING_AVERAGE":
      return withOpeningAverage({
        ...state,
        initialAverageSeconds: action.seconds,
      });
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
      return withOpeningAverage({
        ...state,
        turnOrder: action.turnOrder,
        leadIndex: 0,
        roundStartTurnCount: state.turns.length,
        claimedNextLead: null,
        controlsUsedThisRound: [],
        pendingLeadPrompt: false,
        prevLeadAnchor: null,
        ...seedSlice(action.turnOrder, state.players),
      });
    case "SET_CONTROLS":
      return {
        ...state,
        controls: action.controls,
        controlsUsedThisRound: [],
      };
    case "TRIGGER_CONTROL": {
      const control = selectAvailableControls(state).find(
        (c) => c.id === action.controlId,
      );
      if (!control) return state;
      const applied = applyControlEffect(state, control);
      if (applied === state) return state;
      log.info("control triggered", { controlId: control.id });
      return {
        ...applied,
        controlsUsedThisRound: [
          ...(state.controlsUsedThisRound ?? []),
          control.id,
        ],
      };
    }
    case "SET_LEAD":
      // Variable order has no lead anchor: naming a lead rotates the
      // seat's list so that seat is on top and active.
      {
        const slice = variableSlice(state);
        if (slice) {
          const seat = seatEntryId(action.seatIndex);
          const list = listContaining(slice, seat);
          if (!list) return state;
          const at = list.order.indexOf(seat);
          return {
            ...state,
            ...replaceList(slice, {
              ...list,
              order: [...list.order.slice(at), ...list.order.slice(0, at)],
              activeEntryId: seat,
            }),
          };
        }
      }
      // Resolves the round-end prompt (or seeds the opening lead):
      // the named seat leads from here, starting a fresh round.
      return {
        ...state,
        leadIndex: action.seatIndex,
        roundStartTurnCount: state.turns.length,
        claimedNextLead: null,
        controlsUsedThisRound: [],
        pendingLeadPrompt: false,
        prevLeadAnchor: state.pendingLeadPrompt
          ? {
              leadIndex: state.leadIndex ?? 0,
              roundStartTurnCount: state.roundStartTurnCount ?? 0,
            }
          : (state.prevLeadAnchor ?? null),
      };
    case "REORDER_TURN_ENTRY": {
      const slice = variableSlice(state);
      const list = slice && listContaining(slice, action.entryId);
      if (!slice || !list || !state.turnOrder) return state;
      const from = list.order.indexOf(action.entryId);
      const to = Math.max(0, Math.min(list.order.length - 1, action.toIndex));
      if (to === from) return state;
      const order = list.order.filter((id) => id !== action.entryId);
      order.splice(to, 0, action.entryId);
      if (isValueOrdered(state.turnOrder, list.id)) {
        /*
         * A value-ordered list's order is its values. Where the list
         * allows it, entries sharing a value may swap places by hand, but
         * a move that would cross a different value is refused.
         */
        if (!reordersEqualValues(state.turnOrder, list.id)) return state;
        const [first, last] = equalValueSpan(
          list.order.map((id) => findEntry(slice, id)?.value),
          from,
        );
        if (to < first || to > last) return state;
        log.info("turn order changed", { entryId: action.entryId, to });
        const moved = { ...list, order };
        /*
         * While the running list's next turn is still the first unplayed
         * entry, it follows the move, so the entry now on top of its
         * value goes first.
         */
        const follows =
          list.activeEntryId !== null &&
          isRunningList(state.turnOrder, slice, list.id) &&
          list.activeEntryId === firstUnplayed(state.turnOrder, slice, list);
        return {
          ...state,
          ...replaceList(slice, {
            ...moved,
            activeEntryId: follows
              ? firstUnplayed(state.turnOrder, slice, moved)
              : list.activeEntryId,
          }),
        };
      }
      log.info("turn order changed", { entryId: action.entryId, to });
      // Before the running phase's first turn, whoever is on top plays
      // first, so setting the order at the start of a phase decides who
      // opens it. After that, a reorder never changes who is active.
      const opening =
        state.turnOrder !== undefined &&
        listForPhase(state.turnOrder, slice)?.id === list.id &&
        state.turns.at(-1)?.phaseId !== slice.activePhaseId &&
        list.activeEntryId === list.order[0];
      const activeEntryId = opening ? order[0] : list.activeEntryId;
      return {
        ...state,
        ...replaceList(slice, { ...list, order, activeEntryId }),
      };
    }
    case "ACTIVATE_TURN_ENTRY": {
      const slice = variableSlice(state);
      const turnOrder = state.turnOrder;
      if (!slice || !turnOrder) return state;
      const { id } = action.entry;
      if (listContaining(slice, id)) return state;
      const known = findEntry(slice, id);
      // A known entry keeps its identity; an owner or value given with
      // the activation is applied to it.
      const entry = known
        ? {
            ...known,
            ...(action.entry.playerIndex !== undefined
              ? { playerIndex: action.entry.playerIndex }
              : {}),
            ...(action.entry.value !== undefined
              ? { value: action.entry.value }
              : {}),
          }
        : TurnEntrySchema.parse({
            ...action.entry,
            playerIndex: action.entry.playerIndex ?? null,
          });
      const listId =
        action.listId ??
        listIdForEntry(turnOrder, entry) ??
        listForPhase(turnOrder, slice)?.id;
      const list = slice.turnLists.find((l) => l.id === listId);
      if (!list) return state;
      const turnEntries = known
        ? slice.turnEntries.map((e) => (e.id === id ? entry : e))
        : [...slice.turnEntries, entry];
      if (isValueOrdered(turnOrder, list.id)) {
        const top = joinsAtTop(turnOrder, entry)
          ? topValue(turnOrder, slice, list)
          : undefined;
        const placed =
          top === undefined
            ? turnEntries
            : turnEntries.map((e) => (e.id === id ? { ...e, value: top } : e));
        /*
         * Joining at the top while a round is under way would hand the
         * arrival the next turn ahead of entries that were waiting, so it
         * sits the rest of the round out and leads the next one.
         */
        const roundUnderway =
          top !== undefined &&
          !state.pendingPhasePrompt &&
          isRunningList(turnOrder, slice, list.id) &&
          (list.activeEntryId !== null || (list.played ?? []).length > 0);
        const joining = roundUnderway
          ? { ...list, played: [...(list.played ?? []), id] }
          : list;
        log.info("turn entry activated", {
          entryId: id,
          listId,
          top,
          roundUnderway,
        });
        return {
          ...state,
          ...placeInValueList(
            state,
            turnOrder,
            { ...slice, turnEntries: placed },
            joining,
            id,
            top !== undefined,
          ),
          valueHistory: withValuePoint(state, id, top ?? entry.value),
        };
      }
      const at =
        action.toIndex === undefined
          ? list.order.length
          : Math.max(0, Math.min(list.order.length, action.toIndex));
      const order = [...list.order.slice(0, at), id, ...list.order.slice(at)];
      log.info("turn entry activated", { entryId: id, listId, at });
      return {
        ...state,
        ...replaceList(
          { ...slice, turnEntries },
          { ...list, order, activeEntryId: list.activeEntryId ?? id },
        ),
      };
    }
    case "DEACTIVATE_TURN_ENTRY": {
      const slice = variableSlice(state);
      const list = slice && listContaining(slice, action.entryId);
      if (!slice || !list || !state.turnOrder) return state;
      if (isValueOrdered(state.turnOrder, list.id)) {
        log.info("turn entry deactivated", { entryId: action.entryId });
        return {
          ...state,
          ...removeFromValueList(state.turnOrder, slice, list, [
            action.entryId,
          ]),
        };
      }
      // The running list must keep someone to take the current turn.
      const running = listForPhase(state.turnOrder, slice)?.id === list.id;
      if (running && list.order.length <= 1) return state;
      const order = list.order.filter((id) => id !== action.entryId);
      const activeEntryId =
        list.activeEntryId === action.entryId
          ? order.length === 0
            ? null
            : entryAfter(list.order, action.entryId)
          : list.activeEntryId;
      log.info("turn entry deactivated", { entryId: action.entryId });
      return {
        ...state,
        ...replaceList(slice, { ...list, order, activeEntryId }),
      };
    }
    case "SET_TURN_ENTRY_PLAYER": {
      const slice = variableSlice(state);
      const entry = slice && findEntry(slice, action.entryId);
      if (!slice || !entry || entry.playerIndex === action.playerIndex)
        return state;
      return {
        ...state,
        turnEntries: slice.turnEntries.map((e) =>
          e.id === action.entryId
            ? { ...e, playerIndex: action.playerIndex }
            : e,
        ),
      };
    }
    case "SET_ENTRY_VALUE": {
      const slice = variableSlice(state);
      const turnOrder = state.turnOrder;
      const entry = slice && findEntry(slice, action.entryId);
      if (!slice || !turnOrder || !entry || entry.value === action.value)
        return state;
      log.info("entry value set", {
        entryId: action.entryId,
        value: action.value,
      });
      return applyValue(state, turnOrder, slice, action.entryId, action.value);
    }
    case "COMBINE_TURN_ENTRIES":
      return combineEntries(state, action);
    case "SET_PHASE": {
      const turnOrder = state.turnOrder;
      if (
        !variableSlice(state) ||
        !turnOrder ||
        !findPhase(turnOrder, action.phaseId)
      )
        return state;
      // An entry that is mid-turn has its time so far recorded, as if its
      // turn ended where the phase did.
      const before =
        action.elapsedSeconds !== undefined && turnInProgress(state)
          ? closeTurnInProgress(state, action.elapsedSeconds, action.at)
          : state;
      const slice = variableSlice(before) as VariableOrderState;
      const leaving = listForPhase(turnOrder, slice);
      const exited =
        leaving && action.exitFirstEntryId !== undefined
          ? replaceList(slice, rotateToTop(leaving, action.exitFirstEntryId))
          : slice;
      // Entering a phase runs its list from the top, after rotating a
      // named first entry there (rotation keeps the cyclic order, which
      // is what seating order means). The turn clock restarts.
      const phaseVisits = phaseVisitsAfter(
        turnOrder,
        slice.phaseVisits ?? {},
        slice.activePhaseId,
        action.phaseId,
      );
      const switched = {
        ...exited,
        activePhaseId: action.phaseId,
        phaseRun: phaseVisits[action.phaseId],
        phaseVisits,
        phaseLog: [
          ...(slice.phaseLog ?? []),
          { phaseId: action.phaseId, atTurn: before.turns.length },
        ],
      };
      const list = listForPhase(turnOrder, switched);
      if (list && isValueOrdered(turnOrder, list.id)) {
        const fresh = { ...list, played: [] };
        const first = firstUnplayed(turnOrder, switched, fresh);
        log.info("phase changed", { phaseId: action.phaseId });
        return {
          ...before,
          ...replaceList(switched, { ...fresh, activeEntryId: first }),
          pendingPhasePrompt: first === null,
          averageSeconds: phaseAverage(before, before.turns, action.phaseId),
          currentTurnStartedAt: before.started
            ? action.at
            : before.currentTurnStartedAt,
        };
      }
      log.info("phase changed", {
        phaseId: action.phaseId,
        firstEntryId: action.firstEntryId,
      });
      const started =
        list && action.firstEntryId !== undefined
          ? rotateToTop(list, action.firstEntryId)
          : list && { ...list, activeEntryId: list.order[0] ?? null };
      return {
        ...before,
        ...(started ? replaceList(switched, started) : switched),
        pendingPhasePrompt: false,
        averageSeconds: phaseAverage(before, before.turns, action.phaseId),
        currentTurnStartedAt: before.started
          ? action.at
          : before.currentTurnStartedAt,
      };
    }
    case "DISMISS_PHASE_PROMPT":
      if (!state.pendingPhasePrompt) return state;
      return { ...state, pendingPhasePrompt: false };
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
        controls: state.controls,
      });
  }
};

// Selectors

export const selectRemainingTurns = (state: GameSessionState): number =>
  state.expectedTurns - state.turns.length;

export const selectCurrentPlayerIndex = (
  state: GameSessionState,
): number | null => activePlayerIndex(state);

/**
 * The controls that can be triggered right now, in declared order.
 * Nothing is offered before the clock starts, after a victory or while
 * the table is being asked for the next lead. Each control's own
 * availability (actor, limit) and its effect's preconditions are then
 * checked. Pass `seatIndex` to ask from one seat's point of view (a
 * companion); without it the host's view is returned, which acts for
 * whichever seat is active.
 */
export const selectAvailableControls = (
  state: GameSessionState,
  seatIndex?: number,
): Control[] => {
  const controls = state.controls ?? [];
  if (controls.length === 0) return [];
  if (!state.started || state.victor !== null || state.pendingLeadPrompt)
    return [];
  const active = activePlayerIndex(state);
  const used = state.controlsUsedThisRound ?? [];
  return controls.filter((control) => {
    const { actor = "active-seat", limit = "once-per-round" } =
      control.availability ?? {};
    if (actor === "active-seat") {
      if (active === null) return false;
      if (seatIndex !== undefined && seatIndex !== active) return false;
    }
    if (limit === "once-per-round" && used.includes(control.id)) return false;
    return effectApplies(state, control);
  });
};

// Whether a control's effect can act on the current state at all.
const effectApplies = (state: GameSessionState, control: Control): boolean => {
  switch (control.effect.type) {
    case "claim-next-lead":
      return state.turnOrder?.mode === "lead-relative";
  }
};

// The state after a control's effect, or `state` itself if it can't apply.
const applyControlEffect = (
  state: GameSessionState,
  control: Control,
): GameSessionState => {
  switch (control.effect.type) {
    case "claim-next-lead": {
      const active = activePlayerIndex(state);
      if (active === null) return state;
      return { ...state, claimedNextLead: active };
    }
  }
};

// Move a list's position on after a turn, flagging the phase prompt
// when the list wraps and declares `onRoundEnd: "prompt-phase"`.
const advanceList = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  list: TurnListState,
): Partial<GameSessionState> => {
  const wrapped =
    list.order.length > 0 &&
    list.order.indexOf(list.activeEntryId ?? "") === list.order.length - 1;
  const decl = resolveLists(turnOrder).find((l) => l.id === list.id);
  return {
    ...replaceList(slice, {
      ...list,
      activeEntryId: entryAfter(list.order, list.activeEntryId),
    }),
    ...(wrapped && decl?.onRoundEnd === "prompt-phase"
      ? { pendingPhasePrompt: true }
      : {}),
  };
};

/**
 * Append a turn for whoever is acting (the active seat, or the running
 * list's active entry and its owner) and recompute the running average.
 * Nothing about the order moves here.
 */
const recordTurn = (
  state: GameSessionState,
  elapsedSeconds: number,
  at: number,
): GameSessionState => {
  const playerIndex = activePlayerIndex(state);
  const slice = variableSlice(state);
  const list =
    slice && state.turnOrder ? listForPhase(state.turnOrder, slice) : undefined;
  const untimed = actingUntimedKind(state) !== undefined;
  const turn: TurnRecord = {
    playerIndex,
    elapsedSeconds: untimed ? 0 : elapsedSeconds,
    ...(untimed ? { untimed: true as const } : {}),
    startedAt: state.currentTurnStartedAt ?? at,
    ...(slice ? { phaseId: slice.activePhaseId } : {}),
    ...(list?.activeEntryId != null
      ? { entryId: list.activeEntryId, orderBefore: list.order }
      : {}),
  };
  const turns = [...state.turns, turn];
  const averageSeconds = slice
    ? phaseAverage(state, turns, slice.activePhaseId)
    : averageOf(turns, state.averageSeconds);
  log.debug("turn recorded", { playerIndex, elapsedSeconds, averageSeconds });
  return {
    ...state,
    started: true,
    turns,
    averageSeconds,
    currentTurnStartedAt: at,
  };
};

// The acting entry's kind when it declares untimed turns.
const actingUntimedKind = (state: GameSessionState) => {
  const slice = variableSlice(state);
  const turnOrder = state.turnOrder;
  if (!slice || !turnOrder) return undefined;
  const kind = findEntry(
    slice,
    listForPhase(turnOrder, slice)?.activeEntryId,
  )?.kind;
  return kind === undefined
    ? undefined
    : turnOrder.entryKinds?.find(
        (k) => k.id === kind && k.turnTiming === "untimed",
      );
};

// Whether an entry of the running list is part-way through a turn.
const turnInProgress = (state: GameSessionState): boolean => {
  const slice = variableSlice(state);
  if (!slice || !state.turnOrder || !state.started) return false;
  if (state.pendingPhasePrompt) return false;
  return listForPhase(state.turnOrder, slice)?.activeEntryId != null;
};

/**
 * Record the running entry's time so far as its turn, ahead of a phase
 * switch or of the entry leaving play. In a value-ordered list it also
 * counts as having played.
 */
const closeTurnInProgress = (
  state: GameSessionState,
  elapsedSeconds: number,
  at: number,
): GameSessionState => {
  const recorded = recordTurn(state, elapsedSeconds, at);
  const slice = variableSlice(recorded);
  const list =
    slice && state.turnOrder ? listForPhase(state.turnOrder, slice) : undefined;
  if (
    !slice ||
    !list ||
    !state.turnOrder ||
    !isValueOrdered(state.turnOrder, list.id) ||
    list.activeEntryId === null
  )
    return recorded;
  return {
    ...recorded,
    ...replaceList(slice, {
      ...list,
      played: [...(list.played ?? []), list.activeEntryId],
    }),
  };
};

// The list with `entryId` rotated to the top and active. Unknown ids
// leave the order alone and make the top entry active.
const rotateToTop = (list: TurnListState, entryId: string): TurnListState => {
  const at = list.order.indexOf(entryId);
  const order =
    at > 0 ? [...list.order.slice(at), ...list.order.slice(0, at)] : list.order;
  return { ...list, order, activeEntryId: order[0] ?? null };
};

/**
 * The highest-placed entry of a value-ordered list that has not played
 * yet and acts in the running phase, or null when there is none.
 */
const firstUnplayed = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  list: TurnListState,
  exclude?: string | null,
): string | null => {
  const phase = findPhase(turnOrder, slice.activePhaseId);
  const played = new Set(list.played ?? []);
  return (
    list.order.find(
      (id) =>
        id !== exclude &&
        !played.has(id) &&
        actsInPhase(phase, findEntry(slice, id)),
    ) ?? null
  );
};

const isRunningList = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  listId: string,
) => listForPhase(turnOrder, slice)?.id === listId;

const withValuePoint = (
  state: GameSessionState,
  entryId: string,
  value: number | undefined,
): ValuePoint[] | undefined =>
  value === undefined
    ? state.valueHistory
    : [
        ...(state.valueHistory ?? []),
        { entryId, value, turn: state.turns.length },
      ];

const joinsAtTop = (turnOrder: TurnOrder, entry: TurnEntry): boolean =>
  turnOrder.entryKinds?.some((k) => k.id === entry.kind && k.joinsAtTop) ??
  false;

/**
 * The value at the top of a value-ordered list (the highest, or the
 * lowest for a lowest-first list), or undefined when none has one.
 */
const topValue = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  list: TurnListState,
): number | undefined => {
  const values = list.order
    .map((id) => findEntry(slice, id)?.value)
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return undefined;
  return valueOrderOf(turnOrder, list.id).direction === "highest-first"
    ? Math.max(...values)
    : Math.min(...values);
};

/**
 * Put `entryId` (already registered in `slice`) at its place in a
 * value-ordered list, as the list's `valueOrder` places an arrival, or
 * above its equals when `aboveEquals` is set. When the running list has
 * nobody acting and the phase is not over, the new arrival may be the
 * one to act.
 */
const placeInValueList = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  list: TurnListState,
  entryId: string,
  aboveEquals = false,
): VariableOrderState => {
  const rest = list.order.filter((id) => id !== entryId);
  const declared = valueOrderOf(turnOrder, list.id);
  const at = valueSlot(
    rest,
    findEntry(slice, entryId)?.value,
    (id) => findEntry(slice, id)?.value,
    aboveEquals ? { ...declared, arrivals: "above-equals" } : declared,
  );
  const placed = {
    ...list,
    order: [...rest.slice(0, at), entryId, ...rest.slice(at)],
  };
  const settle =
    placed.activeEntryId === null &&
    !state.pendingPhasePrompt &&
    isRunningList(turnOrder, slice, list.id);
  return replaceList(slice, {
    ...placed,
    activeEntryId: settle
      ? firstUnplayed(turnOrder, slice, placed)
      : placed.activeEntryId,
  });
};

/**
 * Take entries out of a value-ordered list. If one of them was acting,
 * the turn passes to the highest unplayed entry; with none left in the
 * running list the phase is over.
 */
const removeFromValueList = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  list: TurnListState,
  ids: string[],
): Partial<GameSessionState> => {
  const gone = new Set(ids);
  const remaining = {
    ...list,
    order: list.order.filter((id) => !gone.has(id)),
    played: (list.played ?? []).filter((id) => !gone.has(id)),
  };
  if (list.activeEntryId === null || !gone.has(list.activeEntryId))
    return replaceList(slice, remaining);
  const running = isRunningList(turnOrder, slice, list.id);
  const next = running
    ? firstUnplayed(turnOrder, slice, remaining)
    : (remaining.order[0] ?? null);
  return {
    ...replaceList(slice, { ...remaining, activeEntryId: next }),
    ...(running && next === null ? { pendingPhasePrompt: true } : {}),
  };
};

/**
 * Give an entry a new value. In a value-ordered list it re-enters at its
 * new place, and reaching the configured `removeAt` value takes it out
 * of play. Who is acting does not change.
 */
const applyValue = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  entryId: string,
  value: number,
): GameSessionState => {
  const valued = {
    ...slice,
    turnEntries: slice.turnEntries.map((e) =>
      e.id === entryId ? { ...e, value } : e,
    ),
  };
  const valueHistory = withValuePoint(state, entryId, value);
  const list = listContaining(valued, entryId);
  if (!list || !isValueOrdered(turnOrder, list.id))
    return { ...state, ...valued, valueHistory };
  const removeAt = turnOrder.entryValues?.removeAt;
  if (removeAt !== undefined && value <= removeAt)
    return {
      ...state,
      ...removeFromValueList(turnOrder, valued, list, [entryId]),
      valueHistory,
    };
  return {
    ...state,
    ...placeInValueList(state, turnOrder, valued, list, entryId),
    valueHistory,
  };
};

/**
 * End the acting entry's turn in a value-ordered list: record it, apply
 * the chosen value step, mark it played and hand the turn to the
 * highest-placed entry that has not played. When nobody is left the
 * phase is over and the table is asked what comes next.
 */
const endValueOrderedTurn = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  action: Extract<GameSessionAction, { type: "NEXT_TURN" }>,
): GameSessionState => {
  const recorded = recordTurn(state, action.elapsedSeconds, action.at);
  const slice = variableSlice(recorded) as VariableOrderState;
  const list = listForPhase(turnOrder, slice) as TurnListState;
  const actingId = list.activeEntryId as string;
  const played = { ...list, played: [...(list.played ?? []), actingId] };
  let after: GameSessionState = {
    ...recorded,
    ...replaceList(slice, played),
  };
  const values = turnOrder.entryValues;
  const step = values?.steps.find((s) => s.id === action.valueStepId);
  if (values && step) {
    const entry = findEntry(slice, actingId);
    const afterSlice = variableSlice(after) as VariableOrderState;
    if (step.effect === "remove") {
      after = {
        ...after,
        ...removeFromValueList(turnOrder, afterSlice, played, [actingId]),
      };
    } else {
      const from = entry?.value ?? values.track[0];
      after = applyValue(
        after,
        turnOrder,
        afterSlice,
        actingId,
        stepAlongTrack(values.track, from, step.spaces),
      );
    }
    log.info("value step applied", { entryId: actingId, stepId: step.id });
  }
  const finalSlice = variableSlice(after) as VariableOrderState;
  const finalList = listForPhase(turnOrder, finalSlice) as TurnListState;
  const next = firstUnplayed(turnOrder, finalSlice, finalList);
  return {
    ...after,
    ...replaceList(finalSlice, { ...finalList, activeEntryId: next }),
    pendingPhasePrompt: next === null,
  };
};

/**
 * Take the source entries out of play and bring the target in with a
 * new name, owner and value. The name keeps the target's own name as its
 * title and the sources' names, in `sourceIds` order, as its lineage.
 * The target counts as having played this round when any source had, so
 * combining never earns a second turn. A stand-in (see
 * `CombineEntries.extraSources`) only lends its name.
 */
const combineEntries = (
  state: GameSessionState,
  action: Extract<GameSessionAction, { type: "COMBINE_TURN_ENTRIES" }>,
): GameSessionState => {
  const turnOrder = state.turnOrder;
  const initial = variableSlice(state);
  if (!turnOrder || !initial) return state;
  const standIns = new Map(
    turnOrder.combine?.extraSources?.entries.map((e) => [e.id, e.label]),
  );
  // Stand-ins only lend their names; the real sources leave play.
  const realIds = action.sourceIds.filter((id) => !standIns.has(id));
  const sourceList = realIds.length
    ? listContaining(initial, realIds[0])
    : undefined;
  const target = findEntry(initial, action.targetId);
  if (
    !sourceList ||
    !target ||
    listContaining(initial, action.targetId) ||
    action.sourceIds.includes(action.targetId) ||
    new Set(action.sourceIds).size !== action.sourceIds.length ||
    realIds.some((id) => !sourceList.order.includes(id))
  )
    return state;
  const actingSource =
    sourceList.activeEntryId !== null &&
    realIds.includes(sourceList.activeEntryId) &&
    isRunningList(turnOrder, initial, sourceList.id);
  const before =
    actingSource && action.elapsedSeconds !== undefined && turnInProgress(state)
      ? closeTurnInProgress(state, action.elapsedSeconds, action.at)
      : state;
  const slice = variableSlice(before) as VariableOrderState;
  const list = listContaining(slice, realIds[0]) as TurnListState;
  const anyPlayed =
    actingSource || realIds.some((id) => (list.played ?? []).includes(id));
  const nameParts: NameParts = {
    title: target.nameParts?.title ?? target.label ?? target.id,
    lineage: action.sourceIds.map((id) => {
      const source = findEntry(slice, id);
      return source?.label ?? standIns.get(id) ?? id;
    }),
  };
  const withTarget: VariableOrderState = {
    ...slice,
    turnEntries: slice.turnEntries.map((e) =>
      e.id === action.targetId
        ? {
            ...e,
            label: flatLabel(nameParts),
            nameParts,
            playerIndex: action.playerIndex,
            ...(action.value !== undefined ? { value: action.value } : {}),
          }
        : e,
    ),
  };
  log.info("entries combined", {
    sourceIds: action.sourceIds,
    targetId: action.targetId,
  });
  if (!isValueOrdered(turnOrder, list.id)) {
    const order = list.order.filter((id) => !realIds.includes(id));
    const at = list.order.indexOf(realIds[0]);
    order.splice(Math.min(at, order.length), 0, action.targetId);
    const activeEntryId =
      list.activeEntryId !== null && realIds.includes(list.activeEntryId)
        ? action.targetId
        : list.activeEntryId;
    return {
      ...before,
      ...replaceList(withTarget, { ...list, order, activeEntryId }),
      valueHistory: withValuePoint(before, action.targetId, action.value),
    };
  }
  const removed = removeFromValueList(turnOrder, withTarget, list, realIds);
  const afterRemoval = { ...before, ...removed };
  const removedSlice = variableSlice(afterRemoval) as VariableOrderState;
  const remaining = removedSlice.turnLists.find(
    (l) => l.id === list.id,
  ) as TurnListState;
  const withPlayed = anyPlayed
    ? { ...remaining, played: [...(remaining.played ?? []), action.targetId] }
    : remaining;
  return {
    ...afterRemoval,
    ...placeInValueList(
      afterRemoval,
      turnOrder,
      replaceList(removedSlice, withPlayed),
      withPlayed,
      action.targetId,
    ),
    valueHistory: withValuePoint(afterRemoval, action.targetId, action.value),
  };
};

/**
 * Undo a variable-order turn: back to the phase it was played in, with
 * that list's order and active entry as they stood when it ended.
 * Reorders, activation changes and phase changes made since then are
 * reverted with it. Other lists keep their current order.
 */
const restoreBefore = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  popped: TurnRecord,
): Partial<GameSessionState> => {
  const restored = { ...slice, activePhaseId: popped.phaseId as string };
  const list = listForPhase(turnOrder, restored);
  return {
    ...(list && popped.entryId !== undefined
      ? replaceList(restored, {
          ...list,
          order: popped.orderBefore ?? list.order,
          activeEntryId: popped.entryId,
        })
      : restored),
    pendingPhasePrompt: false,
  };
};

export interface TurnOrderView {
  listId: string;
  listLabel: string;
  phaseId: string;
  phaseLabel: string;
  // Entries in turn order, top to bottom.
  entries: TurnEntry[];
  // Whose turn it is in this list (the current turn when the list is
  // running).
  activeId: string | null;
  // Who goes after the active entry (wrapping), null when alone.
  nextId: string | null;
  // Display labels for entry `kind` tags.
  kindLabels: Record<string, string>;
  // Kinds declared `prominent`.
  prominentKinds: string[];
  // Ordered by entry value: no dragging, and each entry plays once per
  // visit to the running phase.
  valueOrdered: boolean;
  // A value-ordered list whose entries sharing a value may be reordered
  // by hand.
  reorderEqual: boolean;
  // Entries that have had their turn in the running phase's current
  // visit (only while this list is running).
  playedIds: string[];
  // Entries added to this list must name an owner.
  ownerRequired: boolean;
}

// A list as the UI renders it (the running list by default), or null
// outside variable mode.
export const selectTurnOrder = (
  state: GameSessionState,
  listId?: string,
): TurnOrderView | null => {
  const slice = variableSlice(state);
  const turnOrder = state.turnOrder;
  if (!slice || !turnOrder) return null;
  const list = listId
    ? slice.turnLists.find((l) => l.id === listId)
    : listForPhase(turnOrder, slice);
  if (!list) return null;
  const phase = findPhase(turnOrder, slice.activePhaseId);
  const entries = list.order
    .map((id) => findEntry(slice, id))
    .filter((e): e is TurnEntry => e !== undefined);
  const decl = listDecl(turnOrder, list.id);
  const valueOrdered = decl?.orderBy === "value";
  const running = isRunningList(turnOrder, slice, list.id);
  const nextId = valueOrdered
    ? running
      ? firstUnplayed(turnOrder, slice, list, list.activeEntryId)
      : null
    : list.order.length > 1
      ? entryAfter(list.order, list.activeEntryId)
      : null;
  return {
    listId: list.id,
    listLabel: decl?.label ?? list.id,
    phaseId: slice.activePhaseId,
    phaseLabel: phase?.label ?? slice.activePhaseId,
    entries,
    activeId: list.activeEntryId,
    nextId,
    kindLabels: Object.fromEntries(
      (turnOrder.entryKinds ?? []).map((k) => [k.id, k.label]),
    ),
    prominentKinds: (turnOrder.entryKinds ?? [])
      .filter((k) => k.prominent)
      .map((k) => k.id),
    valueOrdered,
    reorderEqual: reordersEqualValues(turnOrder, list.id),
    playedIds: valueOrdered && running ? (list.played ?? []) : [],
    ownerRequired: decl?.ownerRequired ?? false,
  };
};

// Known entries not in any list that belong to `listId` (the running
// list by default): declared entries waiting to be activated, and
// entries deactivated earlier.
export const selectAvailableTurnEntries = (
  state: GameSessionState,
  listId?: string,
): TurnEntry[] => {
  const slice = variableSlice(state);
  const turnOrder = state.turnOrder;
  if (!slice || !turnOrder) return [];
  const target = listId ?? listForPhase(turnOrder, slice)?.id;
  return slice.turnEntries.filter(
    (e) =>
      !listContaining(slice, e.id) && listIdForEntry(turnOrder, e) === target,
  );
};

export interface TurnPhasesView {
  phases: Array<{
    id: string;
    label: string;
    list: string;
    // Question asked to pick the first entry when starting this phase.
    firstEntryPrompt?: string;
    // Question asked when the table ends this phase.
    exitPrompt?: string;
  }>;
  activeId: string;
  // The phase the table should be offered next.
  defaultNextId: string;
  // Set when the running phase is over and asks for a phase choice.
  pendingPrompt: boolean;
  // Ending a turn in the running phase asks for a value step.
  valueStepOnTurnEnd: boolean;
}

export const selectTurnPhases = (
  state: GameSessionState,
): TurnPhasesView | null => {
  const slice = variableSlice(state);
  const turnOrder = state.turnOrder;
  if (!slice || !turnOrder) return null;
  return {
    phases: resolvePhases(turnOrder).map(
      ({ id, label, list, firstEntryPrompt, exitPrompt }) => ({
        id,
        label,
        list,
        ...(firstEntryPrompt !== undefined ? { firstEntryPrompt } : {}),
        ...(exitPrompt !== undefined ? { exitPrompt } : {}),
      }),
    ),
    activeId: slice.activePhaseId,
    defaultNextId: defaultNextPhaseId(
      turnOrder,
      slice.activePhaseId,
      slice.phaseRun,
    ),
    pendingPrompt: state.pendingPhasePrompt ?? false,
    valueStepOnTurnEnd:
      findPhase(turnOrder, slice.activePhaseId)?.valueStepOnTurnEnd ?? false,
  };
};

/**
 * Whether ending the current turn must name a value step: the running
 * phase asks for one and an entry is part-way through its turn.
 */
export const selectNeedsValueStep = (state: GameSessionState): boolean => {
  const slice = variableSlice(state);
  const turnOrder = state.turnOrder;
  if (!slice || !turnOrder?.entryValues) return false;
  if (!findPhase(turnOrder, slice.activePhaseId)?.valueStepOnTurnEnd)
    return false;
  return turnInProgress(state);
};

/**
 * What the ring shows instead of a time while the acting entry's turn is
 * untimed, or null when the turn is timed (or nobody is acting).
 */
export const selectUntimedTurnLabel = (
  state: GameSessionState,
): string | null => {
  if (state.pendingPhasePrompt) return null;
  const kind = actingUntimedKind(state);
  return kind ? (kind.untimedLabel ?? "Untimed") : null;
};

export const selectTurnElapsedSecondsList = (
  state: GameSessionState,
): number[] => state.turns.map((t) => t.elapsedSeconds);

export const selectScoreFor = (
  state: GameSessionState,
  playerIndex: number,
): number => state.scores[playerIndex] ?? state.scoreConfig?.min ?? 0;
