import { describe, expect, it } from "vitest";
import { parseGameDefinition, type TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  selectCurrentPlayerIndex,
  selectNeedsValueStep,
  selectTurnOrder,
  selectTurnPhases,
} from "./gameSession";
import {
  active,
  add,
  end,
  init,
  order,
  phase,
  played,
  run,
  seats,
  setValue,
  threeEntries,
  VALUED,
  view,
} from "./valuedFixture";

describe("value-ordered lists", () => {
  it("parses a definition declaring entry values and a value-ordered list", () => {
    expect(() =>
      parseGameDefinition({
        schemaVersion: 1,
        id: "v",
        name: "V",
        defaultExpectedTurns: 10,
        defaultAverageSeconds: 60,
        turnOrder: VALUED,
      }),
    ).not.toThrow();
  });

  it("rejects a value-ordered list without entry values, and a track that is not ascending", () => {
    const base = {
      schemaVersion: 1,
      id: "v",
      name: "V",
      defaultExpectedTurns: 10,
      defaultAverageSeconds: 60,
    };
    const { entryValues: _v, ...noValues } = VALUED;
    expect(() => parseGameDefinition({ ...base, turnOrder: noValues })).toThrow(
      /entryValues/,
    );
    expect(() =>
      parseGameDefinition({
        ...base,
        turnOrder: {
          ...VALUED,
          entryValues: { ...VALUED.entryValues, track: [10, 5] },
        },
      }),
    ).toThrow(/ascending/);
  });

  it("orders entries by value; an arrival goes below the entries already at its value", () => {
    const s = run(init(), add("a", 80), add("c", 70), add("b", 80));
    expect(order(s)).toEqual(["a80", "b80", "c70"]);
    expect(view(s)?.valueOrdered).toBe(true);
    expect(view(s)?.ownerRequired).toBe(true);
  });

  it("ignores drag reorders in a value-ordered list", () => {
    const s = run(init(), add("a", 80), add("c", 70));
    const after = run(s, {
      type: "REORDER_TURN_ENTRY",
      entryId: "c",
      toIndex: 0,
    });
    expect(after).toBe(s);
  });

  it("starting the phase makes the highest entry active and nobody played", () => {
    const s = threeEntries();
    expect(active(s)).toBe("a");
    expect(view(s)?.nextId).toBe("b");
    expect(played(s)).toEqual([]);
    expect(selectNeedsValueStep(s)).toBe(true);
  });

  it("required: a moved entry joins the bottom of its new value's stack, played entries included", () => {
    let s = threeEntries();
    // A ends its turn down one: it lands under C, and B is up.
    s = run(s, end("down"));
    expect(order(s)).toEqual(["b80", "c70", "a70"]);
    expect(played(s)).toEqual(["a"]);
    expect(active(s)).toBe("b");
    // B ends down one: the bottom of the 70 stack, below the played A.
    s = run(s, end("down"));
    expect(order(s)).toEqual(["c70", "a70", "b70"]);
    expect(played(s)).toEqual(["a", "b"]);
    expect(active(s)).toBe("c");
  });

  it("credits each turn to the acting entry's owner", () => {
    let s = threeEntries();
    expect(selectCurrentPlayerIndex(s)).toBe(0);
    s = run(s, end("same", 42), end("up", 17));
    expect(
      s.turns.map((t) => [t.entryId, t.playerIndex, t.elapsedSeconds]),
    ).toEqual([
      ["a", 0, 42],
      ["b", 1, 17],
    ]);
  });

  it("an entry that keeps its value still re-enters below its equals", () => {
    const s = run(threeEntries(), end("same"));
    expect(order(s)).toEqual(["b80", "a80", "c70"]);
    expect(active(s)).toBe("b");
  });

  it("moves by track spaces, not by amounts, and clamps at the ends", () => {
    let s = run(
      init(),
      add("a", 150),
      add("b", 110),
      add("c", 120),
      phase("valued"),
    );
    s = run(s, { type: "START", at: 0 }, end("up"));
    // Already at the top of the track: it stays there.
    expect(order(s)).toEqual(["a150", "c120", "b110"]);
    // 120 up one space is 135, not 130.
    s = run(s, end("up"));
    expect(order(s)).toEqual(["a150", "c135", "b110"]);
    // 110 up two spaces is 135, below the entry already there.
    s = run(s, end("up2"));
    expect(order(s)).toEqual(["a150", "c135", "b135"]);
  });

  it("a played entry never gets a second turn, however far it rises", () => {
    let s = run(threeEntries(), end("down"), end("down"));
    // C is the last to act; once it ends the phase is over.
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
    s = run(s, end("up2"));
    expect(order(s)).toEqual(["c90", "a70", "b70"]);
    expect(active(s)).toBeNull();
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
    expect(selectNeedsValueStep(s)).toBe(false);
  });

  it("a remove step takes the entry out of play and passes the turn on", () => {
    const s = run(threeEntries(), end("gone"));
    expect(order(s)).toEqual(["b80", "c70"]);
    expect(active(s)).toBe("b");
    expect(s.turns.at(-1)?.entryId).toBe("a");
  });

  it("dropping to the remove-at value takes the entry out of play", () => {
    let s = run(init(), add("a", 10), add("b", 80), phase("valued"));
    s = run(s, { type: "START", at: 0 }, end("same"), end("down"));
    expect(order(s)).toEqual(["b80"]);
  });

  it("starting the phase again clears who has played and re-runs from the top", () => {
    let s = run(threeEntries(), end("down"), end("down"), end("up2"));
    s = run(s, phase("valued"));
    expect(played(s)).toEqual([]);
    expect(active(s)).toBe("c");
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
  });

  it("played entries only show while their list is running", () => {
    const s = run(threeEntries(), end("down"), phase("open"));
    expect(played(s)).toEqual([]);
  });
});

