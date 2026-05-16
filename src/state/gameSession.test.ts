import { describe, expect, it } from "vitest";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  projectAverageAfterTurn,
  selectCurrentPlayerIndex,
  selectRemainingTurns,
  selectTurnElapsedSecondsList,
} from "./gameSession";

const init = (
  overrides: Partial<Parameters<typeof createInitialGameSessionState>[0]> = {},
) =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: undefined,
    ...overrides,
  });

describe("gameSessionReducer", () => {
  it("START marks the session as running and seeds the turn-start clock", () => {
    const state = gameSessionReducer(init(), { type: "START", at: 1000 });
    expect(state.started).toBe(true);
    expect(state.currentTurnStartedAt).toBe(1000);
  });

  it("START is idempotent once the session has begun", () => {
    const first = gameSessionReducer(init(), { type: "START", at: 1000 });
    const second = gameSessionReducer(first, { type: "START", at: 2000 });
    expect(second).toBe(first);
  });

  it("NEXT_TURN appends a turn record and rolls the average", () => {
    const players = [
      { name: "A", color: "#fff" },
      { name: "B", color: "#000" },
    ];
    const state0 = init({ players });
    const started = gameSessionReducer(state0, { type: "START", at: 1000 });

    const after1 = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 120,
      at: 1120000,
    });
    expect(after1.turns).toEqual([
      { playerIndex: 0, elapsedSeconds: 120, startedAt: 1000 },
    ]);
    expect(after1.averageSeconds).toBe(120);
    expect(after1.currentTurnStartedAt).toBe(1120000);

    const after2 = gameSessionReducer(after1, {
      type: "NEXT_TURN",
      elapsedSeconds: 60,
      at: 1180000,
    });
    expect(after2.turns).toHaveLength(2);
    expect(after2.turns[1].playerIndex).toBe(1);
    expect(after2.averageSeconds).toBe(Math.floor((120 + 60) / 2));
  });

  it("NEXT_TURN assigns null playerIndex when player tracking is off", () => {
    const started = gameSessionReducer(init(), { type: "START", at: 0 });
    const next = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 90,
      at: 90000,
    });
    expect(next.turns[0].playerIndex).toBeNull();
  });

  it("UNDO removes the most recent turn and reinstates its start time", () => {
    const players = [{ name: "A", color: "#fff" }];
    const started = gameSessionReducer(init({ players }), {
      type: "START",
      at: 1000,
    });
    const oneTurn = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 120,
      at: 121000,
    });
    const undone = gameSessionReducer(oneTurn, { type: "UNDO" });

    expect(undone.turns).toHaveLength(0);
    expect(undone.currentTurnStartedAt).toBe(1000);
    // Back to zero turns means the original average is restored — see the
    // dedicated test below for why we don't freeze the rolling average.
    expect(undone.averageSeconds).toBe(300);
  });

  it("UNDO is a no-op when no turns have been recorded", () => {
    const started = gameSessionReducer(init(), { type: "START", at: 0 });
    const undone = gameSessionReducer(started, { type: "UNDO" });
    expect(undone).toBe(started);
  });

  it("UNDO back to zero turns restores the initial average, not the last rolling value", () => {
    const started = gameSessionReducer(init({ initialAverageSeconds: 300 }), {
      type: "START",
      at: 0,
    });
    // A turn way under the initial average pushes averageSeconds way down.
    const afterFastTurn = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 20,
      at: 20_000,
    });
    expect(afterFastTurn.averageSeconds).toBe(20);

    const undone = gameSessionReducer(afterFastTurn, { type: "UNDO" });
    expect(undone.turns).toHaveLength(0);
    // Important: the original 300s baseline is back, not the post-turn 20s.
    expect(undone.averageSeconds).toBe(300);
  });

  it("SET_EXPECTED_TURNS and SET_PLAYERS update config without touching the log", () => {
    const started = gameSessionReducer(init(), { type: "START", at: 0 });
    const withTurns = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 100,
      at: 100000,
    });

    const reExpected = gameSessionReducer(withTurns, {
      type: "SET_EXPECTED_TURNS",
      expectedTurns: 30,
    });
    expect(reExpected.expectedTurns).toBe(30);
    expect(reExpected.turns).toEqual(withTurns.turns);

    const players = [{ name: "Z", color: "#888" }];
    const withPlayers = gameSessionReducer(reExpected, {
      type: "SET_PLAYERS",
      players,
    });
    expect(withPlayers.players).toEqual(players);
  });

  it("RESET clears the log and restores the initial average + config", () => {
    const started = gameSessionReducer(
      init({ expectedTurns: 50, initialAverageSeconds: 300 }),
      { type: "START", at: 0 },
    );
    const withTurns = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 100,
      at: 100000,
    });
    expect(withTurns.averageSeconds).toBe(100);

    const reset = gameSessionReducer(withTurns, { type: "RESET" });
    expect(reset.turns).toEqual([]);
    expect(reset.started).toBe(false);
    expect(reset.expectedTurns).toBe(50);
    expect(reset.averageSeconds).toBe(300);
  });
});

describe("projectAverageAfterTurn", () => {
  it("matches the average the reducer will compute on NEXT_TURN", () => {
    const state = gameSessionReducer(init(), { type: "START", at: 0 });
    const elapsed = 200;
    const projected = projectAverageAfterTurn(state, elapsed);
    const after = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: elapsed,
      at: 200000,
    });
    expect(projected).toBe(after.averageSeconds);
  });
});

describe("selectors", () => {
  it("selectRemainingTurns counts down from expectedTurns", () => {
    const started = gameSessionReducer(init({ expectedTurns: 5 }), {
      type: "START",
      at: 0,
    });
    const after = gameSessionReducer(started, {
      type: "NEXT_TURN",
      elapsedSeconds: 30,
      at: 30000,
    });
    expect(selectRemainingTurns(after)).toBe(4);
  });

  it("selectCurrentPlayerIndex rotates with round-robin", () => {
    const players = [
      { name: "A", color: "#fff" },
      { name: "B", color: "#000" },
      { name: "C", color: "#888" },
    ];
    let state = gameSessionReducer(init({ players }), { type: "START", at: 0 });
    expect(selectCurrentPlayerIndex(state)).toBe(0);
    state = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: 10,
      at: 10_000,
    });
    expect(selectCurrentPlayerIndex(state)).toBe(1);
    state = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: 10,
      at: 20_000,
    });
    expect(selectCurrentPlayerIndex(state)).toBe(2);
    state = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: 10,
      at: 30_000,
    });
    expect(selectCurrentPlayerIndex(state)).toBe(0);
  });

  it("selectTurnElapsedSecondsList projects the legacy times array", () => {
    let state = gameSessionReducer(init(), { type: "START", at: 0 });
    state = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: 60,
      at: 60_000,
    });
    state = gameSessionReducer(state, {
      type: "NEXT_TURN",
      elapsedSeconds: 30,
      at: 90_000,
    });
    expect(selectTurnElapsedSecondsList(state)).toEqual([60, 30]);
  });
});
