import { z } from "zod";
import type { GameSessionState, TurnRecord } from "./gameSession";
import {
  seedVariableOrder,
  UndoSnapshotSchema,
  ValuePointSchema,
  VariableOrderStateSchema,
} from "./turnLists";
import { parseLegacyInterrupt, TurnOrderSchema } from "./gameDefinition";
import { clearKey, loadJson, saveJson } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("persistence");

const SESSION_KEY = "session";
// Bumped from 1 to 2 when per-player colour and pick fields were
// replaced by Player.metadata. Old persisted sessions are silently discarded
// (the loader drops anything that doesn't match the current shape).
const SESSION_SCHEMA_VERSION = 2;

interface PersistedSession {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  state: GameSessionState;
}

const TurnSnapshotSchema = z.object({
  phaseId: z.string(),
  entryId: z.string().optional(),
  orderBefore: z.array(z.string()).optional(),
});

/**
 * Validate the variable-order fields, which (unlike the rest of the
 * persisted state) were added after sessions were already being saved.
 * A corrupt slice is reseeded from the turn order and players rather
 * than half-loaded; a corrupt per-turn snapshot is dropped, which only
 * costs undo precision for that turn.
 */
const restoreVariableOrder = (state: GameSessionState): GameSessionState => {
  if (state.turnOrder?.mode !== "variable") return state;
  const turns: TurnRecord[] = state.turns.map((t) => {
    if (
      t.phaseId === undefined &&
      t.entryId === undefined &&
      t.orderBefore === undefined
    )
      return t;
    if (TurnSnapshotSchema.safeParse(t).success) return t;
    const { phaseId: _p, entryId: _e, orderBefore: _o, ...rest } = t;
    return rest;
  });
  // History and undo snapshots are dropped rather than trusted when they
  // do not parse; losing them costs the chart and undo depth, not play.
  const valueHistory = z.array(ValuePointSchema).safeParse(state.valueHistory);
  const undoStack = z.array(UndoSnapshotSchema).safeParse(state.undoStack);
  const extras = {
    valueHistory: valueHistory.success ? valueHistory.data : [],
    undoStack: undoStack.success ? undoStack.data : [],
  };
  const slice = VariableOrderStateSchema.safeParse(state);
  if (slice.success) return { ...state, ...slice.data, ...extras, turns };
  log.warn("dropping invalid variable turn order; reseeding", {
    issues: slice.error.issues.length,
  });
  return {
    ...state,
    turns,
    ...seedVariableOrder(state.turnOrder, state.players?.length ?? 0),
    pendingPhasePrompt: false,
    valueHistory: [],
    undoStack: [],
  };
};

const LegacyTurnOrderSchema = z.object({
  turnOrder: z.object({ interrupt: z.unknown() }).passthrough(),
});

/**
 * Sessions saved before controls existed carry their one control as
 * `turnOrder.interrupt`. Rewrite it into `controls` so a game in
 * progress keeps its turn action. A lead claimed under the old shape in
 * the current round is not carried over: that round ends with the lead
 * prompt instead, which lets the table name the claimant.
 */
const restoreLegacyControls = (state: GameSessionState): GameSessionState => {
  const legacy = LegacyTurnOrderSchema.safeParse(state);
  if (!legacy.success) return state;
  const control = parseLegacyInterrupt(legacy.data.turnOrder.interrupt);
  // Re-parsing drops the unknown `interrupt` key.
  const turnOrder = TurnOrderSchema.safeParse(state.turnOrder);
  log.info("migrated legacy turn order interrupt to a control");
  return {
    ...state,
    turnOrder: turnOrder.success ? turnOrder.data : state.turnOrder,
    controls: control ? [control] : state.controls,
    claimedNextLead: null,
    controlsUsedThisRound: [],
  };
};

export const loadSession = (): GameSessionState | undefined => {
  const persisted = loadJson<PersistedSession>(SESSION_KEY);
  if (!persisted) return undefined;
  // Drop on schema mismatch: until we add migrations, an older shape is
  // safer to discard than to half-restore.
  if (persisted.schemaVersion !== SESSION_SCHEMA_VERSION) return undefined;
  // The imperative timer state (countdown, stopwatch) isn't persisted:
  // those live inside react-timer-hook and reset on remount. Force the
  // session back to "not running" so the next tap re-starts the
  // countdown cleanly instead of treating it as a turn-end.
  //
  // Backfill milestone state for sessions saved before that feature
  // shipped (schema version intentionally not bumped so mid-game
  // restores still work: defaults match what createInitialGameSessionState
  // would produce). Reads as `?? {}` / `?? []` so any genuinely empty
  // value also gets a defined empty default.
  return restoreVariableOrder(
    restoreLegacyControls({
      ...persisted.state,
      started: false,
      currentTurnStartedAt: null,
      firedMilestones: persisted.state.firedMilestones ?? {},
      pendingMilestones: persisted.state.pendingMilestones ?? [],
    }),
  );
};

export const saveSession = (state: GameSessionState): void => {
  const persisted: PersistedSession = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    state,
  };
  saveJson(SESSION_KEY, persisted);
};

export const clearSession = (): void => clearKey(SESSION_KEY);