describe("value changes outside a turn", () => {
  it("re-sorts at once; an unplayed entry's place in the remaining order follows its value", () => {
    let s = threeEntries(); // A acting, B next
    s = run(s, setValue("c", 90));
    expect(order(s)).toEqual(["c90", "a80", "b80"]);
    // The acting entry keeps its turn; the new highest unplayed is next.
    expect(active(s)).toBe("a");
    expect(view(s)?.nextId).toBe("c");
    s = run(s, end("same"));
    expect(active(s)).toBe("c");
  });

  it("changing the acting entry's value does not end its turn", () => {
    const s = run(threeEntries(), setValue("a", 60));
    expect(order(s)).toEqual(["b80", "c70", "a60"]);
    expect(active(s)).toBe("a");
  });

  it("works while another phase runs, and records value history", () => {
    let s = run(init(), add("a", 80), add("b", 70));
    s = run(s, { type: "START", at: 0 }, end(undefined, 5), setValue("b", 90));
    expect(order(s)).toEqual(["b90", "a80"]);
    expect(s.valueHistory).toEqual([
      { entryId: "a", value: 80, turn: 0 },
      { entryId: "b", value: 70, turn: 0 },
      { entryId: "b", value: 90, turn: 1 },
    ]);
  });

  it("is a no-op for an unknown entry or an unchanged value", () => {
    const s = run(init(), add("a", 80));
    expect(run(s, setValue("zzz", 50))).toBe(s);
    expect(run(s, setValue("a", 80))).toBe(s);
  });
});

describe("owners", () => {
  it("reassigning an owner changes who later turns are credited to", () => {
    let s = run(threeEntries(), {
      type: "SET_TURN_ENTRY_PLAYER",
      entryId: "a",
      playerIndex: 2,
    });
    expect(selectCurrentPlayerIndex(s)).toBe(2);
    s = run(s, end("same"));
    expect(s.turns.at(-1)?.playerIndex).toBe(2);
  });
});

