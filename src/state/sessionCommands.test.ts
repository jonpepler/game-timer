import { describe, expect, it } from "vitest";
import type { TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  selectCurrentPlayerIndex,
  selectRemainingTurns,
  selectTurnOrder,
} from "./gameSession";
import {
  authorizeCommand,
  type CommandActor,
  checkCommand,
  currentPhaseRef,
  DEFAULT_COMMAND_POLICY,
  projectCommand,
  type SessionCommand,
  SessionCommandSchema,
  validateCommand,
} from "./sessionCommands";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

// Seats play in "open"; valued entries play in "valued", highest first,
// moving along the track at the end of each turn.
const ORDER: TurnOrder = {
  mode: "variable",
  entryKinds: [
    { id: "x", label: "Kind X" },
    { id: "y", label: "Kind Y" },
  ],
  entries: [
    { id: "a", label: "Alpha", kind: "x", inPlay: false },
    { id: "b", label: "Bravo", kind: "x", inPlay: false },
    { id: "t", label: "Target", kind: "y", inPlay: false },
  ],
  entryValues: {
    label: "Value",
    track: [0, 10, 20, 30, 40, 50, 60, 70, 80],
    startValues: [60, 70, 80],
    steps: [
      { id: "down", label: "Down", effect: "move", spaces: -1 },
      { id: "up", label: "Up", effect: "move", spaces: 1 },
    ],
  },
  combine: {
    label: "Combine",
    sourceKind: "x",
    count: 2,
    targetKind: "y",
    extraSources: {
      label: "Stand-ins",
      entries: [
        { id: "s1", label: "Sierra" },
        { id: "s2", label: "Tango" },
      ],
    },
  },
  lists: [
    { id: "seats", label: "Seats", includePlayers: true },
    {
      id: "valued",
      label: "Valued",
      kinds: ["x", "y"],
      orderBy: "value",
      ownerRequired: true,
    },
  ],
  phases: [
    { id: "open", label: "Open", list: "seats", next: "valued" },
    {
      id: "valued",
      label: "Valued",
      list: "valued",
      next: "open",
      repeat: 2,
      valueStepOnTurnEnd: true,
    },
  ],
};

const HOST: CommandActor = { kind: "host" };
const GUEST: CommandActor = { kind: "guest" };
const seat = (seatIndex: number): CommandActor => ({ kind: "seat", seatIndex });

const started = (): GameSessionState =>
  projectCommand(
    createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
      turnOrder: ORDER,
    }),
    { type: "END_TURN" },
    0,
  );

// Apply commands as the host would, failing loudly on a refusal.
const apply = (state: GameSessionState, ...commands: SessionCommand[]) =>
  commands.reduce((s, command) => {
    const verdict = checkCommand(s, command, HOST);
    if (!verdict.ok) throw new Error(`${command.type}: ${verdict.reason}`);
    return projectCommand(s, command, 0);
  }, state);

// Two entries in play in the valued list, seat 1 owning "a".
const withEntries = () =>
  apply(
    started(),
    { type: "ACTIVATE_ENTRY", entryId: "a", value: 80, playerIndex: 1 },
    { type: "ACTIVATE_ENTRY", entryId: "b", value: 60, playerIndex: 2 },
  );

