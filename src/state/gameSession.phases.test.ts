import { describe, expect, it } from "vitest";
import { parseGameDefinition, type TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  gameSessionReducer,
  type GameSessionState,
  projectAverageAfterTurn,
  selectAvailableTurnEntries,
  selectCurrentPlayerIndex,
  selectTurnOrder,
  selectTurnPhases,
} from "./gameSession";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

// Two lists: seated players, and declared entries of kinds "a" / "b".
// Three phases: one pass over the players, then two over the others.
const TWO_LISTS: TurnOrder = {
  mode: "variable",
  entryKinds: [
    { id: "a", label: "Kind A" },
    { id: "b", label: "Kind B" },
  ],
  entries: [
    { id: "a1", label: "A one", kind: "a" },
    { id: "a2", label: "A two", kind: "a" },
    { id: "b1", label: "B one", kind: "b", inPlay: false },
  ],
  lists: [
    { id: "people", label: "Players", includePlayers: true },
    {
      id: "others",
      label: "Others",
      kinds: ["a", "b"],
      onRoundEnd: "prompt-phase",
    },
  ],
  phases: [
    { id: "p", label: "Player phase", list: "people", averageSeconds: 30 },
    { id: "o1", label: "Other phase 1", list: "others", averageSeconds: 150 },
    { id: "o2", label: "Other phase 2", list: "others", next: "p" },
  ],
};

const init = () =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(3),
    turnOrder: TWO_LISTS,
  });

const run = (state: GameSessionState, ...actions: GameSessionAction[]) =>
  actions.reduce(gameSessionReducer, state);

const turn = (elapsedSeconds: number, at = 1000): GameSessionAction => ({
  type: "NEXT_TURN",
  elapsedSeconds,
  at,
});

const phase = (phaseId: string, at = 5000): GameSessionAction => ({
  type: "SET_PHASE",
  phaseId,
  at,
});

const ids = (state: GameSessionState, listId?: string) =>
  selectTurnOrder(state, listId)?.entries.map((e) => e.id);

