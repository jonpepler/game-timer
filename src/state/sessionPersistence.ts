import type { GameSessionState } from "./gameSession";
import { clearKey, loadJson, saveJson } from "@/lib/storage";

const SESSION_KEY = "session";
// Bumped from 1 → 2 when Player.{color,factionId} were replaced by
// Player.metadata. Old persisted sessions are silently discarded
// (the loader drops anything that doesn't match the current shape).
const SESSION_SCHEMA_VERSION = 2;

interface PersistedSession {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  state: GameSessionState;
}

export const loadSession = (): GameSessionState | undefined => {
  const persisted = loadJson<PersistedSession>(SESSION_KEY);
  if (!persisted) return undefined;
  // Drop on schema mismatch — until we add migrations, an older shape is
  // safer to discard than to half-restore.
  if (persisted.schemaVersion !== SESSION_SCHEMA_VERSION) return undefined;
  // The imperative timer state (countdown, stopwatch) isn't persisted —
  // those live inside react-timer-hook and reset on remount. Force the
  // session back to "not running" so the next tap re-starts the
  // countdown cleanly instead of treating it as a turn-end.
  //
  // Backfill milestone state for sessions saved before that feature
  // shipped (schema version intentionally not bumped so mid-game
  // restores still work — defaults match what createInitialGameSessionState
  // would produce). Reads as `?? {}` / `?? []` so any genuinely empty
  // value also gets a defined empty default.
  return {
    ...persisted.state,
    started: false,
    currentTurnStartedAt: null,
    firedMilestones: persisted.state.firedMilestones ?? {},
    pendingMilestones: persisted.state.pendingMilestones ?? [],
  };
};

export const saveSession = (state: GameSessionState): void => {
  const persisted: PersistedSession = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    state,
  };
  saveJson(SESSION_KEY, persisted);
};

export const clearSession = (): void => clearKey(SESSION_KEY);