describe("SessionCommandSchema", () => {
  it("accepts each command shape", () => {
    const commands: SessionCommand[] = [
      { type: "END_TURN", valueStepId: "up", atTurn: 3, undoGroup: "flow-1" },
      { type: "ACTIVATE_ENTRY", entryId: "a", value: 60, playerIndex: 0 },
      { type: "DEACTIVATE_ENTRY", entryId: "a" },
      { type: "REORDER_ENTRY", entryId: "seat-0", toIndex: 2 },
      { type: "SET_ENTRY_OWNER", entryId: "a", playerIndex: null },
      { type: "SET_ENTRY_VALUE", entryId: "a", value: 70 },
      {
        type: "COMBINE_ENTRIES",
        sourceIds: ["a", "b"],
        targetId: "t",
        playerIndex: 1,
        value: 70,
      },
      {
        type: "SET_PHASE",
        phaseId: "valued",
        exitFirstEntryId: "seat-1",
        from: { phaseId: "open", run: 1 },
      },
      { type: "DISMISS_PHASE_PROMPT", from: { phaseId: "valued", run: 2 } },
      { type: "INCREMENT_SCORE", playerIndex: 0, delta: -1 },
      { type: "TRIGGER_CONTROL", controlId: "c" },
      { type: "UNDO", atRevision: 4 },
      { type: "SET_PAUSED", paused: true },
      { type: "SET_EXPECTED_TURNS", expectedTurns: 30 },
      { type: "UNDO" },
    ];
    for (const command of commands)
      expect(SessionCommandSchema.parse(command)).toEqual(command);
  });

  it("covers every command type in the default policy", () => {
    const types = SessionCommandSchema.options.map((o) => o.shape.type.value);
    expect(Object.keys(DEFAULT_COMMAND_POLICY).sort()).toEqual(
      [...types].sort(),
    );
  });

  it.each([
    ["an unknown type", { type: "REDO" }],
    ["a negative revision", { type: "UNDO", atRevision: -1 }],
    [
      "a fractional turn total",
      { type: "SET_EXPECTED_TURNS", expectedTurns: 2.5 },
    ],
    ["a missing pause flag", { type: "SET_PAUSED" }],
    ["a missing entry id", { type: "DEACTIVATE_ENTRY" }],
    ["an empty entry id", { type: "DEACTIVATE_ENTRY", entryId: "" }],
    [
      "a negative seat",
      { type: "SET_ENTRY_OWNER", entryId: "a", playerIndex: -1 },
    ],
    [
      "a fractional seat",
      { type: "INCREMENT_SCORE", playerIndex: 0.5, delta: 1 },
    ],
    [
      "no sources",
      {
        type: "COMBINE_ENTRIES",
        sourceIds: [],
        targetId: "t",
        playerIndex: 0,
      },
    ],
    [
      "a bad phase reference",
      { type: "SET_PHASE", phaseId: "x", from: { phaseId: "x", run: 0 } },
    ],
    ["a string value", { type: "SET_ENTRY_VALUE", entryId: "a", value: "70" }],
  ])("rejects %s", (_, raw) => {
    expect(SessionCommandSchema.safeParse(raw).success).toBe(false);
  });
});

