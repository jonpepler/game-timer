import { describe, expect, it } from "vitest";
import type { ScoreConfig } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  type GameSessionState,
  gameSessionReducer,
} from "./gameSession";

/*
 * A `highestAtTurnLimit` game ends when the recorded turns reach the
 * expected turns, and the highest score wins.
 */

const atLimit: ScoreConfig = {
  displayStyle: "leaderboard",
  min: 0,
  increment: 1,
  victory: { type: "highestAtTurnLimit" },
};

const players = [
  { name: "A", metadata: {} },
  { name: "B", metadata: {} },
  { name: "C", metadata: {} },
];

const run = (state: GameSessionState, ...actions: GameSessionAction[]) =>
  actions.reduce(gameSessionReducer, state);

const turn: GameSessionAction = { type: "NEXT_TURN", elapsedSeconds: 5, at: 0 };

const game = (scoreConfig: ScoreConfig = atLimit, expectedTurns = 3) =>
  run(
    createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns,
      players,
      scoreConfig,
    }),
    { type: "START", at: 0 },
  );

describe("highestAtTurnLimit victory", () => {
  it("declares no winner before the turn limit, however high a score goes", () => {
    const state = run(
      game(),
      { type: "SET_SCORE", playerIndex: 1, value: 99 },
      turn,
      turn,
    );
    expect(state.victor).toBeNull();
  });

  it("the highest score wins when the last expected turn ends", () => {
    const state = run(
      game(),
      { type: "SET_SCORE", playerIndex: 0, value: 4 },
      { type: "SET_SCORE", playerIndex: 2, value: 7 },
      turn,
      turn,
      turn,
    );
    expect(state.victor).toBe(2);
  });

  it("an equal top score goes to the earliest seat", () => {
    const state = run(
      game(),
      { type: "SET_SCORE", playerIndex: 1, value: 5 },
      { type: "SET_SCORE", playerIndex: 2, value: 5 },
      turn,
      turn,
      turn,
    );
    expect(state.victor).toBe(1);
  });

  it("a score correction at the limit re-ranks the winner", () => {
    const ended = run(
      game(),
      { type: "SET_SCORE", playerIndex: 0, value: 3 },
      turn,
      turn,
      turn,
    );
    expect(ended.victor).toBe(0);
    const corrected = run(ended, {
      type: "INCREMENT_SCORE",
      playerIndex: 1,
      delta: 4,
    });
    expect(corrected.victor).toBe(1);
  });

  it("undoing the last turn, or raising the turn limit, reopens the game", () => {
    const ended = run(game(), turn, turn, turn);
    expect(ended.victor).toBe(0);
    expect(run(ended, { type: "UNDO" }).victor).toBeNull();
    expect(
      run(ended, { type: "SET_EXPECTED_TURNS", expectedTurns: 6 }).victor,
    ).toBeNull();
  });

  it("firstToMax still ignores the turn limit", () => {
    const state = run(
      game({ ...atLimit, max: 10, victory: { type: "firstToMax" } }),
      turn,
      turn,
      turn,
      turn,
    );
    expect(state.victor).toBeNull();
  });
});
