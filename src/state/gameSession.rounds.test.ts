import { describe, expect, it } from "vitest";
import {
  type PlayerRoles,
  parseGameDefinition,
  safeParseGameDefinition,
  type TurnOrder,
} from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  gameSessionReducer,
  selectCurrentPlayerIndex,
  selectGameOver,
  selectRoundNumber,
  selectRoundsRemaining,
} from "./gameSession";
import { selectPrediction } from "./prediction";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const ROLES: PlayerRoles = {
  defaultRole: "member",
  roles: [
    { id: "member", label: "Member" },
    { id: "head", label: "Head", leadsRound: true, unique: true },
  ],
};

const ROUNDS: TurnOrder = {
  mode: "lead-relative",
  rounds: {
    remainingLabel: { one: "round left", other: "rounds left" },
    limitOutcome: { title: "Time is up", body: "Count up." },
    checks: [
      {
        afterRound: 2,
        title: "End of round 2",
        body: "Roll to see whether the head wins.",
        whenRoleHeld: "head",
        endLabel: "Head wins",
        continueLabel: "Play on",
        outcome: { title: "Head holds on", winnerRole: "head" },
      },
    ],
  },
};

const session = ({
  players = 3,
  turnOrder = ROUNDS,
  head,
}: {
  players?: number;
  turnOrder?: TurnOrder;
  head?: number;
} = {}) => {
  let s = createInitialGameSessionState({
    initialAverageSeconds: 60,
    expectedTurns: 12,
    players: seats(players),
    turnOrder,
    playerRoles: ROLES,
    leadIndex: 0,
  });
  if (head !== undefined)
    s = gameSessionReducer(s, {
      type: "SET_PLAYER_ROLE",
      playerIndex: head,
      roleId: "head",
    });
  return gameSessionReducer(s, { type: "START", at: 0 });
};

const advance = (state: GameSessionState, times = 1) => {
  let s = state;
  for (let i = 0; i < times; i++)
    s = gameSessionReducer(s, {
      type: "NEXT_TURN",
      elapsedSeconds: 10,
      at: 1000 + i,
    });
  return s;
};

const base = {
  schemaVersion: 1,
  id: "test",
  name: "Test",
  defaultExpectedTurns: 12,
  turnsPerPlayer: 4,
  defaultAverageSeconds: 60,
};

