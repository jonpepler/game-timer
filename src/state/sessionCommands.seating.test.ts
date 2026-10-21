import { describe, expect, it } from "vitest";
import { createInitialGameSessionState } from "./gameSession";
import type { Seat } from "./seating";
import {
  applySeatCommand,
  checkCommand,
  type CommandActor,
  DEFAULT_COMMAND_POLICY,
  projectCommand,
  resolveSeatCommand,
  type SessionCommand,
  SessionCommandSchema,
  type SetupSeating,
  type TableContext,
} from "./sessionCommands";

const HOST: CommandActor = { kind: "host" };
const GUEST: CommandActor = { kind: "guest" };
const seat = (seatIndex: number): CommandActor => ({ kind: "seat", seatIndex });

const COLORS = [
  { id: "red", label: "Red", color: "#f00" },
  { id: "blue", label: "Blue", color: "#00f" },
];

const seating = (
  count: number,
  more: Partial<SetupSeating> = {},
): SetupSeating => ({
  seats: Array.from(
    { length: count },
    (_, i): Seat => ({ id: `s${i}`, name: `Player ${i + 1}` }),
  ),
  minPlayers: 2,
  maxPlayers: 4,
  colorOptions: COLORS,
  ...more,
});

const game = (victor: number | null = null) => ({
  ...createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 10,
    players: [
      { name: "Player 1", metadata: { tag: { type: "text", value: "kept" } } },
      { name: "Player 2", metadata: {} },
    ],
  }),
  victor,
});

const check = (
  command: SessionCommand,
  actor: CommandActor,
  table: TableContext = {},
  state = game(),
) => checkCommand(state, command, actor, DEFAULT_COMMAND_POLICY, table);

describe("seat command schema", () => {
  it("trims a name and refuses a blank or overlong one", () => {
    expect(
      SessionCommandSchema.parse({
        type: "RENAME_PLAYER",
        playerIndex: 0,
        name: "  Ada ",
      }),
    ).toMatchObject({ name: "Ada" });
    for (const name of ["   ", "x".repeat(41)])
      expect(
        SessionCommandSchema.safeParse({
          type: "RENAME_PLAYER",
          playerIndex: 0,
          name,
        }).success,
      ).toBe(false);
  });

  it("refuses a seat command without a whole, non-negative seat", () => {
    expect(
      SessionCommandSchema.safeParse({ type: "REMOVE_SEAT", playerIndex: -1 })
        .success,
    ).toBe(false);
  });
});

