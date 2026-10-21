import { afterEach, describe, expect, it } from "vitest";
import {
  type Control,
  parseGameDefinition,
  safeParseGameDefinition,
  type TurnOrder,
} from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  gameSessionReducer,
  selectAvailableControls,
  selectCurrentPlayerIndex,
} from "./gameSession";
import { loadSession } from "./sessionPersistence";

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const LEAD_RELATIVE: TurnOrder = {
  mode: "lead-relative",
  roundEnd: { type: "prompt-lead", label: "Who leads?" },
};

const claimControl = (overrides: Partial<Control> = {}): Control => ({
  id: "claim",
  label: "Claim the lead",
  effect: { type: "claim-next-lead" },
  ...overrides,
});

const session = (controls: Control[], turnOrder: TurnOrder = LEAD_RELATIVE) =>
  gameSessionReducer(
    createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 30,
      players: seats(3),
      turnOrder,
      controls,
      leadIndex: 0,
    }),
    { type: "START", at: 0 },
  );

const advance = (state: GameSessionState, times = 1) => {
  let s = state;
  for (let i = 0; i < times; i++) {
    s = gameSessionReducer(s, {
      type: "NEXT_TURN",
      elapsedSeconds: 10,
      at: 1000 + i,
    });
  }
  return s;
};

const trigger = (state: GameSessionState, controlId: string) =>
  gameSessionReducer(state, { type: "TRIGGER_CONTROL", controlId });

const ids = (controls: Control[]) => controls.map((c) => c.id);

const baseDefinition = {
  schemaVersion: 1,
  id: "test",
  name: "Test",
  defaultExpectedTurns: 30,
  defaultAverageSeconds: 60,
};

describe("control schema", () => {
  it("accepts a claim-next-lead control under lead-relative order", () => {
    const def = parseGameDefinition({
      ...baseDefinition,
      turnOrder: LEAD_RELATIVE,
      controls: [claimControl()],
    });
    expect(def.controls?.[0].effect.type).toBe("claim-next-lead");
  });

  it("rejects claim-next-lead without lead-relative order", () => {
    const result = safeParseGameDefinition({
      ...baseDefinition,
      controls: [claimControl()],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain(
      "controls.0.effect",
    );
  });

  it("rejects duplicate control ids and unknown effect types", () => {
    expect(
      safeParseGameDefinition({
        ...baseDefinition,
        turnOrder: LEAD_RELATIVE,
        controls: [claimControl(), claimControl()],
      }).success,
    ).toBe(false);
    expect(
      safeParseGameDefinition({
        ...baseDefinition,
        turnOrder: LEAD_RELATIVE,
        controls: [{ id: "x", label: "X", effect: { type: "explode" } }],
      }).success,
    ).toBe(false);
  });

  it("migrates a legacy turnOrder.interrupt into a control", () => {
    const def = parseGameDefinition({
      ...baseDefinition,
      turnOrder: {
        mode: "lead-relative",
        interrupt: {
          id: "claim",
          label: "Claim the lead",
          effect: "claim-next-lead",
          oncePerRound: false,
        },
      },
    });
    expect(def.turnOrder).toEqual({ mode: "lead-relative" });
    expect(def.controls).toEqual([
      {
        id: "claim",
        label: "Claim the lead",
        effect: { type: "claim-next-lead" },
        availability: { actor: "active-seat", limit: "unlimited" },
      },
    ]);
  });
});

describe("selectAvailableControls", () => {
  it("offers nothing before the clock starts", () => {
    const fresh = createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 30,
      players: seats(3),
      turnOrder: LEAD_RELATIVE,
      controls: [claimControl()],
    });
    expect(selectAvailableControls(fresh)).toEqual([]);
    expect(trigger(fresh, "claim")).toBe(fresh);
  });

  it("offers an active-seat control only to the active seat", () => {
    const s = session([claimControl()]);
    expect(selectCurrentPlayerIndex(s)).toBe(0);
    expect(ids(selectAvailableControls(s))).toEqual(["claim"]);
    expect(ids(selectAvailableControls(s, 0))).toEqual(["claim"]);
    expect(selectAvailableControls(s, 1)).toEqual([]);
  });

  it("withdraws a once-per-round control from every seat after use", () => {
    let s = advance(session([claimControl()]), 1);
    s = trigger(s, "claim");
    expect(s.claimedNextLead).toBe(1);
    s = advance(s, 1);
    expect(selectAvailableControls(s)).toEqual([]);
    expect(selectAvailableControls(s, 2)).toEqual([]);
  });

  it("keeps an unlimited control available and lets a later seat re-claim", () => {
    let s = session([claimControl({ availability: { limit: "unlimited" } })]);
    s = trigger(s, "claim");
    expect(s.claimedNextLead).toBe(0);
    s = advance(s, 1);
    expect(ids(selectAvailableControls(s))).toEqual(["claim"]);
    s = trigger(s, "claim");
    expect(s.claimedNextLead).toBe(1);
  });

  it("offers nothing while the round-end lead prompt is open", () => {
    const s = advance(session([claimControl()]), 3);
    expect(s.pendingLeadPrompt).toBe(true);
    expect(selectAvailableControls(s)).toEqual([]);
  });

  it("offers nothing once a victor is declared", () => {
    const s = gameSessionReducer(session([claimControl()]), {
      type: "END_GAME",
      victor: 1,
    });
    expect(selectAvailableControls(s)).toEqual([]);
  });

  it("ignores triggers for unknown control ids", () => {
    const s = session([claimControl()]);
    expect(trigger(s, "nope")).toBe(s);
  });

  it("SET_CONTROLS installs controls and clears this round's usage", () => {
    let s = trigger(session([claimControl()]), "claim");
    expect(s.controlsUsedThisRound).toEqual(["claim"]);
    s = gameSessionReducer(s, {
      type: "SET_CONTROLS",
      controls: [claimControl({ id: "other" })],
    });
    expect(s.controlsUsedThisRound).toEqual([]);
    expect(ids(selectAvailableControls(s))).toEqual(["other"]);
  });

  it("RESET keeps the declared controls", () => {
    const s = gameSessionReducer(session([claimControl()]), { type: "RESET" });
    expect(ids(s.controls ?? [])).toEqual(["claim"]);
    expect(s.controlsUsedThisRound).toEqual([]);
  });
});

describe("legacy session migration", () => {
  it("loads a save from before controls with its control intact", () => {
    const legacyState = {
      ...session([]),
      controls: undefined,
      controlsUsedThisRound: undefined,
      turnOrder: {
        mode: "lead-relative",
        interrupt: {
          id: "claim",
          label: "Claim the lead",
          effect: "claim-next-lead",
          oncePerRound: true,
        },
      },
    };
    window.localStorage.setItem(
      "game-timer:v1:session",
      JSON.stringify({ schemaVersion: 2, state: legacyState }),
    );
    const loaded = loadSession();
    expect(loaded?.turnOrder).toEqual({ mode: "lead-relative" });
    expect(loaded?.controls).toEqual([
      {
        id: "claim",
        label: "Claim the lead",
        effect: { type: "claim-next-lead" },
        availability: { actor: "active-seat", limit: "once-per-round" },
      },
    ]);
    expect(loaded?.claimedNextLead).toBeNull();
    expect(loaded?.controlsUsedThisRound).toEqual([]);
  });
});