describe("combining entries", () => {
  const combine = (
    extra: Partial<
      Extract<GameSessionAction, { type: "COMBINE_TURN_ENTRIES" }>
    > = {},
  ): GameSessionAction => ({
    type: "COMBINE_TURN_ENTRIES",
    sourceIds: ["b", "c"],
    targetId: "t",
    playerIndex: 2,
    value: 70,
    at: 0,
    ...extra,
  });

  it("takes the sources out and brings the target in under its new name, owner and value", () => {
    const s = run(threeEntries(), combine());
    expect(order(s)).toEqual(["a80", "t70"]);
    const target = view(s)?.entries.find((e) => e.id === "t");
    expect(target?.label).toBe("Bravo Charlie Target");
    expect(target?.playerIndex).toBe(2);
    expect(s.valueHistory?.at(-1)).toEqual({
      entryId: "t",
      value: 70,
      turn: 0,
    });
  });

  it("names the target by its own name with the sources as lineage, in the order given", () => {
    const target = (s: ReturnType<typeof run>) =>
      s.turnEntries?.find((e) => e.id === "t");
    const s = run(threeEntries(), combine());
    expect(target(s)?.nameParts).toEqual({
      title: "Target",
      lineage: ["Bravo", "Charlie"],
    });
    const swapped = run(threeEntries(), combine({ sourceIds: ["c", "b"] }));
    expect(target(swapped)?.nameParts).toEqual({
      title: "Target",
      lineage: ["Charlie", "Bravo"],
    });
    expect(target(swapped)?.label).toBe("Charlie Bravo Target");
  });

  it("undo takes the target back to its own name", () => {
    const s = run(threeEntries(), combine(), { type: "UNDO" });
    const target = s.turnEntries?.find((e) => e.id === "t");
    expect(target?.label).toBe("Target");
    expect(target?.nameParts).toBeUndefined();
  });

  it("the target joins the bottom of its value's stack", () => {
    const s = run(
      threeEntries(),
      add("d", 70),
      combine({ sourceIds: ["a", "b"] }),
    );
    expect(order(s)).toEqual(["c70", "d70", "t70"]);
  });

  it("a target made from an entry that already played does not play again", () => {
    let s = run(threeEntries(), end("same")); // A played, B acting
    s = run(s, combine({ sourceIds: ["a", "c"], value: 80 }));
    expect(played(s)).toContain("t");
    expect(active(s)).toBe("b");
    s = run(s, end("same"));
    expect(active(s)).toBeNull();
  });

  it("combining the acting entry records its time and passes the turn on", () => {
    const s = run(
      threeEntries(),
      combine({ sourceIds: ["a", "c"], value: 70, elapsedSeconds: 33 }),
    );
    expect(s.turns.at(-1)).toMatchObject({ entryId: "a", elapsedSeconds: 33 });
    expect(active(s)).toBe("b");
    expect(played(s)).toContain("t");
  });

  it("refuses a target already in play or sources outside the list", () => {
    const s = threeEntries();
    expect(run(s, combine({ targetId: "a" }))).toBe(s);
    expect(run(s, combine({ sourceIds: ["b", "d"] }))).toBe(s);
  });

  it("a stand-in lends its name while only the real source leaves play", () => {
    const s = run(threeEntries(), combine({ sourceIds: ["s1", "b"] }));
    expect(order(s)).toEqual(["a80", "c70", "t70"]);
    const target = s.turnEntries?.find((e) => e.id === "t");
    expect(target?.nameParts).toEqual({
      title: "Target",
      lineage: ["Sierra", "Bravo"],
    });
    expect(target?.label).toBe("Sierra Bravo Target");
  });

  it("refuses a combine made only of stand-ins", () => {
    const s = threeEntries();
    expect(run(s, combine({ sourceIds: ["s1", "s2"] }))).toBe(s);
  });

  it("rejects a stand-in whose id is also a turn entry's", () => {
    expect(() =>
      parseGameDefinition({
        schemaVersion: 1,
        id: "v",
        name: "V",
        defaultExpectedTurns: 10,
        defaultAverageSeconds: 60,
        turnOrder: {
          ...VALUED,
          combine: {
            ...VALUED.combine,
            extraSources: {
              label: "Stand-ins",
              entries: [{ id: "a", label: "A" }],
            },
          },
        },
      }),
    ).toThrow(/stand-in/);
  });
});

