import { afterEach, describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./sessionPersistence";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  selectTurnOrder,
} from "./gameSession";

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

const buildState = () => {
  const init = createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 80,
    players: [
      { name: "A", color: "#fff" },
      { name: "B", color: "#000" },
    ],
  });
  const started = gameSessionReducer(init, { type: "START", at: 1000 });
  return gameSessionReducer(started, {
    type: "NEXT_TURN",
    elapsedSeconds: 100,
    at: 101000,
  });
};

describe("session persistence", () => {
  it("round-trips persisted reducer state with started/currentTurnStartedAt reset", () => {
    const state = buildState();
    saveSession(state);

    const restored = loadSession();
    expect(restored).toBeDefined();
    // History + config are preserved verbatim.
    expect(restored!.turns).toEqual(state.turns);
    expect(restored!.players).toEqual(state.players);
    expect(restored!.averageSeconds).toBe(state.averageSeconds);
    expect(restored!.expectedTurns).toBe(state.expectedTurns);
    // The imperative timer isn't persisted, so the session is loaded back
    // in "not running" mode: next tap will restart the countdown.
    expect(restored!.started).toBe(false);
    expect(restored!.currentTurnStartedAt).toBeNull();
  });

  it("returns undefined when nothing is saved", () => {
    expect(loadSession()).toBeUndefined();
  });

  it("discards persisted sessions written under a different schema version", () => {
    window.localStorage.setItem(
      "game-timer:v1:session",
      JSON.stringify({ schemaVersion: 999, state: buildState() }),
    );
    expect(loadSession()).toBeUndefined();
  });

  it("clearSession removes the persisted blob", () => {
    saveSession(buildState());
    expect(loadSession()).toBeDefined();
    clearSession();
    expect(loadSession()).toBeUndefined();
  });
});

describe("session persistence: variable turn order", () => {
  const variableState = () => {
    let s = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 80,
      players: [
        { name: "A", metadata: {} },
        { name: "B", metadata: {} },
        { name: "C", metadata: {} },
      ],
      turnOrder: {
        mode: "variable",
        entries: [{ id: "x", label: "Extra", kind: "k", inPlay: false }],
      },
    });
    s = gameSessionReducer(s, { type: "START", at: 0 });
    s = gameSessionReducer(s, { type: "NEXT_TURN", elapsedSeconds: 5, at: 5 });
    s = gameSessionReducer(s, {
      type: "REORDER_TURN_ENTRY",
      entryId: "seat-2",
      toIndex: 0,
    });
    return gameSessionReducer(s, {
      type: "ACTIVATE_TURN_ENTRY",
      entry: { id: "x" },
    });
  };

  it("round-trips the order, active entry, registry and per-turn snapshots", () => {
    const state = variableState();
    saveSession(state);
    const restored = loadSession()!;
    expect(selectTurnOrder(restored)).toEqual(selectTurnOrder(state));
    expect(restored.turnEntries).toEqual(state.turnEntries);
    expect(restored.turns).toEqual(state.turns);
    // Undo still works after a reload: the activation, then the reorder.
    const undone = [1, 2].reduce(
      (s) => gameSessionReducer(s, { type: "UNDO" }),
      restored,
    );
    expect(selectTurnOrder(undone)?.entries.map((e) => e.id)).toEqual([
      "seat-0",
      "seat-1",
      "seat-2",
    ]);
  });

  it("reseeds a corrupt variable-order slice instead of loading it", () => {
    const state = variableState();
    window.localStorage.setItem(
      "game-timer:v1:session",
      JSON.stringify({
        schemaVersion: 2,
        state: { ...state, turnEntries: [{ id: 3 }], turnLists: "nope" },
      }),
    );
    const restored = loadSession()!;
    expect(selectTurnOrder(restored)?.entries.map((e) => e.id)).toEqual([
      "seat-0",
      "seat-1",
      "seat-2",
    ]);
    expect(selectTurnOrder(restored)?.activeId).toBe("seat-0");
  });

  it("drops malformed per-turn order snapshots", () => {
    const state = variableState();
    window.localStorage.setItem(
      "game-timer:v1:session",
      JSON.stringify({
        schemaVersion: 2,
        state: {
          ...state,
          turns: [{ ...state.turns[0], entryId: 4, orderBefore: [1, 2] }],
        },
      }),
    );
    const restored = loadSession()!;
    expect(restored.turns[0].entryId).toBeUndefined();
    expect(restored.turns[0].orderBefore).toBeUndefined();
    expect(restored.turns[0].elapsedSeconds).toBe(5);
  });
});