describe("variable turn order with several lists and phases", () => {
  it("seeds each list by membership and starts in the first phase", () => {
    const s = init();
    expect(ids(s, "people")).toEqual(["seat-0", "seat-1", "seat-2"]);
    expect(ids(s, "others")).toEqual(["a1", "a2"]);
    expect(selectTurnOrder(s)?.listId).toBe("people");
    expect(selectTurnOrder(s)?.phaseLabel).toBe("Player phase");
    expect(selectCurrentPlayerIndex(s)).toBe(0);
    expect(selectAvailableTurnEntries(s, "others").map((e) => e.id)).toEqual([
      "b1",
    ]);
  });

  it("switching phase runs the other list from its top", () => {
    let s = run(init(), turn(10)); // seat-1 active in people
    s = run(s, phase("o1"));
    const view = selectTurnOrder(s)!;
    expect(view.listId).toBe("others");
    expect(view.activeId).toBe("a1");
    expect(view.kindLabels).toEqual({ a: "Kind A", b: "Kind B" });
    // A non-player entry is active.
    expect(selectCurrentPlayerIndex(s)).toBeNull();
    // The people list kept its own position.
    expect(selectTurnOrder(s, "people")?.activeId).toBe("seat-1");
  });

  it("each list keeps its own order", () => {
    let s = run(init(), {
      type: "REORDER_TURN_ENTRY",
      entryId: "a2",
      toIndex: 0,
    });
    expect(ids(s, "others")).toEqual(["a2", "a1"]);
    expect(ids(s, "people")).toEqual(["seat-0", "seat-1", "seat-2"]);
    s = run(s, phase("o1"));
    expect(selectTurnOrder(s)?.activeId).toBe("a2");
  });

  it("keeps a separate running average per phase", () => {
    let s = init();
    s = run(s, { type: "START", at: 0 }, turn(10), turn(20));
    expect(s.averageSeconds).toBe(15);
    // No turns in o1 yet: its declared default applies.
    s = run(s, phase("o1"));
    expect(s.averageSeconds).toBe(150);
    expect(projectAverageAfterTurn(s, 100)).toBe(100);
    s = run(s, turn(100), turn(200));
    expect(s.averageSeconds).toBe(150);
    // o2 declares no default and has no turns: the session start value.
    s = run(s, phase("o2"));
    expect(s.averageSeconds).toBe(300);
    s = run(s, phase("p"));
    expect(s.averageSeconds).toBe(15);
  });

  it("starts on the opening phase's declared average", () => {
    expect(init().averageSeconds).toBe(30);
    const installed = run(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: seats(3),
      }),
      { type: "SET_TURN_ORDER", turnOrder: TWO_LISTS },
    );
    expect(installed.averageSeconds).toBe(30);
    expect(run(installed, { type: "RESET" }).averageSeconds).toBe(30);
  });

  it("falls back to the starting average for an opening phase with no declared one", () => {
    let s = run(init(), {
      type: "SET_STARTING_AVERAGE",
      seconds: 90,
    });
    expect(s.averageSeconds).toBe(30);
    s = run(s, phase("o2"));
    expect(s.averageSeconds).toBe(90);
  });

  it("SET_PHASE restarts the in-progress turn clock", () => {
    let s = run(init(), { type: "START", at: 0 });
    s = run(s, phase("o1", 4321));
    expect(s.currentTurnStartedAt).toBe(4321);
  });

  it("flags a phase prompt when a prompt-phase list wraps, and offers the default next phase", () => {
    let s = run(init(), phase("o1"));
    expect(selectTurnPhases(s)?.defaultNextId).toBe("o2");
    s = run(s, turn(10));
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
    s = run(s, turn(10)); // a2 was last
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
    expect(selectTurnOrder(s)?.activeId).toBe("a1");
    s = run(s, phase("o2"));
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
    // o2 declares `next: "p"`.
    expect(selectTurnPhases(s)?.defaultNextId).toBe("p");
  });

  it("the players list just wraps by default", () => {
    const s = run(init(), turn(1), turn(1), turn(1));
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
    expect(selectCurrentPlayerIndex(s)).toBe(0);
  });

  it("undo steps back one action at a time across a phase change", () => {
    let s = run(init(), { type: "START", at: 0 }, turn(10), turn(20));
    s = run(s, phase("o1"));
    s = run(s, { type: "REORDER_TURN_ENTRY", entryId: "a2", toIndex: 0 });
    // Reordered before the phase's first turn, so a2 opens.
    s = run(s, turn(100));
    s = run(s, { type: "UNDO" });
    expect(selectTurnOrder(s)?.phaseId).toBe("o1");
    expect(selectTurnOrder(s)?.activeId).toBe("a2");
    expect(s.averageSeconds).toBe(150);
    // The reorder is its own step.
    s = run(s, { type: "UNDO" });
    expect(ids(s, "others")).toEqual(["a1", "a2"]);
    // Then the phase switch: back in the player phase, seat-2 up.
    s = run(s, { type: "UNDO" });
    expect(selectTurnOrder(s)?.phaseId).toBe("p");
    expect(selectCurrentPlayerIndex(s)).toBe(2);
    expect(s.averageSeconds).toBe(15);
    s = run(s, { type: "UNDO" });
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    expect(s.averageSeconds).toBe(10);
  });

  it("activation goes to the entry's own list, whatever list is running", () => {
    let s = run(init(), {
      type: "ACTIVATE_TURN_ENTRY",
      entry: { id: "b1" },
      toIndex: 1,
    });
    expect(ids(s, "others")).toEqual(["a1", "b1", "a2"]);
    expect(ids(s, "people")).toEqual(["seat-0", "seat-1", "seat-2"]);
    // Deactivate two, activate one: a merge expressed as three actions.
    s = run(
      s,
      { type: "DEACTIVATE_TURN_ENTRY", entryId: "a1" },
      { type: "DEACTIVATE_TURN_ENTRY", entryId: "a2" },
    );
    expect(ids(s, "others")).toEqual(["b1"]);
    expect(
      selectAvailableTurnEntries(s, "others")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["a1", "a2"]);
  });

  it("a list that is not running may be emptied, the running one may not", () => {
    let s = run(
      init(),
      { type: "DEACTIVATE_TURN_ENTRY", entryId: "a1" },
      { type: "DEACTIVATE_TURN_ENTRY", entryId: "a2" },
    );
    expect(ids(s, "others")).toEqual([]);
    expect(selectTurnOrder(s, "others")?.activeId).toBeNull();
    // Running an empty list: turns still record, with no entry.
    s = run(s, phase("o1"), turn(5));
    expect(s.turns.at(-1)).toMatchObject({ phaseId: "o1", playerIndex: null });
    expect(s.turns.at(-1)?.entryId).toBeUndefined();
    // Activating into the empty running list makes the entry active.
    s = run(s, { type: "ACTIVATE_TURN_ENTRY", entry: { id: "a2" } });
    expect(selectTurnOrder(s)?.activeId).toBe("a2");
    const before = s;
    s = run(s, { type: "DEACTIVATE_TURN_ENTRY", entryId: "a2" });
    expect(s).toBe(before);
  });

  it("attributes a linked entry's turns to its player", () => {
    let s = run(
      init(),
      { type: "SET_TURN_ENTRY_PLAYER", entryId: "a1", playerIndex: 2 },
      phase("o1"),
    );
    expect(selectCurrentPlayerIndex(s)).toBe(2);
    s = run(s, turn(30));
    expect(s.turns[0]).toMatchObject({ entryId: "a1", playerIndex: 2 });
  });

  it("validates phase and list references in the definition", () => {
    const base = {
      schemaVersion: 1,
      id: "x",
      name: "X",
      defaultExpectedTurns: 10,
      defaultAverageSeconds: 60,
    };
    expect(() =>
      parseGameDefinition({ ...base, turnOrder: TWO_LISTS }),
    ).not.toThrow();
    expect(() =>
      parseGameDefinition({
        ...base,
        turnOrder: {
          mode: "variable",
          phases: [{ id: "x", label: "X", list: "missing" }],
        },
      }),
    ).toThrow(/unknown turn list/);
    expect(() =>
      parseGameDefinition({
        ...base,
        turnOrder: {
          mode: "variable",
          phases: [{ id: "x", label: "X", list: "main", next: "nope" }],
        },
      }),
    ).toThrow(/unknown turn phase/);
    expect(() =>
      parseGameDefinition({
        ...base,
        turnOrder: {
          mode: "variable",
          entries: [{ id: "seat-9", label: "S" }],
        },
      }),
    ).toThrow(/seat-/);
  });
});

