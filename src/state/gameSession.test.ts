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

describe("score subsystem", () => {
  const scoreConfig = {
    displayStyle: "linearTrack" as const,
    min: 0,
    max: 30,
    increment: 1,
    victory: { type: "firstToMax" as const },
  };

  const initWithScore = () =>
    gameSessionReducer(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: [
          { name: "A", color: "#fff" },
          { name: "B", color: "#000" },
        ],
        scoreConfig,
      }),
      { type: "START", at: 0 },
    );

  it("SET_SCORE writes a clamped value", () => {
    const state = initWithScore();
    const set = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 12,
    });
    expect(set.scores[0]).toBe(12);
  });

  it("SET_SCORE clamps to [min, max]", () => {
    const state = initWithScore();
    const high = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 999,
    });
    expect(high.scores[0]).toBe(30);
    const low = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: -5,
    });
    expect(low.scores[0]).toBe(0);
  });

  it("INCREMENT_SCORE adds the delta to the current score (defaulting to min)", () => {
    const state = initWithScore();
    const plusOne = gameSessionReducer(state, {
      type: "INCREMENT_SCORE",
      playerIndex: 1,
      delta: 1,
    });
    expect(plusOne.scores[1]).toBe(1);
    const plusTwoMore = gameSessionReducer(plusOne, {
      type: "INCREMENT_SCORE",
      playerIndex: 1,
      delta: 2,
    });
    expect(plusTwoMore.scores[1]).toBe(3);
  });

  it("INCREMENT_SCORE crossing max fires firstToMax victory", () => {
    const state = initWithScore();
    const justUnder = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 29,
    });
    expect(justUnder.victor).toBeNull();

    const won = gameSessionReducer(justUnder, {
      type: "INCREMENT_SCORE",
      playerIndex: 0,
      delta: 1,
    });
    expect(won.scores[0]).toBe(30);
    expect(won.victor).toBe(0);
  });

  it("once a victor is set, further increments do not change the victor", () => {
    const state = initWithScore();
    const won = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 30,
    });
    expect(won.victor).toBe(0);
    const player1Scores = gameSessionReducer(won, {
      type: "INCREMENT_SCORE",
      playerIndex: 1,
      delta: 30,
    });
    expect(player1Scores.scores[1]).toBe(30);
    expect(player1Scores.victor).toBe(0);
  });

  it("SET_SCORE_CONFIG to undefined clears scores and victor", () => {
    const state = initWithScore();
    const scored = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 30,
    });
    expect(scored.victor).toBe(0);

    const cleared = gameSessionReducer(scored, {
      type: "SET_SCORE_CONFIG",
      scoreConfig: undefined,
    });
    expect(cleared.scoreConfig).toBeUndefined();
    expect(cleared.scores).toEqual({});
    expect(cleared.victor).toBeNull();
  });

  it("END_GAME records a manual victor or stalemate", () => {
    const state = initWithScore();
    const manual = gameSessionReducer(state, {
      type: "END_GAME",
      victor: 1,
    });
    expect(manual.victor).toBe(1);
  });

  it("RESET keeps the score subsystem config but clears scores + victor", () => {
    const state = initWithScore();
    const scored = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 30,
    });
    const reset = gameSessionReducer(scored, { type: "RESET" });
    expect(reset.scoreConfig).toEqual(scoreConfig);
    expect(reset.scores).toEqual({});
    expect(reset.victor).toBeNull();
  });

  it("with no scoreConfig, increments still work but no victory fires", () => {
    const state = gameSessionReducer(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: [{ name: "A", color: "#fff" }],
      }),
      { type: "START", at: 0 },
    );
    const after = gameSessionReducer(state, {
      type: "INCREMENT_SCORE",
      playerIndex: 0,
      delta: 9999,
    });
    expect(after.scores[0]).toBe(9999);
    expect(after.victor).toBeNull();
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

describe("score milestones", () => {
  const milestoneConfig = {
    displayStyle: "linearTrack" as const,
    min: 0,
    max: 30,
    increment: 1,
    victory: { type: "firstToMax" as const },
    milestones: [
      { atScore: 4, label: "Trigger hireling A" },
      { atScore: 8, label: "Trigger hireling B" },
      { atScore: 12, label: "Trigger hireling C" },
    ],
  };

  const init = () =>
    gameSessionReducer(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: [
          { name: "A", color: "#fff" },
          { name: "B", color: "#000" },
        ],
        scoreConfig: milestoneConfig,
      }),
      { type: "START", at: 0 },
    );

  it("crossing a milestone queues a pending dialog", () => {
    const next = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 4,
    });
    expect(next.pendingMilestones).toEqual([
      { playerIndex: 0, atScore: 4, label: "Trigger hireling A" },
    ]);
    expect(next.firedMilestones[0]).toEqual([4]);
  });

  it("does not fire the same milestone twice for the same player", () => {
    let state = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 4,
    });
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    // Score down then back to 4 — no re-fire.
    state = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 2,
    });
    state = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 4,
    });
    expect(state.pendingMilestones).toEqual([]);
    expect(state.firedMilestones[0]).toEqual([4]);
  });

  it("a multi-step jump queues every crossed milestone in order", () => {
    const next = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 12,
    });
    expect(next.pendingMilestones.map((m) => m.atScore)).toEqual([4, 8, 12]);
  });

  it("milestones are tracked per-player independently", () => {
    let state = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 4,
    });
    state = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 1,
      value: 4,
    });
    expect(state.pendingMilestones).toEqual([
      { playerIndex: 0, atScore: 4, label: "Trigger hireling A" },
      { playerIndex: 1, atScore: 4, label: "Trigger hireling A" },
    ]);
  });

  it("DISMISS_MILESTONE pops the FIFO queue head", () => {
    let state = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 12,
    });
    expect(state.pendingMilestones).toHaveLength(3);
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    expect(state.pendingMilestones.map((m) => m.atScore)).toEqual([8, 12]);
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    expect(state.pendingMilestones.map((m) => m.atScore)).toEqual([12]);
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    expect(state.pendingMilestones).toEqual([]);
  });

  it("score decreases never fire milestones", () => {
    let state = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 12,
    });
    // Clear queue then drop the score below all thresholds.
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    state = gameSessionReducer(state, { type: "DISMISS_MILESTONE" });
    const decreased = gameSessionReducer(state, {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 0,
    });
    expect(decreased.pendingMilestones).toEqual([]);
    expect(decreased.firedMilestones[0]).toEqual([4, 8, 12]);
  });

  it("SET_SCORE_CONFIG clears milestone state", () => {
    let state = gameSessionReducer(init(), {
      type: "SET_SCORE",
      playerIndex: 0,
      value: 12,
    });
    state = gameSessionReducer(state, {
      type: "SET_SCORE_CONFIG",
      scoreConfig: undefined,
    });
    expect(state.pendingMilestones).toEqual([]);
    expect(state.firedMilestones).toEqual({});
  });
});
