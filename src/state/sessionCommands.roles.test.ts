import { describe, expect, it } from "vitest";
import type { PlayerRoles, TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  gameSessionReducer,
  selectPlayerRole,
} from "./gameSession";
import {
  checkCommand,
  projectCommand,
  SessionCommandSchema,
} from "./sessionCommands";

const ROLES: PlayerRoles = {
  defaultRole: "member",
  roles: [
    { id: "member", label: "Member" },
    { id: "head", label: "Head", leadsRound: true, unique: true },
  ],
};

const ORDER: TurnOrder = {
  mode: "lead-relative",
  rounds: {
    remainingLabel: { one: "round left", other: "rounds left" },
    limitOutcome: { title: "Done" },
    checks: [
      {
        afterRound: 1,
        title: "End of round 1",
        body: "Roll.",
        endLabel: "End",
        continueLabel: "Go on",
        outcome: { title: "Ended early" },
      },
    ],
  },
};

const session = (): GameSessionState =>
  gameSessionReducer(
    createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 9,
      players: [0, 1, 2].map((i) => ({ name: `P${i}`, metadata: {} })),
      turnOrder: ORDER,
      playerRoles: ROLES,
      leadIndex: 0,
    }),
    { type: "START", at: 0 },
  );

const seat = (seatIndex: number) => ({ kind: "seat" as const, seatIndex });

describe("role commands", () => {
  const setRole = SessionCommandSchema.parse({
    type: "SET_PLAYER_ROLE",
    playerIndex: 2,
    roleId: "head",
  });

  it("lets the host and the seat taking its turn change anyone's role", () => {
    const s = session();
    expect(checkCommand(s, setRole, { kind: "host" }).ok).toBe(true);
    expect(checkCommand(s, setRole, seat(0)).ok).toBe(true);
    expect(checkCommand(s, setRole, seat(1))).toEqual({
      ok: false,
      reason: "It is not your turn",
    });
  });

  it("rejects an unknown role or player", () => {
    const s = session();
    const host = { kind: "host" as const };
    expect(
      checkCommand(s, { ...setRole, roleId: "nobody" }, host),
    ).toMatchObject({ ok: false });
    expect(checkCommand(s, { ...setRole, playerIndex: 7 }, host)).toMatchObject(
      { ok: false },
    );
  });

  it("applies the role", () => {
    const s = projectCommand(session(), setRole, 0);
    expect(selectPlayerRole(s, 2)?.id).toBe("head");
  });
});

describe("round check commands", () => {
  const asked = () => {
    let s = session();
    for (let i = 0; i < 3; i++)
      s = gameSessionReducer(s, {
        type: "NEXT_TURN",
        elapsedSeconds: 5,
        at: i,
      });
    return s;
  };
  const answer = SessionCommandSchema.parse({
    type: "RESOLVE_ROUND_CHECK",
    end: true,
    round: 1,
  });

  it("lets any screen answer the check while it is asked", () => {
    expect(checkCommand(asked(), answer, seat(2)).ok).toBe(true);
    expect(checkCommand(session(), answer, seat(2))).toEqual({
      ok: false,
      reason: "That was already answered",
    });
  });

  it("rejects an answer to a different round's check", () => {
    expect(
      checkCommand(asked(), { ...answer, round: 2 }, { kind: "host" }),
    ).toMatchObject({ ok: false });
  });

  it("ends the game", () => {
    const s = projectCommand(asked(), answer, 0);
    expect(s.outcome?.title).toBe("Ended early");
  });

  it("refuses turn commands once the game is over", () => {
    const over = projectCommand(asked(), answer, 0);
    expect(checkCommand(over, { type: "END_TURN" }, { kind: "host" })).toEqual({
      ok: false,
      reason: "The game is over",
    });
  });
});