describe("authorizeCommand", () => {
  const tableCommands: SessionCommand[] = [
    { type: "ACTIVATE_ENTRY", entryId: "t" },
    { type: "DEACTIVATE_ENTRY", entryId: "a" },
    { type: "SET_ENTRY_OWNER", entryId: "a", playerIndex: 0 },
    { type: "SET_ENTRY_VALUE", entryId: "a", value: 70 },
    { type: "SET_PHASE", phaseId: "valued" },
    { type: "DISMISS_PHASE_PROMPT" },
    {
      type: "COMBINE_ENTRIES",
      sourceIds: ["a", "b"],
      targetId: "t",
      playerIndex: 0,
    },
  ];

  it("lets any claimed seat run table commands", () => {
    const state = withEntries();
    for (const command of tableCommands)
      for (const s of [0, 1, 2])
        expect(authorizeCommand(state, command, seat(s))).toEqual({ ok: true });
  });

  it("refuses everything from a screen without a seat", () => {
    const state = withEntries();
    for (const command of [...tableCommands, { type: "END_TURN" } as const])
      expect(authorizeCommand(state, command, GUEST).ok).toBe(false);
  });

  it("lets the host run anything", () => {
    const state = withEntries();
    expect(
      authorizeCommand(state, { type: "END_TURN" }, HOST).ok &&
        authorizeCommand(
          state,
          { type: "INCREMENT_SCORE", playerIndex: 2, delta: 1 },
          HOST,
        ).ok,
    ).toBe(true);
  });

  it("only lets the acting entry's owner end the turn", () => {
    const state = apply(withEntries(), {
      type: "SET_PHASE",
      phaseId: "valued",
    });
    // "a" (value 80, seat 1) acts first.
    expect(selectTurnOrder(state)?.activeId).toBe("a");
    expect(selectCurrentPlayerIndex(state)).toBe(1);
    expect(authorizeCommand(state, { type: "END_TURN" }, seat(1))).toEqual({
      ok: true,
    });
    expect(authorizeCommand(state, { type: "END_TURN" }, seat(2))).toEqual({
      ok: false,
      reason: "It is not your turn",
    });
  });

  it("lets any claimed seat end a turn no seat owns", () => {
    const state = apply(
      withEntries(),
      { type: "SET_ENTRY_OWNER", entryId: "a", playerIndex: null },
      { type: "SET_PHASE", phaseId: "valued" },
    );
    expect(selectTurnOrder(state)?.activeId).toBe("a");
    expect(selectCurrentPlayerIndex(state)).toBeNull();
    for (const s of [0, 1, 2])
      expect(authorizeCommand(state, { type: "END_TURN" }, seat(s))).toEqual({
        ok: true,
      });
    expect(authorizeCommand(state, { type: "END_TURN" }, GUEST).ok).toBe(false);
  });

  it("lets any claimed seat undo, but not a screen without a seat", () => {
    const state = withEntries();
    for (const s of [0, 1, 2])
      expect(authorizeCommand(state, { type: "UNDO" }, seat(s))).toEqual({
        ok: true,
      });
    expect(authorizeCommand(state, { type: "UNDO" }, GUEST)).toEqual({
      ok: false,
      reason: "Claim a seat first",
    });
  });

  it("lets any screen act for the table in a running game without players", () => {
    const unstarted = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 10,
    });
    const running = projectCommand(unstarted, { type: "END_TURN" }, 0);
    for (const command of [
      { type: "UNDO" },
      { type: "SET_PAUSED", paused: true },
      { type: "SET_EXPECTED_TURNS", expectedTurns: 20 },
      { type: "END_TURN" },
    ] as const) {
      expect(authorizeCommand(running, command, GUEST)).toEqual({ ok: true });
      // Before the clock starts setup may still be seating players.
      expect(authorizeCommand(unstarted, command, GUEST).ok).toBe(false);
    }
    // Commands about one seat still need that seat.
    expect(
      authorizeCommand(
        running,
        { type: "INCREMENT_SCORE", playerIndex: 0, delta: 1 },
        GUEST,
      ).ok,
    ).toBe(false);
    // While setup seats players, a screen claims a seat first.
    expect(
      authorizeCommand(
        running,
        { type: "UNDO" },
        GUEST,
        DEFAULT_COMMAND_POLICY,
        {
          seating: { seats: [], minPlayers: 1, maxPlayers: 4 },
        },
      ).ok,
    ).toBe(false);
  });

  it("binds score changes to the issuing seat", () => {
    const state = started();
    const bump = (playerIndex: number): SessionCommand => ({
      type: "INCREMENT_SCORE",
      playerIndex,
      delta: 1,
    });
    expect(authorizeCommand(state, bump(1), seat(1)).ok).toBe(true);
    expect(authorizeCommand(state, bump(0), seat(1)).ok).toBe(false);
  });

  it("binds controls to what the seat may trigger", () => {
    const state = projectCommand(
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 30,
        players: seats(3),
        turnOrder: {
          mode: "lead-relative",
          roundEnd: { type: "prompt-lead", label: "Who leads?" },
        },
        controls: [
          { id: "pass", label: "Pass", effect: { type: "claim-next-lead" } },
        ],
        leadIndex: 0,
      }),
      { type: "END_TURN" },
      0,
    );
    const command: SessionCommand = {
      type: "TRIGGER_CONTROL",
      controlId: "pass",
    };
    const active = selectCurrentPlayerIndex(state) ?? 0;
    expect(authorizeCommand(state, command, seat(active)).ok).toBe(true);
    expect(authorizeCommand(state, command, seat((active + 1) % 3)).ok).toBe(
      false,
    );
  });

  it("follows a stricter policy when given one", () => {
    const state = withEntries();
    const policy = { ...DEFAULT_COMMAND_POLICY, SET_PHASE: "turn" as const };
    // Seat 0 is active in the seats list.
    expect(
      authorizeCommand(
        state,
        { type: "SET_PHASE", phaseId: "valued" },
        seat(0),
        policy,
      ).ok,
    ).toBe(true);
    expect(
      authorizeCommand(
        state,
        { type: "SET_PHASE", phaseId: "valued" },
        seat(2),
        policy,
      ).ok,
    ).toBe(false);
  });
});