describe("seat command policy", () => {
  const table = { seating: seating(3), claimedSeats: new Set([0, 1]) };

  it("refuses every seat command from a phone without a seat", () => {
    const commands: SessionCommand[] = [
      { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada" },
      { type: "ADD_SEAT" },
      { type: "REMOVE_SEAT", playerIndex: 2 },
      { type: "REORDER_SEATS", playerIndex: 0, toIndex: 1 },
      { type: "SET_SEAT_COLOR", playerIndex: 0, colorId: "red" },
    ];
    for (const command of commands)
      expect(check(command, GUEST, table)).toEqual({
        ok: false,
        reason: "Claim a seat first",
      });
  });

  it("lets a seated phone edit only its own player's name and colour", () => {
    const own: SessionCommand[] = [
      { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada" },
      { type: "SET_SEAT_COLOR", playerIndex: 0, colorId: "red" },
    ];
    for (const command of own)
      expect(check(command, seat(0), table)).toEqual({ ok: true });
    for (const command of own.map((c) => ({ ...c, playerIndex: 2 })))
      expect(check(command, seat(0), table)).toEqual({
        ok: false,
        reason: "You can only edit your own player",
      });
  });

  it("limits a mid-game rename to the phone's own player", () => {
    const rename = (playerIndex: number) =>
      check({ type: "RENAME_PLAYER", playerIndex, name: "Ada" }, seat(1));
    expect(rename(1)).toEqual({ ok: true });
    expect(rename(0)).toEqual({
      ok: false,
      reason: "You can only edit your own player",
    });
  });

  it("lets the host edit every player", () => {
    for (const playerIndex of [0, 1, 2]) {
      expect(
        check({ type: "RENAME_PLAYER", playerIndex, name: "Ada" }, HOST, table),
      ).toEqual({ ok: true });
      expect(
        check(
          { type: "SET_SEAT_COLOR", playerIndex, colorId: "blue" },
          HOST,
          table,
        ),
      ).toEqual({ ok: true });
    }
  });

  it("still lets any seated phone arrange the seats", () => {
    expect(
      check(
        { type: "REORDER_SEATS", playerIndex: 2, toIndex: 0 },
        seat(0),
        table,
      ),
    ).toEqual({ ok: true });
    expect(check({ type: "ADD_SEAT" }, seat(0), table)).toEqual({ ok: true });
  });

  it("lets a phone remove a free seat or its own, not another phone's", () => {
    const remove = (playerIndex: number) =>
      check({ type: "REMOVE_SEAT", playerIndex }, seat(0), table);
    expect(remove(2)).toEqual({ ok: true });
    expect(remove(0)).toEqual({ ok: true });
    expect(remove(1)).toEqual({
      ok: false,
      reason: "Another phone has claimed that seat",
    });
    expect(check({ type: "REMOVE_SEAT", playerIndex: 1 }, HOST, table)).toEqual(
      {
        ok: true,
      },
    );
  });
});

describe("seat command checks", () => {
  it("only changes seats themselves during setup", () => {
    for (const command of [
      { type: "ADD_SEAT" },
      { type: "REMOVE_SEAT", playerIndex: 0 },
      { type: "REORDER_SEATS", playerIndex: 0, toIndex: 1 },
    ] satisfies SessionCommand[])
      expect(check(command, HOST)).toEqual({
        ok: false,
        reason: "Seats can only change during setup",
      });
  });

  it("keeps the seat count within the game's bounds", () => {
    expect(check({ type: "ADD_SEAT" }, HOST, { seating: seating(4) })).toEqual({
      ok: false,
      reason: "At most 4 players",
    });
    expect(
      check({ type: "REMOVE_SEAT", playerIndex: 0 }, HOST, {
        seating: seating(2),
      }),
    ).toEqual({ ok: false, reason: "At least 2 players" });
  });

  it("refuses a colour the game does not offer and a seat that is not there", () => {
    const table = { seating: seating(3) };
    expect(
      check(
        { type: "SET_SEAT_COLOR", playerIndex: 0, colorId: "pink" },
        HOST,
        table,
      ),
    ).toEqual({ ok: false, reason: "Unknown colour" });
    expect(
      check({ type: "REORDER_SEATS", playerIndex: 0, toIndex: 3 }, HOST, table),
    ).toEqual({ ok: false, reason: "Unknown player" });
    expect(
      check({ type: "RENAME_PLAYER", playerIndex: 5, name: "Ada" }, HOST),
    ).toEqual({ ok: false, reason: "Unknown player" });
  });

  it("still renames once the game is over", () => {
    expect(
      check(
        { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada" },
        seat(0),
        {},
        game(1),
      ),
    ).toEqual({ ok: true });
  });
});

describe("seat ids", () => {
  it("finds a seat another screen has moved", () => {
    const moved = seating(3);
    moved.seats.reverse();
    expect(
      resolveSeatCommand(
        { type: "RENAME_PLAYER", playerIndex: 0, seatId: "s0", name: "Ada" },
        { seating: moved },
      ),
    ).toEqual({
      ok: true,
      command: {
        type: "RENAME_PLAYER",
        playerIndex: 2,
        seatId: "s0",
        name: "Ada",
      },
    });
  });

  it("moves a seat one place from where it now is, not where it was seen", () => {
    const moved = seating(4);
    moved.seats.reverse();
    // Seen at index 1 and moved up one; it now sits at index 2.
    expect(
      resolveSeatCommand(
        { type: "REORDER_SEATS", playerIndex: 1, seatId: "s1", toIndex: 0 },
        { seating: moved },
      ),
    ).toMatchObject({ ok: true, command: { playerIndex: 2, toIndex: 1 } });
    // Seen at index 2 and moved down one; it now sits at the end.
    expect(
      resolveSeatCommand(
        { type: "REORDER_SEATS", playerIndex: 2, seatId: "s0", toIndex: 3 },
        { seating: moved },
      ),
    ).toMatchObject({ ok: true, command: { playerIndex: 3, toIndex: 3 } });
  });

  it("refuses a command for a seat another screen removed", () => {
    expect(
      resolveSeatCommand(
        { type: "REMOVE_SEAT", playerIndex: 0, seatId: "gone" },
        { seating: seating(3) },
      ),
    ).toEqual({ ok: false, reason: "That seat was removed on another device" });
  });
});

describe("applying seat commands", () => {
  it("edits the setup seat list", () => {
    const { seats } = seating(3);
    const run = (command: SessionCommand) =>
      command.type === "RENAME_PLAYER" ||
      command.type === "ADD_SEAT" ||
      command.type === "REMOVE_SEAT" ||
      command.type === "REORDER_SEATS" ||
      command.type === "SET_SEAT_COLOR"
        ? applySeatCommand(seats, command, COLORS, "new")
        : seats;
    expect(run({ type: "ADD_SEAT" }).at(-1)).toEqual({
      id: "new",
      name: "Player 4",
      colorId: "red",
    });
    expect(
      run({ type: "REORDER_SEATS", playerIndex: 2, toIndex: 0 }).map(
        (s) => s.id,
      ),
    ).toEqual(["s2", "s0", "s1"]);
    expect(
      run({ type: "REMOVE_SEAT", playerIndex: 1 }).map((s) => s.id),
    ).toEqual(["s0", "s2"]);
    expect(
      run({ type: "SET_SEAT_COLOR", playerIndex: 1, colorId: "blue" })[1]
        .colorId,
    ).toBe("blue");
  });

  it("renames a player of the running game and keeps its details", () => {
    const after = projectCommand(
      game(),
      { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada" },
      0,
    );
    expect(after.players?.[0]).toEqual({
      name: "Ada",
      metadata: { tag: { type: "text", value: "kept" } },
    });
  });

  it("leaves the game alone while a seat command edits the setup list", () => {
    const state = game();
    expect(
      projectCommand(
        state,
        { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada" },
        0,
        { seating: seating(3) },
      ),
    ).toBe(state);
  });
});
