import { describe, expect, it } from "vitest";
import { parseGameDefinition, type TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  gameSessionReducer,
  type GameSessionState,
  seatEntryId,
  selectAvailableTurnEntries,
  selectCurrentPlayerIndex,
  selectTurnOrder,
} from "./gameSession";
import { getPlayerStats } from "@/utils/getPlayerStats";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

const VARIABLE: TurnOrder = { mode: "variable" };

const init = (
  overrides: Partial<Parameters<typeof createInitialGameSessionState>[0]> = {},
) =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(4),
    turnOrder: VARIABLE,
    ...overrides,
  });

const run = (state: GameSessionState, ...actions: GameSessionAction[]) =>
  actions.reduce(gameSessionReducer, state);

const next = (at = 1000): GameSessionAction => ({
  type: "NEXT_TURN",
  elapsedSeconds: 60,
  at,
});

const advance = (state: GameSessionState, times = 1) =>
  run(state, ...Array.from({ length: times }, (_, i) => next(1000 + i)));

const ids = (state: GameSessionState) =>
  selectTurnOrder(state)?.entries.map((e) => e.id);

const [A, B, C, D] = [0, 1, 2, 3].map(seatEntryId);

describe("variable turn order", () => {
  it("seeds one entry per seat in seat order, first seat active", () => {
    const s = init();
    expect(ids(s)).toEqual([A, B, C, D]);
    const view = selectTurnOrder(s)!;
    expect(view.activeId).toBe(A);
    expect(view.nextId).toBe(B);
    expect(selectCurrentPlayerIndex(s)).toBe(0);
  });

  it("walks the list and wraps at the end of the round", () => {
    const s = init();
    expect(selectCurrentPlayerIndex(advance(s, 1))).toBe(1);
    expect(selectCurrentPlayerIndex(advance(s, 3))).toBe(3);
    const wrapped = advance(s, 4);
    expect(selectCurrentPlayerIndex(wrapped)).toBe(0);
    expect(selectTurnOrder(wrapped)?.nextId).toBe(B);
  });

  it("records the acting entry and its player on each turn", () => {
    const s = advance(init(), 2);
    expect(s.turns.map((t) => t.entryId)).toEqual([A, B]);
    expect(s.turns.map((t) => t.playerIndex)).toEqual([0, 1]);
  });

  it("reorders before play: the new top entry goes first", () => {
    // No turn played yet, so setting the order decides who opens.
    let s = run(init(), {
      type: "REORDER_TURN_ENTRY",
      entryId: C,
      toIndex: 0,
    });
    expect(ids(s)).toEqual([C, A, B, D]);
    expect(selectTurnOrder(s)?.activeId).toBe(C);
    expect(selectTurnOrder(s)?.nextId).toBe(A);
    // Moving the opener down hands the opening to the new top.
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: C, toIndex: 3 });
    expect(selectTurnOrder(s)?.activeId).toBe(A);
  });

  it("mid-round reorder: active stays, the rest of the round follows the new order, next round starts at the top", () => {
    // A has gone, B is active.
    let s = advance(init(), 1);
    expect(selectTurnOrder(s)?.activeId).toBe(B);
    // Move D to the top: [D, A, B, C]. B stays active; C is next;
    // after C the round wraps to D.
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: D, toIndex: 0 });
    expect(ids(s)).toEqual([D, A, B, C]);
    expect(selectTurnOrder(s)?.activeId).toBe(B);
    expect(selectTurnOrder(s)?.nextId).toBe(C);
    s = advance(s, 1);
    expect(selectTurnOrder(s)?.activeId).toBe(C);
    s = advance(s, 1);
    expect(selectTurnOrder(s)?.activeId).toBe(D);
    s = advance(s, 1);
    expect(selectTurnOrder(s)?.activeId).toBe(A);
  });

  it("mid-round reorder can move the active entry itself", () => {
    let s = advance(init(), 1); // B active
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: B, toIndex: 3 });
    expect(ids(s)).toEqual([A, C, D, B]);
    expect(selectTurnOrder(s)?.activeId).toBe(B);
    // B is last, so the next turn wraps to the top.
    expect(selectTurnOrder(s)?.nextId).toBe(A);
  });

  it("clamps out-of-range reorder targets and ignores unknown ids", () => {
    const s = init();
    expect(
      ids(run(s, { type: "REORDER_TURN_ENTRY", entryId: A, toIndex: 99 })),
    ).toEqual([B, C, D, A]);
    expect(
      run(s, { type: "REORDER_TURN_ENTRY", entryId: "nope", toIndex: 0 }),
    ).toBe(s);
  });

  it("undo takes back turns and reorders one at a time", () => {
    let s = advance(init(), 1); // A took a turn, B active
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: D, toIndex: 0 });
    s = advance(s, 1); // B took a turn, C active
    expect(ids(s)).toEqual([D, A, B, C]);

    // Undo B's turn: the order stays reordered, B active again.
    s = run(s, { type: "UNDO" });
    expect(ids(s)).toEqual([D, A, B, C]);
    expect(selectTurnOrder(s)?.activeId).toBe(B);
    expect(selectCurrentPlayerIndex(s)).toBe(1);

    // Undo the reorder.
    s = run(s, { type: "UNDO" });
    expect(ids(s)).toEqual([A, B, C, D]);
    expect(selectTurnOrder(s)?.activeId).toBe(B);

    // Undo A's turn.
    s = run(s, { type: "UNDO" });
    expect(selectTurnOrder(s)?.activeId).toBe(A);
  });

  it("undo reverts a reorder made during the current turn on its own", () => {
    let s = advance(init(), 2); // C active
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: A, toIndex: 3 });
    s = run(s, { type: "UNDO" });
    expect(ids(s)).toEqual([A, B, C, D]);
    expect(selectTurnOrder(s)?.activeId).toBe(C);
    expect(s.turns).toHaveLength(2);
  });

  it("undo of a round-wrapping turn returns the active entry to the end", () => {
    let s = advance(init(), 4);
    expect(selectTurnOrder(s)?.activeId).toBe(A);
    s = run(s, { type: "UNDO" });
    expect(selectTurnOrder(s)?.activeId).toBe(D);
  });

  describe("add / remove entries", () => {
    const withDeclared = () =>
      init({
        players: seats(2),
        turnOrder: {
          mode: "variable",
          includePlayers: false,
          entryKinds: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
          entries: [
            { id: "s1", label: "Small one", kind: "small" },
            { id: "s2", label: "Small two", kind: "small" },
            { id: "l1", label: "Large one", kind: "large", inPlay: false },
          ],
        },
      });

    it("seeds declared in-play entries and holds the rest as available", () => {
      const s = withDeclared();
      expect(ids(s)).toEqual(["s1", "s2"]);
      expect(selectAvailableTurnEntries(s).map((e) => e.id)).toEqual(["l1"]);
      // A non-player entry is active, so there is no active seat.
      expect(selectCurrentPlayerIndex(s)).toBeNull();
      const view = selectTurnOrder(s)!;
      expect(view.entries[0]).toMatchObject({
        label: "Small one",
        kind: "small",
        playerIndex: null,
      });
    });

    it("adds a declared entry mid-game at a chosen position", () => {
      let s = advance(withDeclared(), 1); // s2 active
      s = run(s, {
        type: "ACTIVATE_TURN_ENTRY",
        entry: { id: "l1" },
        toIndex: 0,
      });
      expect(ids(s)).toEqual(["l1", "s1", "s2"]);
      expect(selectTurnOrder(s)?.activeId).toBe("s2");
      // Next round starts with the new top entry.
      expect(selectTurnOrder(s)?.nextId).toBe("l1");
      expect(selectAvailableTurnEntries(s)).toEqual([]);
    });

    it("adds an ad hoc entry at the end, ignores duplicates", () => {
      let s = run(withDeclared(), {
        type: "ACTIVATE_TURN_ENTRY",
        entry: { id: "x", label: "Extra", kind: "small" },
      });
      expect(ids(s)).toEqual(["s1", "s2", "x"]);
      const again = run(s, {
        type: "ACTIVATE_TURN_ENTRY",
        entry: { id: "x", label: "Extra" },
      });
      expect(again).toBe(s);
      s = advance(s, 3);
      expect(s.turns.map((t) => t.entryId)).toEqual(["s1", "s2", "x"]);
    });

    it("removing the active entry hands the turn to the next entry", () => {
      let s = advance(withDeclared(), 1); // s2 active
      s = run(s, { type: "ACTIVATE_TURN_ENTRY", entry: { id: "l1" } });
      s = run(s, { type: "DEACTIVATE_TURN_ENTRY", entryId: "s2" });
      expect(ids(s)).toEqual(["s1", "l1"]);
      expect(selectTurnOrder(s)?.activeId).toBe("l1");
      // Removed entries stay known so they can be re-added and so
      // historical turns keep their label.
      expect(selectAvailableTurnEntries(s).map((e) => e.id)).toEqual(["s2"]);
    });

    it("removing the last entry in the list while active wraps to the top", () => {
      let s = advance(withDeclared(), 1); // s2 active, last
      s = run(s, { type: "DEACTIVATE_TURN_ENTRY", entryId: "s2" });
      expect(selectTurnOrder(s)?.activeId).toBe("s1");
    });

    it("refuses to remove the only remaining entry", () => {
      let s = run(withDeclared(), {
        type: "DEACTIVATE_TURN_ENTRY",
        entryId: "s2",
      });
      const before = s;
      s = run(s, { type: "DEACTIVATE_TURN_ENTRY", entryId: "s1" });
      expect(s).toBe(before);
    });

    it("undo restores a removed entry, then the turn before it", () => {
      let s = advance(withDeclared(), 1);
      const before = s;
      s = run(s, { type: "DEACTIVATE_TURN_ENTRY", entryId: "s1" });
      s = run(s, { type: "UNDO" });
      expect(ids(s)).toEqual(["s1", "s2"]);
      expect(selectTurnOrder(s)?.activeId).toBe(
        selectTurnOrder(before)?.activeId,
      );
      s = run(s, { type: "UNDO" });
      expect(selectTurnOrder(s)?.activeId).toBe("s1");
    });

    it("links an entry to a player so its turns are attributed to them", () => {
      let s = run(withDeclared(), {
        type: "SET_TURN_ENTRY_PLAYER",
        entryId: "s1",
        playerIndex: 1,
      });
      expect(selectCurrentPlayerIndex(s)).toBe(1);
      s = advance(s, 1);
      expect(s.turns[0]).toMatchObject({ entryId: "s1", playerIndex: 1 });
    });
  });

  it("SET_TURN_ORDER rebuilds the list from the current players", () => {
    let s = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
    });
    s = run(
      s,
      { type: "SET_PLAYERS", players: seats(3) },
      { type: "SET_TURN_ORDER", turnOrder: VARIABLE },
    );
    expect(ids(s)).toEqual([A, B, C]);
    expect(selectTurnOrder(s)?.activeId).toBe(A);
  });

  it("SET_LEAD rotates the list so the chosen seat leads", () => {
    const s = run(init(), { type: "SET_LEAD", seatIndex: 2 });
    expect(ids(s)).toEqual([C, D, A, B]);
    expect(selectCurrentPlayerIndex(s)).toBe(2);
  });

  it("RESET restores the seeded order", () => {
    let s = advance(init(), 2);
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: D, toIndex: 0 });
    s = run(s, { type: "RESET" });
    expect(ids(s)).toEqual([A, B, C, D]);
    expect(selectTurnOrder(s)?.activeId).toBe(A);
  });

  it("reorder actions are ignored outside variable mode", () => {
    const s = init({ turnOrder: undefined });
    expect(selectTurnOrder(s)).toBeNull();
    expect(run(s, { type: "REORDER_TURN_ENTRY", entryId: A, toIndex: 2 })).toBe(
      s,
    );
  });

  it("per-player stats follow the recorded player, not turns % seats", () => {
    let s = advance(init({ players: seats(3) }), 1); // A played, B active
    // Move B to the end: [A, C, B]. B plays, then the round wraps to A.
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: B, toIndex: 2 });
    s = run(
      s,
      { type: "NEXT_TURN", elapsedSeconds: 20, at: 2 },
      { type: "NEXT_TURN", elapsedSeconds: 30, at: 3 },
    );
    // Modulo attribution would give the third turn to seat 2.
    expect(s.turns.map((t) => t.playerIndex)).toEqual([0, 1, 0]);
    const stats = getPlayerStats(
      s.turns.map((t) => ({
        playerIndex: t.playerIndex as number,
        elapsedSeconds: t.elapsedSeconds,
      })),
    );
    expect(
      Object.fromEntries(stats.map((x) => [x.playerIndex, x.totalTime])),
    ).toEqual({ 0: 90, 1: 20 });
  });

  it("parses a definition declaring variable order with kinds", () => {
    const def = parseGameDefinition({
      schemaVersion: 1,
      id: "x",
      name: "X",
      defaultExpectedTurns: 10,
      defaultAverageSeconds: 60,
      turnOrder: {
        mode: "variable",
        includePlayers: false,
        entryKinds: [{ id: "k", label: "Kind" }],
        entries: [{ id: "e1", label: "E1", kind: "k", inPlay: false }],
      },
    });
    expect(def.turnOrder?.entries?.[0].inPlay).toBe(false);
    expect(() =>
      parseGameDefinition({
        ...def,
        turnOrder: {
          mode: "variable",
          entries: [
            { id: "dup", label: "a" },
            { id: "dup", label: "b" },
          ],
        },
      }),
    ).toThrow(/unique/);
  });
});

describe("the chosen lead in variable order", () => {
  it("opens with the lead's seat on top, keeping the seating cycle", () => {
    const state = createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 10,
      players: [
        { name: "A", metadata: {} },
        { name: "B", metadata: {} },
        { name: "C", metadata: {} },
      ],
      turnOrder: { mode: "variable" },
      leadIndex: 2,
    });
    expect(selectCurrentPlayerIndex(state)).toBe(2);
    expect(state.turnLists?.[0].order).toEqual(["seat-2", "seat-0", "seat-1"]);
  });
});
