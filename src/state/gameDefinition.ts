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

export interface MapOption {
  id: string;
  name: string;
  description?: string;
  expansion?: string;
}

export interface DeckOption {
  id: string;
  name: string;
  expansion?: string;
}

export interface SetupSchema {
  // Maps the players can play on. First entry is treated as the default.
  maps?: MapOption[];
  // Card decks the game can be played with. First entry is the default.
  decks?: DeckOption[];
  // Optional landmark placements (Root: 0..2).
  landmarks?: { maxAllowed: number };
  // Optional hireling cards (Root: 0..3).
  hirelings?: { maxAllowed: number };
  // Factions that cannot coexist in the same game (Root: Vagabond vs
  // Knaves of the Deepwood). Each pair is enforced both ways.
  factionConstraints?: {
    mutuallyExclusive?: [string, string][];
  };
  // Whether to expose a faction-draft toggle. Doesn't change pick
  // mechanics, just signals "the rules support drafting".
  allowDraft?: boolean;
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
  // Cap on the player count the setup modal allows. Falls back to the
  // faction count when undefined; defaults to the generic palette size
  // when there are no factions either.
  maxPlayers?: number;
  // Optional advanced-setup rules (maps, decks, landmarks, hirelings,
  // faction mutex, draft toggle). When set, the Setup modal renders an
  // "Advanced setup" section driven by these options.
  setupSchema?: SetupSchema;
}

// Per-instance advanced-setup choices captured by the modal and passed
// through GameConfig. All fields are optional — a definition may
// declare a setupSchema but the user can leave choices unmade.
export interface AdvancedSetupChoices {
  mapId?: string;
  deckId?: string;
  landmarkCount?: number;
  hirelingCount?: number;
  draft?: boolean;
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
