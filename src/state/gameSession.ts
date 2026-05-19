import { createLogger } from "@/lib/logger";
import type { ScoreConfig } from "./gameDefinition";

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
  | { type: "RESET" };

export interface GameSessionInit {
  initialAverageSeconds: number;
  expectedTurns: number;
  players?: Player[];
  scoreConfig?: ScoreConfig;
  definitionId?: string;
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
    max !== undefined ? Math.max(min, Math.min(max, rawValue)) : Math.max(min, rawValue);
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
  return { ...state, scores, victor };
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
      const playerIndex = nextPlayerIndexFor(
        state.turns.length,
        state.players?.length,
      );
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
      return {
        ...state,
        started: true,
        turns,
        averageSeconds,
        currentTurnStartedAt: action.at,
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
      return {
        ...state,
        turns,
        averageSeconds,
        currentTurnStartedAt: popped.startedAt,
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
      return {
        ...state,
        scoreConfig: action.scoreConfig,
        scores: {},
        victor: null,
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
      });
  }
};

// Selectors

export const selectRemainingTurns = (state: GameSessionState): number =>
  state.expectedTurns - state.turns.length;

export const selectCurrentPlayerIndex = (
  state: GameSessionState,
): number | null =>
  nextPlayerIndexFor(state.turns.length, state.players?.length);

export const selectTurnElapsedSecondsList = (
  state: GameSessionState,
): number[] => state.turns.map((t) => t.elapsedSeconds);

export const selectScoreFor = (
  state: GameSessionState,
  playerIndex: number,
): number => state.scores[playerIndex] ?? state.scoreConfig?.min ?? 0;