describe("round track schema", () => {
  it("accepts a round track with checks under lead-relative order", () => {
    const def = parseGameDefinition({
      ...base,
      turnOrder: ROUNDS,
      playerRoles: ROLES,
    });
    expect(def.turnOrder?.rounds?.checks).toHaveLength(1);
  });

  it("takes the track's length from turnsPerPlayer, so needs it", () => {
    const { turnsPerPlayer: _, ...withoutLength } = base;
    expect(
      safeParseGameDefinition({
        ...withoutLength,
        turnOrder: ROUNDS,
        playerRoles: ROLES,
      }).success,
    ).toBe(false);
  });

  it("rejects a round track under any other order", () => {
    const result = safeParseGameDefinition({
      ...base,
      turnOrder: { ...ROUNDS, mode: "variable" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a check naming an undeclared role", () => {
    const result = safeParseGameDefinition({
      ...base,
      turnOrder: ROUNDS,
      playerRoles: { ...ROLES, roles: [ROLES.roles[0]], defaultRole: "member" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a check after the last round", () => {
    const rounds = ROUNDS.rounds;
    if (!rounds) throw new Error("fixture");
    const result = safeParseGameDefinition({
      ...base,
      playerRoles: ROLES,
      turnOrder: {
        ...ROUNDS,
        rounds: {
          ...rounds,
          checks: [{ ...rounds.checks?.[0], afterRound: 4 }],
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("round track", () => {
  it("counts rounds as one turn per seat", () => {
    let s = session();
    expect(selectRoundNumber(s)).toBe(1);
    expect(selectRoundsRemaining(s)).toBe(4);
    s = advance(s, 2);
    expect(selectRoundNumber(s)).toBe(1);
    s = advance(s, 1);
    expect(selectRoundNumber(s)).toBe(2);
    expect(selectRoundsRemaining(s)).toBe(3);
  });

  it("asks the check after its round when its role is held", () => {
    const s = advance(session({ head: 1 }), 6);
    expect(s.pendingRoundCheck).toBe(2);
    expect(selectRoundNumber(s)).toBe(3);
  });

  it("skips the check when nobody holds its role", () => {
    const s = advance(session(), 6);
    expect(s.pendingRoundCheck ?? null).toBeNull();
  });

  it("holds turns while a check is pending", () => {
    const s = advance(session({ head: 1 }), 6);
    expect(advance(s, 1).turns).toHaveLength(6);
  });

  it("plays on when the check says continue", () => {
    let s = advance(session({ head: 1 }), 6);
    s = gameSessionReducer(s, { type: "RESOLVE_ROUND_CHECK", end: false });
    expect(s.pendingRoundCheck).toBeNull();
    expect(selectGameOver(s)).toBe(false);
    expect(advance(s, 1).turns).toHaveLength(7);
  });

  it("ends the game with the role holder as winner when the check says end", () => {
    let s = advance(session({ head: 1 }), 6);
    s = gameSessionReducer(s, { type: "RESOLVE_ROUND_CHECK", end: true });
    expect(s.victor).toBe(1);
    expect(s.outcome).toEqual({ title: "Head holds on" });
    expect(s.pendingRoundCheck).toBeNull();
    expect(advance(s, 1).turns).toHaveLength(6);
  });

  it("ends the game once the expected turns are played, with the limit outcome", () => {
    const s = advance(session(), 12);
    expect(s.victor).toBeNull();
    expect(s.outcome).toEqual({ title: "Time is up", body: "Count up." });
    expect(selectGameOver(s)).toBe(true);
    expect(selectRoundsRemaining(s)).toBe(0);
    expect(advance(s, 1).turns).toHaveLength(12);
  });

  it("undo takes back the turn that ended the game or raised a check", () => {
    const over = gameSessionReducer(advance(session(), 12), { type: "UNDO" });
    expect(selectGameOver(over)).toBe(false);
    expect(over.turns).toHaveLength(11);

    const asked = gameSessionReducer(advance(session({ head: 1 }), 6), {
      type: "UNDO",
    });
    expect(asked.pendingRoundCheck).toBeNull();
    expect(asked.turns).toHaveLength(5);
  });

  it("undo takes back a check's ending and its winner", () => {
    let s = advance(session({ head: 1 }), 6);
    s = gameSessionReducer(s, { type: "RESOLVE_ROUND_CHECK", end: true });
    s = gameSessionReducer(s, { type: "UNDO" });
    expect(s.victor).toBeNull();
    expect(s.outcome).toBeNull();
  });

  it("reopens when the table adds expected turns", () => {
    let s = advance(session(), 12);
    s = gameSessionReducer(s, {
      type: "SET_EXPECTED_TURNS",
      expectedTurns: 15,
    });
    expect(selectGameOver(s)).toBe(false);
  });

  it("keeps the opening seat across rounds", () => {
    const s = advance(session(), 3);
    expect(selectCurrentPlayerIndex(s)).toBe(0);
  });
});

describe("round track prediction", () => {
  it("counts down rounds and charges the turns they still hold", () => {
    const s = advance(session(), 4);
    expect(selectPrediction(s)).toEqual({
      turns: 8,
      seconds: 80,
      modelled: true,
      remaining: { count: 3, label: "rounds left" },
    });
  });

  it("names a single round left in the singular", () => {
    expect(selectPrediction(advance(session(), 9)).remaining).toEqual({
      count: 1,
      label: "round left",
    });
  });
});
