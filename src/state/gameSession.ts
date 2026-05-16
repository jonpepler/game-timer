import { createLogger } from "@/lib/logger";

const log = createLogger("session");

export interface Player {
  name: string;
  color: string;
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
  expectedTurns: number;
  players?: Player[];
  currentTurnStartedAt: number | null;
}

export type GameSessionAction =
  | { type: "START"; at: number }
  | { type: "NEXT_TURN"; elapsedSeconds: number; at: number }
  | { type: "UNDO" }
  | { type: "SET_EXPECTED_TURNS"; expectedTurns: number }
  | { type: "SET_PLAYERS"; players: Player[] | undefined }
  | { type: "RESET" };

export interface GameSessionInit {
  initialAverageSeconds: number;
  expectedTurns: number;
  players?: Player[];
}

export const createInitialGameSessionState = (
  params: GameSessionInit,
): GameSessionState => ({
  started: false,
  turns: [],
  averageSeconds: params.initialAverageSeconds,
  expectedTurns: params.expectedTurns,
  players: params.players,
  currentTurnStartedAt: null,
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
      const averageSeconds = averageOf(turns, state.averageSeconds);
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
    case "RESET":
      return createInitialGameSessionState({
        initialAverageSeconds: state.averageSeconds,
        expectedTurns: state.expectedTurns,
        players: state.players,
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
