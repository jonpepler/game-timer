import type { GameModel, RoundTurns, TurnOrder } from "./gameDefinition";
import {
  averageOf,
  type GameSessionState,
  phaseAverage,
  variableSlice,
} from "./gameSession";
import {
  actsInPhase,
  findEntry,
  findPhase,
  isValueOrdered,
  listForPhase,
  type VariableOrderState,
} from "./turnLists";

export interface Prediction {
  // Turns still to play, the running one included.
  turns: number;
  // Seconds those turns are expected to take; never negative.
  seconds: number;
  // True when the turn count comes from the game's model rather than the
  // table's expected-turns budget, so it cannot be edited.
  modelled: boolean;
  /**
   * The game's own countdown, when its model names one: the cycles left to
   * the nearest half, and the model's label for that many.
   */
  remaining?: { count: number; label: string };
}

/** Halves are as fine as a rough model can honestly claim. */
const toHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * How long the rest of the game should take.
 *
 * Without a model it is the turns left on the table's budget times one
 * plain average across every recorded turn.
 *
 * With a model (`turnOrder.model`), the phases started so far (the phase
 * log) say how far through the game the table is. Every round the model
 * still expects is charged its turns per round at that phase's running
 * average (the phase's declared default until it has turns of its own),
 * plus whatever is left of the round being played. A game that has run
 * past its model is still charged the current round's remaining turns.
 */
export const selectPrediction = (state: GameSessionState): Prediction => {
  const model = state.turnOrder?.model;
  const slice = variableSlice(state);
  if (model && state.turnOrder && slice)
    return modelPrediction(state, state.turnOrder, model, slice);
  const turns = state.expectedTurns - state.turns.length;
  const average = averageOf(state.turns, state.initialAverageSeconds);
  return {
    turns,
    seconds: Math.max(0, turns) * average,
    modelled: false,
  };
};

const modelPrediction = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  model: GameModel,
  slice: VariableOrderState,
): Prediction => {
  const cycles =
    model.length.type === "typical"
      ? model.length.cycles
      : model.length.typical;
  const log = slice.phaseLog ?? [];
  const running = log[log.length - 1];
  const completed = new Map<string, number>();
  for (const start of log.slice(0, -1))
    completed.set(start.phaseId, (completed.get(start.phaseId) ?? 0) + 1);

  const roundsPerCycle = new Map<string, number>();
  const roundTurns = new Map<string, RoundTurns>();
  for (const part of model.cycle) {
    if (!findPhase(turnOrder, part.phase)) continue;
    roundsPerCycle.set(
      part.phase,
      (roundsPerCycle.get(part.phase) ?? 0) + part.rounds,
    );
    if (!roundTurns.has(part.phase))
      roundTurns.set(part.phase, part.turnsPerRound);
  }

  let turns = 0;
  let seconds = 0;
  for (const [phaseId, perCycle] of Array.from(roundsPerCycle)) {
    const started =
      (completed.get(phaseId) ?? 0) + (slice.activePhaseId === phaseId ? 1 : 0);
    const rounds = Math.max(0, cycles * perCycle - started);
    if (rounds === 0) continue;
    const perRound = turnsInRound(
      state,
      turnOrder,
      slice,
      phaseId,
      roundTurns.get(phaseId),
    );
    turns += rounds * perRound;
    seconds += rounds * perRound * phaseAverage(state, state.turns, phaseId);
  }

  const current = turnsLeftInRound(
    state,
    turnOrder,
    slice,
    roundTurns.get(slice.activePhaseId),
    state.turns.length - (running?.atTurn ?? 0),
  );
  turns += current;
  seconds += current * phaseAverage(state, state.turns, slice.activePhaseId);

  let remaining: Prediction["remaining"];
  if (model.remainingLabel) {
    /*
     * Rounds played so far, each capped at what the model expects of its
     * phase, with the running round counted by the share of it played.
     */
    let roundsPerCycleTotal = 0;
    let roundsDone = 0;
    for (const [phaseId, perCycle] of Array.from(roundsPerCycle)) {
      roundsPerCycleTotal += perCycle;
      roundsDone += Math.min(cycles * perCycle, completed.get(phaseId) ?? 0);
    }
    if (roundsPerCycle.has(slice.activePhaseId)) {
      const taken = state.turns.length - (running?.atTurn ?? 0);
      if (taken + current > 0) roundsDone += taken / (taken + current);
    }
    const count = toHalf(
      Math.max(0, cycles - roundsDone / roundsPerCycleTotal),
    );
    remaining = {
      count,
      label:
        count === 1 ? model.remainingLabel.one : model.remainingLabel.other,
    };
  }

  return {
    turns: Math.round(turns),
    seconds: Math.max(0, Math.round(seconds)),
    modelled: true,
    ...(remaining && { remaining }),
  };
};

// Entries in the phase's list that take turns in it.
const actingEntries = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  phaseId: string,
): string[] => {
  const phase = findPhase(turnOrder, phaseId);
  const list = listForPhase(turnOrder, slice, phaseId);
  return (list?.order ?? []).filter((id) =>
    actsInPhase(phase, findEntry(slice, id)),
  );
};

const turnsInRound = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  phaseId: string,
  rule: RoundTurns | undefined,
): number => {
  const players = state.players?.length ?? 0;
  const entries = actingEntries(turnOrder, slice, phaseId).length;
  if (!rule) return entries;
  switch (rule.type) {
    case "entries":
      return Math.max(entries, players * (rule.atLeastPerPlayer ?? 0));
    case "players":
      return players * rule.times;
    case "fixed":
      return rule.count;
  }
};

/**
 * Turns left in the round being played. A list where each entry plays
 * once per round knows exactly who has still to play. Otherwise it is the
 * round's expected length less the turns already taken in it, but never
 * fewer than the rest of the current pass through the list.
 */
const turnsLeftInRound = (
  state: GameSessionState,
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  rule: RoundTurns | undefined,
  takenThisRound: number,
): number => {
  if (state.pendingPhasePrompt) return 0;
  const list = listForPhase(turnOrder, slice);
  if (!list) return 0;
  const acting = actingEntries(turnOrder, slice, slice.activePhaseId);
  if (isValueOrdered(turnOrder, list.id)) {
    const played = new Set(list.played ?? []);
    return acting.filter((id) => !played.has(id)).length;
  }
  const at = list.activeEntryId ? acting.indexOf(list.activeEntryId) : -1;
  const restOfPass = at < 0 ? 0 : acting.length - at;
  const expected =
    turnsInRound(state, turnOrder, slice, slice.activePhaseId, rule) -
    takenThisRound;
  return Math.max(restOfPass, expected);
};