describe("starting a phase from a chosen entry", () => {
  it("rotates the named entry to the top and makes it active", () => {
    let s = run(init(), phase("o1"), phase("p"));
    s = run(s, {
      type: "SET_PHASE",
      phaseId: "p",
      at: 1,
      firstEntryId: "seat-2",
    });
    expect(ids(s, "people")).toEqual(["seat-2", "seat-0", "seat-1"]);
    expect(selectCurrentPlayerIndex(s)).toBe(2);
  });

  it("ignores an entry that is not in the phase's list", () => {
    const s = run(init(), {
      type: "SET_PHASE",
      phaseId: "o1",
      at: 1,
      firstEntryId: "seat-1",
    });
    expect(ids(s, "others")).toEqual(["a1", "a2"]);
    expect(selectTurnOrder(s)?.activeId).toBe("a1");
  });

  it("undo after a rotated start restores the earlier order", () => {
    let s = run(init(), { type: "START", at: 0 }, turn(5));
    s = run(s, {
      type: "SET_PHASE",
      phaseId: "p",
      at: 1,
      firstEntryId: "seat-2",
    });
    s = run(s, turn(5), { type: "UNDO" });
    expect(ids(s, "people")).toEqual(["seat-2", "seat-0", "seat-1"]);
    s = run(s, { type: "UNDO" });
    expect(ids(s, "people")).toEqual(["seat-0", "seat-1", "seat-2"]);
  });
});

describe("dismissing the phase prompt", () => {
  it("keeps the current phase running from the top", () => {
    let s = run(init(), phase("o1"), turn(1), turn(1));
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
    s = run(s, { type: "DISMISS_PHASE_PROMPT" });
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(false);
    expect(selectTurnOrder(s)?.phaseId).toBe("o1");
    expect(selectTurnOrder(s)?.activeId).toBe("a1");
  });

  it("is a no-op with no prompt pending", () => {
    const s = init();
    expect(run(s, { type: "DISMISS_PHASE_PROMPT" })).toBe(s);
  });
});

describe("phase prompts", () => {
  it("exposes each phase's first-entry prompt", () => {
    const withPrompt: TurnOrder = {
      ...TWO_LISTS,
      phases: TWO_LISTS.phases?.map((p) =>
        p.id === "p" ? { ...p, firstEntryPrompt: "Who goes first?" } : p,
      ),
    };
    const phases = selectTurnPhases(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: seats(3),
        turnOrder: withPrompt,
      }),
    )?.phases;
    expect(phases?.find((p) => p.id === "p")?.firstEntryPrompt).toBe(
      "Who goes first?",
    );
    expect(phases?.find((p) => p.id === "o1")).not.toHaveProperty(
      "firstEntryPrompt",
    );
  });
});