describe("phases with an exit question and a default successor", () => {
  it("ending a phase mid-turn records the time so far for the acting entry's owner", () => {
    let s = run(init(), { type: "START", at: 0 }, end(undefined, 10));
    s = run(s, phase("valued", { elapsedSeconds: 25, at: 500 }));
    expect(
      s.turns.map((t) => [t.entryId, t.playerIndex, t.elapsedSeconds]),
    ).toEqual([
      ["seat-0", 0, 10],
      ["seat-1", 1, 25],
    ]);
    expect(s.currentTurnStartedAt).toBe(500);
  });

  it("a finished phase records nothing when the table moves on", () => {
    let s = run(threeEntries(), end("same"), end("same"), end("same"));
    const turns = s.turns.length;
    s = run(s, phase("valued", { elapsedSeconds: 99 }));
    expect(s.turns).toHaveLength(turns);
  });

  it("the exit answer moves that entry to the top for the next visit", () => {
    let s = run(init(), phase("valued", { exitFirstEntryId: "seat-2" }));
    expect(selectTurnOrder(s, "seats")?.entries.map((e) => e.id)).toEqual([
      "seat-2",
      "seat-0",
      "seat-1",
    ]);
    s = run(s, phase("open"));
    expect(selectCurrentPlayerIndex(s)).toBe(2);
  });

  it("offers the same phase again until it has run `repeat` times in a row", () => {
    let s = run(init(), phase("valued"));
    expect(selectTurnPhases(s)?.defaultNextId).toBe("valued");
    s = run(s, phase("valued"));
    expect(selectTurnPhases(s)?.defaultNextId).toBe("select");
    s = run(s, phase("select"));
    expect(selectTurnPhases(s)?.defaultNextId).toBe("open");
    expect(selectTurnPhases(s)?.phases[0].exitPrompt).toBe(
      "Who starts next time?",
    );
  });

  it("a phase limited to some kinds skips the others", () => {
    let s = run(
      init(),
      add("t", 90),
      add("a", 80),
      add("b", 70),
      { type: "START", at: 0 },
      phase("select"),
    );
    expect(active(s)).toBe("a");
    s = run(s, end());
    expect(active(s)).toBe("b");
    s = run(s, end());
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
  });
});

describe("undo across value-ordered play", () => {
  const undo: GameSessionAction = { type: "UNDO" };

  it("undoes a turn: value, position, played mark and the recorded time", () => {
    const before = run(threeEntries(), end("down"));
    const after = run(before, end("down"), undo);
    expect(order(after)).toEqual(order(before));
    expect(played(after)).toEqual(["a"]);
    expect(active(after)).toBe("b");
    expect(after.turns).toHaveLength(before.turns.length);
    expect(after.valueHistory).toEqual(before.valueHistory);
  });

  it("undoes an out-of-turn change on its own, leaving turns alone", () => {
    const before = run(threeEntries(), end("down"));
    const after = run(before, setValue("c", 100), undo);
    expect(order(after)).toEqual(order(before));
    expect(after.turns).toEqual(before.turns);
  });

  it("undoes an owner change", () => {
    const before = threeEntries();
    const after = run(
      before,
      { type: "SET_TURN_ENTRY_PLAYER", entryId: "a", playerIndex: 2 },
      undo,
    );
    expect(selectCurrentPlayerIndex(after)).toBe(0);
  });

  it("undoes a combine", () => {
    const before = threeEntries();
    const after = run(
      before,
      {
        type: "COMBINE_TURN_ENTRIES",
        sourceIds: ["b", "c"],
        targetId: "t",
        playerIndex: 1,
        value: 70,
        at: 0,
      },
      undo,
    );
    expect(order(after)).toEqual(order(before));
    expect(view(after)?.entries.find((e) => e.id === "t")).toBeUndefined();
  });

  it("undoes a phase switch, including the turn it recorded", () => {
    const before = run(threeEntries(), end("same"));
    const after = run(before, phase("open", { elapsedSeconds: 20 }), undo);
    expect(after.activePhaseId).toBe("valued");
    expect(after.turns).toHaveLength(before.turns.length);
    expect(active(after)).toBe("b");
    expect(played(after)).toEqual(["a"]);
  });

  it("undoes the end of a phase back into the last turn", () => {
    const before = run(threeEntries(), end("same"), end("same"));
    const after = run(before, end("same"), undo);
    expect(selectTurnPhases(after)?.pendingPrompt).toBe(false);
    expect(active(after)).toBe("c");
  });
});

