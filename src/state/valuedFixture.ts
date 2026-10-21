import type { TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  gameSessionReducer,
  type GameSessionState,
  selectTurnOrder,
} from "./gameSession";

// A generic fixture shared by the value-ordered list tests.
export const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, metadata: {} }));

// Seats take turns in "open"; valued entries take turns in "valued" (once
// each, highest value first) and "select" (kind "x" only, no steps).
export const VALUED: TurnOrder = {
  mode: "variable",
  entryKinds: [
    { id: "x", label: "Kind X" },
    { id: "y", label: "Kind Y" },
  ],
  entries: [
    { id: "a", label: "Alpha", kind: "x", inPlay: false },
    { id: "b", label: "Bravo", kind: "x", inPlay: false },
    { id: "c", label: "Charlie", kind: "x", inPlay: false },
    { id: "d", label: "Delta", kind: "x", inPlay: false },
    { id: "t", label: "Target", kind: "y", inPlay: false },
  ],
  entryValues: {
    label: "Value",
    track: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150],
    startValues: [60, 70, 80, 90],
    removeAt: 0,
    steps: [
      { id: "gone", label: "Gone", effect: "remove" },
      { id: "down", label: "Down", effect: "move", spaces: -1 },
      { id: "same", label: "Same", effect: "move", spaces: 0 },
      { id: "up", label: "Up", effect: "move", spaces: 1 },
      { id: "up2", label: "Up two", effect: "move", spaces: 2 },
    ],
  },
  combine: {
    label: "Combine",
    sourceKind: "x",
    count: 2,
    targetKind: "y",
    value: "mean-floor",
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
    {
      id: "open",
      label: "Open",
      list: "seats",
      next: "valued",
      averageSeconds: 30,
      exitPrompt: "Who starts next time?",
    },
    {
      id: "valued",
      label: "Valued",
      list: "valued",
      next: "select",
      repeat: 2,
      averageSeconds: 100,
      valueStepOnTurnEnd: true,
    },
    {
      id: "select",
      label: "Select",
      list: "valued",
      kinds: ["x"],
      next: "open",
    },
  ],
};

export const init = () =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(3),
    turnOrder: VALUED,
  });

export const run = (state: GameSessionState, ...actions: GameSessionAction[]) =>
  actions.reduce(gameSessionReducer, state);

export const add = (
  id: string,
  value: number,
  playerIndex = 0,
): GameSessionAction => ({
  type: "ACTIVATE_TURN_ENTRY",
  entry: { id, value, playerIndex },
});
export const phase = (
  phaseId: string,
  extra: Partial<Extract<GameSessionAction, { type: "SET_PHASE" }>> = {},
): GameSessionAction => ({ type: "SET_PHASE", phaseId, at: 0, ...extra });
export const end = (
  valueStepId?: string,
  elapsedSeconds = 60,
): GameSessionAction => ({
  type: "NEXT_TURN",
  elapsedSeconds,
  at: 0,
  ...(valueStepId ? { valueStepId } : {}),
});
export const setValue = (
  entryId: string,
  value: number,
): GameSessionAction => ({
  type: "SET_ENTRY_VALUE",
  entryId,
  value,
});

export const view = (s: GameSessionState) => selectTurnOrder(s, "valued");
export const order = (s: GameSessionState) =>
  view(s)?.entries.map((e) => `${e.id}${e.value}`);
export const played = (s: GameSessionState) => view(s)?.playedIds;
export const active = (s: GameSessionState) => selectTurnOrder(s)?.activeId;

// A, B at 80 (A arrived first) and C at 70, with the valued phase running.
export const threeEntries = () =>
  run(
    init(),
    { type: "START", at: 0 },
    add("a", 80, 0),
    add("b", 80, 1),
    add("c", 70, 2),
    phase("valued"),
  );
