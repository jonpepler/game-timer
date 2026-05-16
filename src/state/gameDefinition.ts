/*
 * GameDefinition / GameInstance schema.
 *
 * A GameDefinition describes the rules of a particular tabletop game: its
 * default pacing, the factions a player can claim, an optional score
 * subsystem, etc. Definitions are reusable across many plays.
 *
 * A GameInstance is a specific play of a definition: which factions are in
 * play, who claimed which slot, and the append-only action log produced by
 * the game-session reducer.
 *
 * Both shapes are JSON-serialisable with a schemaVersion field from day
 * one — they will be persisted to localStorage, shared as files, and sent
 * over PeerJS, and the schema is going to evolve.
 *
 * CRITICAL: Nothing game-specific (eg. "if game === 'root'") may live in
 * the core code. All game-shaped behaviour comes through this schema.
 */

import type { GameSessionAction } from "./gameSession";

export const GAME_DEFINITION_SCHEMA_VERSION = 1;
export const GAME_INSTANCE_SCHEMA_VERSION = 1;

export interface Faction {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export type ScoreDisplayStyle = "linearTrack" | "leaderboard" | "hidden";
export type ScoreVictoryType = "firstToMax" | "highestAtTurnLimit";

export interface ScoreConfig {
  displayStyle: ScoreDisplayStyle;
  min: number;
  max?: number;
  increment: number;
  victory?: { type: ScoreVictoryType };
}

export interface GameDefinition {
  schemaVersion: typeof GAME_DEFINITION_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  defaultExpectedTurns: number;
  defaultAverageSeconds: number;
  factions?: Faction[];
  score?: ScoreConfig;
}

export interface PlayerSlot {
  name: string;
  factionId?: string;
  color: string;
}

export interface GameInstance {
  schemaVersion: typeof GAME_INSTANCE_SCHEMA_VERSION;
  definitionId: string;
  // Embed the definition that was active when the instance was created.
  // Lets a game replay correctly even if the definition is later edited
  // or removed from the library.
  definitionSnapshot?: GameDefinition;
  startedAt: number;
  players: PlayerSlot[];
  expectedTurns: number;
  // Append-only log of reducer actions. The current session state can be
  // reconstructed by replaying this log against the reducer.
  actions: GameSessionAction[];
}