describe("validateCommand", () => {
  it("refuses a second answer to the same phase prompt", () => {
    const state = withEntries();
    const from = currentPhaseRef(state);
    const answer: SessionCommand = {
      type: "SET_PHASE",
      phaseId: "valued",
      from,
    };
    expect(validateCommand(state, answer)).toEqual({ ok: true });
    const after = projectCommand(state, answer, 0);
    expect(validateCommand(after, answer)).toEqual({
      ok: false,
      reason: "The phase already changed on another device",
    });
  });

  it("refuses repeating a phase twice from one prompt", () => {
    // Both entries play, the valued phase wraps and asks what next.
    const over = apply(
      withEntries(),
      { type: "SET_PHASE", phaseId: "valued" },
      { type: "END_TURN", valueStepId: "up" },
      { type: "END_TURN", valueStepId: "up" },
    );
    expect(over.pendingPhasePrompt).toBe(true);
    const from = currentPhaseRef(over);
    const again: SessionCommand = {
      type: "SET_PHASE",
      phaseId: "valued",
      from,
    };
    const once = projectCommand(over, again, 0);
    expect(once.phaseRun).toBe(2);
    expect(validateCommand(once, again).ok).toBe(false);
    // Nor can the prompt be dismissed after it was answered.
    expect(
      validateCommand(once, { type: "DISMISS_PHASE_PROMPT", from }).ok,
    ).toBe(false);
  });

  it("refuses ending a turn that already ended", () => {
    const state = apply(withEntries(), {
      type: "SET_PHASE",
      phaseId: "valued",
    });
    const end: SessionCommand = {
      type: "END_TURN",
      valueStepId: "up",
      atTurn: state.turns.length,
    };
    expect(validateCommand(state, end)).toEqual({ ok: true });
    expect(validateCommand(projectCommand(state, end, 0), end)).toEqual({
      ok: false,
      reason: "That turn already ended",
    });
  });

  it("undoes a turn and its value step as the host's undo does", () => {
    const before = apply(withEntries(), {
      type: "SET_PHASE",
      phaseId: "valued",
    });
    const ended = apply(before, { type: "END_TURN", valueStepId: "down" });
    const alphaValue = (s: GameSessionState) =>
      s.turnEntries?.find((e) => e.id === "a")?.value;
    expect(alphaValue(ended)).toBe(70);

    const undo: SessionCommand = {
      type: "UNDO",
      atRevision: ended.revision,
    };
    const undone = apply(ended, undo);
    expect(undone.turns).toHaveLength(before.turns.length);
    expect(alphaValue(undone)).toBe(80);
    expect(selectTurnOrder(undone)?.activeId).toBe("a");
  });

  it("refuses a second undo citing a history that already moved", () => {
    const state = apply(started(), { type: "END_TURN" });
    const undo: SessionCommand = {
      type: "UNDO",
      atRevision: state.revision,
    };
    expect(validateCommand(state, undo)).toEqual({ ok: true });
    // Two phones tap Undo on the same screen: only the first applies.
    expect(validateCommand(projectCommand(state, undo, 0), undo)).toEqual({
      ok: false,
      reason: "That changed on another device",
    });
    // Nor does an undo apply after another screen acted.
    const acted = apply(state, { type: "END_TURN" });
    expect(validateCommand(acted, undo).ok).toBe(false);
  });

  it("refuses an undo built before a change that left the history the same size", () => {
    // Fill the undo history to its cap, so the next action drops the
    // oldest snapshot and its depth stays put.
    let state = withEntries();
    for (let i = 0; i < 70; i++)
      state = apply(state, {
        type: "SET_ENTRY_VALUE",
        entryId: "a",
        value: i % 2 ? 80 : 70,
      });
    const undo: SessionCommand = {
      type: "UNDO",
      atRevision: state.revision,
    };
    const after = apply(state, {
      type: "SET_ENTRY_VALUE",
      entryId: "b",
      value: 70,
    });
    expect(after.undoStack).toHaveLength(state.undoStack?.length ?? 0);
    expect(after.turns).toHaveLength(state.turns.length);
    expect(validateCommand(after, undo)).toEqual({
      ok: false,
      reason: "That changed on another device",
    });
  });

  it("pauses only a running, timed clock", () => {
    const pause: SessionCommand = { type: "SET_PAUSED", paused: true };
    const fresh = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
    });
    expect(validateCommand(fresh, pause)).toEqual({
      ok: false,
      reason: "The clock has not started",
    });
    expect(validateCommand(started(), pause)).toEqual({ ok: true });
    // The clock is not game state, so pausing leaves the game alone.
    const state = started();
    expect(projectCommand(state, pause, 0)).toBe(state);
  });

  it("sets the turn total, never below the turns already played", () => {
    const state = apply(started(), { type: "END_TURN" }, { type: "END_TURN" });
    expect(
      validateCommand(state, { type: "SET_EXPECTED_TURNS", expectedTurns: 1 }),
    ).toEqual({ ok: false, reason: "Fewer than the turns already played" });
    const set = apply(state, {
      type: "SET_EXPECTED_TURNS",
      expectedTurns: 12,
    });
    expect(selectRemainingTurns(set)).toBe(10);
  });

  it("refuses an undo with nothing to take back", () => {
    const fresh = createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
    });
    expect(validateCommand(fresh, { type: "UNDO" })).toEqual({
      ok: false,
      reason: "Nothing to undo",
    });
  });

  it("needs a value step when the phase asks for one", () => {
    const state = apply(withEntries(), {
      type: "SET_PHASE",
      phaseId: "valued",
    });
    expect(validateCommand(state, { type: "END_TURN" }).ok).toBe(false);
    expect(
      validateCommand(state, { type: "END_TURN", valueStepId: "sideways" }).ok,
    ).toBe(false);
  });

  it("refuses adding an entry another screen already added", () => {
    const state = withEntries();
    expect(
      validateCommand(state, { type: "ACTIVATE_ENTRY", entryId: "a" }),
    ).toEqual({ ok: false, reason: "Already added on another device" });
  });

  it("refuses values off the track and unknown owners", () => {
    const state = started();
    expect(
      validateCommand(state, {
        type: "ACTIVATE_ENTRY",
        entryId: "a",
        value: 65,
      }).ok,
    ).toBe(false);
    expect(
      validateCommand(state, {
        type: "ACTIVATE_ENTRY",
        entryId: "a",
        value: 60,
        playerIndex: 7,
      }).ok,
    ).toBe(false);
    expect(
      validateCommand(withEntries(), {
        type: "SET_ENTRY_VALUE",
        entryId: "a",
        value: 75,
      }).ok,
    ).toBe(false);
  });

  it("refuses a combine whose sources changed", () => {
    const combine: SessionCommand = {
      type: "COMBINE_ENTRIES",
      sourceIds: ["a", "b"],
      targetId: "t",
      playerIndex: 0,
      value: 70,
    };
    const state = withEntries();
    expect(validateCommand(state, combine)).toEqual({ ok: true });
    const merged = projectCommand(state, combine, 0);
    expect(merged.turnLists?.find((l) => l.id === "valued")?.order).toEqual([
      "t",
    ]);
    expect(validateCommand(merged, combine).ok).toBe(false);
  });

  it("accepts a stand-in in place of one source, never in place of all", () => {
    const state = withEntries();
    const combine = (sourceIds: string[]): SessionCommand => ({
      type: "COMBINE_ENTRIES",
      sourceIds,
      targetId: "t",
      playerIndex: 0,
      value: 80,
    });
    expect(validateCommand(state, combine(["a", "s1"]))).toEqual({ ok: true });
    expect(validateCommand(state, combine(["s1", "s2"])).ok).toBe(false);
    expect(validateCommand(state, combine(["a", "a"])).ok).toBe(false);
    const merged = projectCommand(state, combine(["s1", "a"]), 0);
    expect(merged.turnLists?.find((l) => l.id === "valued")?.order).toEqual([
      "t",
      "b",
    ]);
  });

  it("refuses reordering a list that orders itself", () => {
    const state = withEntries();
    expect(
      validateCommand(state, {
        type: "REORDER_ENTRY",
        entryId: "a",
        toIndex: 1,
      }).ok,
    ).toBe(false);
    expect(
      validateCommand(state, {
        type: "REORDER_ENTRY",
        entryId: "seat-0",
        toIndex: 2,
      }).ok,
    ).toBe(true);
  });

  it("allows reordering among equal values only where the list says so", () => {
    const reorderable: TurnOrder = {
      ...ORDER,
      lists: ORDER.lists?.map((l) =>
        l.id === "valued" ? { ...l, valueOrder: { reorderEqual: true } } : l,
      ),
    };
    const state = apply(
      projectCommand(
        createInitialGameSessionState({
          initialAverageSeconds: 300,
          expectedTurns: 90,
          players: seats(3),
          turnOrder: reorderable,
        }),
        { type: "END_TURN" },
        0,
      ),
      { type: "ACTIVATE_ENTRY", entryId: "a", value: 80, playerIndex: 1 },
      { type: "ACTIVATE_ENTRY", entryId: "b", value: 80, playerIndex: 2 },
      { type: "ACTIVATE_ENTRY", entryId: "t", value: 60, playerIndex: 0 },
    );
    const move = (entryId: string, toIndex: number): SessionCommand => ({
      type: "REORDER_ENTRY",
      entryId,
      toIndex,
    });
    expect(validateCommand(state, move("b", 0))).toEqual({ ok: true });
    expect(validateCommand(state, move("t", 1)).ok).toBe(false);
    expect(validateCommand(state, move("a", 2)).ok).toBe(false);
  });

  it("refuses game actions once the game is over", () => {
    const state = { ...withEntries(), victor: 0 };
    expect(
      validateCommand(state, {
        type: "SET_ENTRY_VALUE",
        entryId: "a",
        value: 70,
      }).ok,
    ).toBe(false);
  });
});