describe("a kind that joins at the top", () => {
  const TOP: TurnOrder = {
    ...VALUED,
    entryKinds: [
      ...(VALUED.entryKinds ?? []),
      { id: "z", label: "Kind Z", ownerless: true, joinsAtTop: true },
    ],
    entries: [
      ...(VALUED.entries ?? []),
      { id: "z", label: "Zulu", kind: "z", inPlay: false },
    ],
    lists: VALUED.lists?.map((l) =>
      l.id === "valued" ? { ...l, kinds: ["x", "y", "z"] } : l,
    ),
  };
  const initTop = () =>
    createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
      turnOrder: TOP,
    });

  it("takes the highest value in the list and goes above the entries there", () => {
    const s = run(initTop(), add("a", 80), add("b", 90), add("c", 90), {
      type: "ACTIVATE_TURN_ENTRY",
      entry: { id: "z", value: 60 },
    });
    expect(order(s)).toEqual(["z90", "b90", "c90", "a80"]);
    expect(s.valueHistory?.at(-1)).toMatchObject({ entryId: "z", value: 90 });
  });

  it("uses the value given when the list has no values yet", () => {
    const s = run(initTop(), {
      type: "ACTIVATE_TURN_ENTRY",
      entry: { id: "z", value: 60 },
    });
    expect(order(s)).toEqual(["z60"]);
  });

  it("moves like any other entry afterwards", () => {
    const s = run(
      initTop(),
      add("b", 90),
      { type: "ACTIVATE_TURN_ENTRY", entry: { id: "z" } },
      setValue("b", 100),
      setValue("z", 100),
    );
    expect(order(s)).toEqual(["b100", "z100"]);
  });
});

describe("declared value order", () => {
  const withOrder = (
    valueOrder: NonNullable<
      NonNullable<TurnOrder["lists"]>[number]["valueOrder"]
    >,
  ) =>
    createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
      turnOrder: {
        ...VALUED,
        lists: VALUED.lists?.map((l) =>
          l.id === "valued" ? { ...l, valueOrder } : l,
        ),
      },
    });

  it("lowest-first puts the lowest value on top", () => {
    const s = run(
      withOrder({ direction: "lowest-first" }),
      add("a", 80),
      add("c", 70),
      add("b", 80),
    );
    expect(order(s)).toEqual(["c70", "a80", "b80"]);
  });

  it("above-equals puts an arrival above the entries already at its value", () => {
    const s = run(
      withOrder({ arrivals: "above-equals" }),
      add("a", 80),
      add("c", 70),
      add("b", 80),
    );
    expect(order(s)).toEqual(["b80", "a80", "c70"]);
  });

  it("rejects valueOrder on a list not ordered by value", () => {
    expect(() =>
      parseGameDefinition({
        schemaVersion: 1,
        id: "x",
        name: "X",
        defaultExpectedTurns: 1,
        defaultAverageSeconds: 1,
        turnOrder: {
          mode: "variable",
          lists: [
            {
              id: "l",
              label: "L",
              includePlayers: true,
              valueOrder: { direction: "lowest-first" },
            },
          ],
        },
      }),
    ).toThrow(/valueOrder/);
  });
});
