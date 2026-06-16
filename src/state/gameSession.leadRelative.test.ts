import { describe, expect, it } from "vitest";
import type { TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  type GameSessionState,
  selectCanSeize,
  selectCurrentPlayerIndex,
} from "./gameSession";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const LEAD_RELATIVE: TurnOrder = {
  mode: "lead-relative",
  interrupt: {
    id: "seize",
    label: "Seize the Initiative",
    effect: "claim-next-lead",
    oncePerRound: true,
  },
  roundEnd: { type: "prompt-lead", label: "Who leads?", default: "none" },
};

const init = (overrides = {}) =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(3),
    turnOrder: LEAD_RELATIVE,
    leadIndex: 1,
    ...overrides,
  });

const advance = (state: GameSessionState, times = 1): GameSessionState => {
  let s = state;
  for (let i = 0; i < times; i++) {
    s = gameSessionReducer(s, {
      type: "NEXT_TURN",
      elapsedSeconds: 60,
      at: 1000 + i,
    });
  }
  return s;
};

describe("lead-relative turn order", () => {
  it("computes the active seat relative to the lead anchor", () => {
    const s = init({ leadIndex: 1 });
    expect(selectCurrentPlayerIndex(s)).toBe(1); // lead leads
    expect(selectCurrentPlayerIndex(advance(s, 1))).toBe(2);
    expect(selectCurrentPlayerIndex(advance(s, 2))).toBe(0); // wraps
  });

  it("round-robin (no turnOrder) is unchanged", () => {
    const s = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
    });
    expect(selectCurrentPlayerIndex(s)).toBe(0);
    expect(selectCurrentPlayerIndex(advance(s, 1))).toBe(1);
    expect(selectCurrentPlayerIndex(advance(s, 4))).toBe(1); // 4 % 3
  });

  it("prompts for the next lead at round end when nobody seizes", () => {
    const s = init({ leadIndex: 1 });
    const afterRound = advance(s, 3); // one turn each
    expect(afterRound.pendingLeadPrompt).toBe(true);
    expect(afterRound.seizedNextLead).toBeNull();

    const resolved = gameSessionReducer(afterRound, {
      type: "SET_LEAD",
      seatIndex: 2,
    });
    expect(resolved.pendingLeadPrompt).toBe(false);
    expect(resolved.leadIndex).toBe(2);
    expect(selectCurrentPlayerIndex(resolved)).toBe(2);
  });

  it("auto-advances the lead to the seizer without prompting", () => {
    let s = init({ leadIndex: 0 });
    s = advance(s, 1); // seat 1 now active
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    s = gameSessionReducer(s, { type: "SEIZE_LEAD" });
    expect(s.seizedNextLead).toBe(1);
    s = advance(s, 2); // complete the 3-seat round
    expect(s.pendingLeadPrompt).toBe(false);
    expect(s.leadIndex).toBe(1);
    expect(s.seizedNextLead).toBeNull();
    expect(selectCurrentPlayerIndex(s)).toBe(1);
  });

  it("only allows one seize per round", () => {
    let s = init({ leadIndex: 0 });
    expect(selectCanSeize(s)).toBe(true);
    s = gameSessionReducer(s, { type: "SEIZE_LEAD" });
    expect(selectCanSeize(s)).toBe(false);
    const ignored = gameSessionReducer(s, { type: "SEIZE_LEAD" });
    expect(ignored.seizedNextLead).toBe(0); // unchanged
    // New round clears the lock.
    const next = advance(s, 3);
    expect(selectCanSeize(next)).toBe(true);
  });

  it("UNDO across a round boundary restores the prior lead anchor", () => {
    let s = init({ leadIndex: 0 });
    s = advance(s, 1);
    s = gameSessionReducer(s, { type: "SEIZE_LEAD" }); // seat 1 seizes
    s = advance(s, 2); // round closes, lead -> 1
    expect(s.leadIndex).toBe(1);
    const undone = gameSessionReducer(s, { type: "UNDO" });
    expect(undone.leadIndex).toBe(0); // restored
    expect(undone.seizedNextLead).toBeNull();
    expect(selectCurrentPlayerIndex(undone)).toBe(2); // (0 + 2) % 3
  });
});
