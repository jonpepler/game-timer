import { describe, expect, it } from "vitest";
import type { Control, TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  type GameSessionState,
  selectAvailableControls,
  selectCurrentPlayerIndex,
} from "./gameSession";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const LEAD_RELATIVE: TurnOrder = {
  mode: "lead-relative",
  roundEnd: { type: "prompt-lead", label: "Who leads?", default: "none" },
};

const CLAIM: Control = {
  id: "claim",
  label: "Claim the lead",
  effect: { type: "claim-next-lead" },
  availability: { actor: "active-seat", limit: "once-per-round" },
};

const claim = { type: "TRIGGER_CONTROL", controlId: "claim" } as const;

const init = (overrides = {}) =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(3),
    turnOrder: LEAD_RELATIVE,
    controls: [CLAIM],
    leadIndex: 1,
    ...overrides,
  });

const started = (overrides = {}) =>
  gameSessionReducer(init(overrides), { type: "START", at: 0 });

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

  it("prompts for the next lead at round end when nobody claims it", () => {
    const s = init({ leadIndex: 1 });
    const afterRound = advance(s, 3); // one turn each
    expect(afterRound.pendingLeadPrompt).toBe(true);
    expect(afterRound.claimedNextLead).toBeNull();

    const resolved = gameSessionReducer(afterRound, {
      type: "SET_LEAD",
      seatIndex: 2,
    });
    expect(resolved.pendingLeadPrompt).toBe(false);
    expect(resolved.leadIndex).toBe(2);
    expect(selectCurrentPlayerIndex(resolved)).toBe(2);
  });

  it("auto-advances the lead to the claiming seat without prompting", () => {
    let s = started({ leadIndex: 0 });
    s = advance(s, 1); // seat 1 now active
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    s = gameSessionReducer(s, claim);
    expect(s.claimedNextLead).toBe(1);
    s = advance(s, 2); // complete the 3-seat round
    expect(s.pendingLeadPrompt).toBe(false);
    expect(s.leadIndex).toBe(1);
    expect(s.claimedNextLead).toBeNull();
    expect(selectCurrentPlayerIndex(s)).toBe(1);
  });

  it("only allows one claim per round", () => {
    let s = started({ leadIndex: 0 });
    expect(selectAvailableControls(s).map((c) => c.id)).toEqual(["claim"]);
    s = gameSessionReducer(s, claim);
    expect(selectAvailableControls(s)).toEqual([]);
    const ignored = gameSessionReducer(s, claim);
    expect(ignored).toBe(s);
    expect(ignored.claimedNextLead).toBe(0);
    // New round clears the lock.
    const next = advance(s, 3);
    expect(selectAvailableControls(next).map((c) => c.id)).toEqual(["claim"]);
  });

  it("UNDO across a round boundary restores the prior lead anchor", () => {
    let s = started({ leadIndex: 0 });
    s = advance(s, 1);
    s = gameSessionReducer(s, claim); // seat 1 claims
    s = advance(s, 2); // round closes, lead -> 1
    expect(s.leadIndex).toBe(1);
    const undone = gameSessionReducer(s, { type: "UNDO" });
    expect(undone.leadIndex).toBe(0); // restored
    expect(undone.claimedNextLead).toBeNull();
    expect(selectCurrentPlayerIndex(undone)).toBe(2); // (0 + 2) % 3
  });
});

describe("turn direction and the opening lead", () => {
  const three = [
    { name: "A", metadata: {} },
    { name: "B", metadata: {} },
    { name: "C", metadata: {} },
  ];
  const seatsInTurn = (
    turnOrder: Parameters<typeof createInitialGameSessionState>[0]["turnOrder"],
    lead: number,
  ) => {
    let s = gameSessionReducer(
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 10,
        players: three,
        turnOrder,
      }),
      { type: "SET_LEAD", seatIndex: lead },
    );
    const seen: Array<number | null> = [];
    for (let i = 0; i < 4; i++) {
      seen.push(selectCurrentPlayerIndex(s));
      s = gameSessionReducer(s, {
        type: "NEXT_TURN",
        elapsedSeconds: 1,
        at: 0,
      });
    }
    return seen;
  };

  it("round-robin starts from the chosen lead and walks up the seats", () => {
    expect(seatsInTurn({ mode: "round-robin" }, 1)).toEqual([1, 2, 0, 1]);
  });

  it("reverse-seat-order walks down the seats, in either fixed mode", () => {
    expect(
      seatsInTurn({ mode: "round-robin", direction: "reverse-seat-order" }, 1),
    ).toEqual([1, 0, 2, 1]);
    expect(
      seatsInTurn(
        { mode: "lead-relative", direction: "reverse-seat-order" },
        0,
      ).slice(0, 3),
    ).toEqual([0, 2, 1]);
  });
});
