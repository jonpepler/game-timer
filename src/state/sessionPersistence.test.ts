import { afterEach, describe, expect, it } from "vitest";
import {
  clearSession,
  loadSession,
  saveSession,
} from "./sessionPersistence";
import {
  createInitialGameSessionState,
  gameSessionReducer,
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
    // in "not running" mode — next tap will restart the countdown.
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
