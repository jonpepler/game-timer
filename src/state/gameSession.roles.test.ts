import { describe, expect, it } from "vitest";
import {
  type PlayerRoles,
  parseGameDefinition,
  safeParseGameDefinition,
} from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  gameSessionReducer,
  selectAvailableControls,
  selectCurrentPlayerIndex,
  selectPlayerRole,
} from "./gameSession";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const ROLES: PlayerRoles = {
  defaultRole: "member",
  roles: [
    { id: "member", label: "Member" },
    { id: "deputy", label: "Deputy", mark: "shield" },
    {
      id: "head",
      label: "Head",
      mark: "crown",
      color: "#7b3f8c",
      leadsRound: true,
      unique: true,
    },
  ],
};

const session = (players = 4) =>
  createInitialGameSessionState({
    initialAverageSeconds: 60,
    expectedTurns: 20,
    players: seats(players),
    turnOrder: { mode: "lead-relative" },
    playerRoles: ROLES,
    leadIndex: 0,
  });

const start = (s: GameSessionState) =>
  gameSessionReducer(s, { type: "START", at: 0 });

const setRole = (s: GameSessionState, playerIndex: number, roleId: string) =>
  gameSessionReducer(s, { type: "SET_PLAYER_ROLE", playerIndex, roleId });

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
  defaultExpectedTurns: 20,
  defaultAverageSeconds: 60,
};

describe("player roles schema", () => {
  it("accepts declared roles with a default", () => {
    const def = parseGameDefinition({
      ...base,
      turnOrder: { mode: "lead-relative" },
      playerRoles: ROLES,
    });
    expect(def.playerRoles?.roles.map((r) => r.id)).toEqual([
      "member",
      "deputy",
      "head",
    ]);
  });

  it("rejects a default that is not a declared role", () => {
    expect(
      safeParseGameDefinition({
        ...base,
        playerRoles: { ...ROLES, defaultRole: "nobody" },
      }).success,
    ).toBe(false);
  });

  it("rejects a role that opens the round without lead-relative order", () => {
    expect(
      safeParseGameDefinition({ ...base, playerRoles: ROLES }).success,
    ).toBe(false);
  });
});

describe("player roles", () => {
  it("gives every player the default role until one is set", () => {
    const s = session();
    expect(selectPlayerRole(s, 2)?.id).toBe("member");
  });

  it("sets any player to any role", () => {
    let s = start(session());
    s = setRole(s, 2, "deputy");
    expect(selectPlayerRole(s, 2)?.id).toBe("deputy");
    s = setRole(s, 2, "member");
    expect(selectPlayerRole(s, 2)?.id).toBe("member");
  });

  it("never ends the turn", () => {
    let s = advance(start(session()), 1);
    s = setRole(s, 1, "deputy");
    expect(s.turns).toHaveLength(1);
    expect(selectCurrentPlayerIndex(s)).toBe(1);
  });

  it("moves a unique role off its previous holder, back to the default", () => {
    let s = start(session());
    s = setRole(s, 1, "head");
    s = setRole(s, 3, "head");
    expect(selectPlayerRole(s, 1)?.id).toBe("member");
    expect(selectPlayerRole(s, 3)?.id).toBe("head");
  });

  it("before play starts, a role that opens the round takes the lead at once", () => {
    const s = setRole(session(), 2, "head");
    expect(selectCurrentPlayerIndex(s)).toBe(2);
  });

  it("during play, a role that opens the round takes the lead from the next round", () => {
    let s = advance(start(session()), 1);
    s = setRole(s, 1, "head");
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    s = advance(s, 3);
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    s = advance(s, 1);
    expect(selectCurrentPlayerIndex(s)).toBe(2);
  });

  it("ignores an unknown role or seat", () => {
    const s = start(session());
    expect(setRole(s, 1, "nobody")).toBe(s);
    expect(setRole(s, 9, "deputy")).toBe(s);
  });
});

describe("installing roles", () => {
  it("gives every player without a role the default, so renderers can read it", () => {
    let s = createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 20,
      players: seats(2),
    });
    s = gameSessionReducer(s, { type: "SET_PLAYER_ROLES", playerRoles: ROLES });
    expect(s.players?.[1].metadata.role).toEqual({
      type: "selected-option",
      optionId: "member",
      label: "Member",
    });
  });
});

describe("the roles control", () => {
  const control = {
    id: "roles",
    label: "Change roles",
    effect: { type: "open-player-roles" as const },
    availability: { limit: "unlimited" as const },
  };

  it("needs declared roles", () => {
    expect(
      safeParseGameDefinition({
        ...base,
        turnOrder: { mode: "lead-relative" },
        controls: [control],
      }).success,
    ).toBe(false);
    expect(
      safeParseGameDefinition({
        ...base,
        turnOrder: { mode: "lead-relative" },
        playerRoles: ROLES,
        controls: [control],
      }).success,
    ).toBe(true);
  });

  it("is offered to the seat taking its turn, every time, and changes nothing itself", () => {
    let s = gameSessionReducer(
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 20,
        players: seats(3),
        turnOrder: { mode: "lead-relative" },
        playerRoles: ROLES,
        controls: [control],
        leadIndex: 0,
      }),
      { type: "START", at: 0 },
    );
    expect(selectAvailableControls(s, 0).map((c) => c.id)).toEqual(["roles"]);
    expect(selectAvailableControls(s, 1)).toEqual([]);
    const after = gameSessionReducer(s, {
      type: "TRIGGER_CONTROL",
      controlId: "roles",
    });
    expect(after).toBe(s);
    s = advance(s, 1);
    expect(selectAvailableControls(s, 1).map((c) => c.id)).toEqual(["roles"]);
  });
});
