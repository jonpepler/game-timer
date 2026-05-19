/*
 * GameDefinition / GameInstance schema, defined with Zod.
 *
 * The Zod schemas ARE the source of truth: the TS types are inferred,
 * runtime parsing validates JSON before it reaches the rest of the
 * app, and unsafe `as GameDefinition` casts are gone. Built-in JSON
 * (Generic, Root) is parsed at registry-load time; user-authored
 * definitions are parsed before save.
 *
 * CRITICAL: Nothing game-specific (eg. "if game === 'root'") may live
 * in the core code. All game-shaped behaviour comes through this
 * schema.
 */

import { z } from "zod";
import type { GameSessionAction } from "./gameSession";

export const GAME_DEFINITION_SCHEMA_VERSION = 1;
export const GAME_INSTANCE_SCHEMA_VERSION = 1;

// ── Faction (legacy name; will move into a generic SetupOption when
// the SetupStep wizard lands in a follow-up commit). Keeping the
// existing shape so this commit is purely a Zod-adoption pass.
const FactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  description: z.string().optional(),
});
export type Faction = z.infer<typeof FactionSchema>;

// ── Score subsystem ───────────────────────────────────────────────
const ScoreDisplayStyleSchema = z.enum([
  "linearTrack",
  "leaderboard",
  "hidden",
]);
export type ScoreDisplayStyle = z.infer<typeof ScoreDisplayStyleSchema>;

const ScoreVictoryTypeSchema = z.enum([
  "firstToMax",
  "highestAtTurnLimit",
]);
export type ScoreVictoryType = z.infer<typeof ScoreVictoryTypeSchema>;

const ScoreConfigSchema = z.object({
  displayStyle: ScoreDisplayStyleSchema,
  min: z.number(),
  max: z.number().optional(),
  increment: z.number(),
  victory: z
    .object({
      type: ScoreVictoryTypeSchema,
    })
    .optional(),
});
export type ScoreConfig = z.infer<typeof ScoreConfigSchema>;

// ── Setup schema (current shape; will be replaced by setupSteps in
// the wizard commit) ──────────────────────────────────────────────
const MapOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  expansion: z.string().optional(),
});
export type MapOption = z.infer<typeof MapOptionSchema>;

const DeckOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  expansion: z.string().optional(),
});
export type DeckOption = z.infer<typeof DeckOptionSchema>;

const SetupSchemaSchema = z.object({
  maps: z.array(MapOptionSchema).optional(),
  decks: z.array(DeckOptionSchema).optional(),
  landmarks: z.object({ maxAllowed: z.number() }).optional(),
  hirelings: z.object({ maxAllowed: z.number() }).optional(),
  factionConstraints: z
    .object({
      mutuallyExclusive: z.array(z.tuple([z.string(), z.string()])).optional(),
    })
    .optional(),
  allowDraft: z.boolean().optional(),
});
export type SetupSchema = z.infer<typeof SetupSchemaSchema>;

// ── GameDefinition ───────────────────────────────────────────────
export const GameDefinitionSchema = z.object({
  schemaVersion: z.literal(GAME_DEFINITION_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultExpectedTurns: z.number(),
  defaultAverageSeconds: z.number(),
  factions: z.array(FactionSchema).optional(),
  score: ScoreConfigSchema.optional(),
  maxPlayers: z.number().optional(),
  setupSchema: SetupSchemaSchema.optional(),
});
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

// ── Parsing helpers ───────────────────────────────────────────────

// Parse + validate raw JSON (or a JS object) as a GameDefinition.
// Throws a ZodError with a path-into-the-document if anything's off.
// Use this everywhere the codebase previously did `data as GameDefinition`.
export const parseGameDefinition = (input: unknown): GameDefinition =>
  GameDefinitionSchema.parse(input);

export const safeParseGameDefinition = (input: unknown) =>
  GameDefinitionSchema.safeParse(input);

// ── Companion-screen choices that travel through GameConfig ───────
export interface AdvancedSetupChoices {
  mapId?: string;
  deckId?: string;
  landmarkCount?: number;
  hirelingCount?: number;
  draft?: boolean;
}

// ── PlayerSlot / GameInstance — used by the future serialised
// session export. The reducer's runtime Player shape lives in
// gameSession.ts and intentionally carries less metadata for now.
const PlayerSlotSchema = z.object({
  name: z.string(),
  factionId: z.string().optional(),
  color: z.string(),
});
export type PlayerSlot = z.infer<typeof PlayerSlotSchema>;

// Re-import GameSessionAction without making the cycle structural —
// it's used only for typing GameInstance.actions, never parsed.
export interface GameInstance {
  schemaVersion: typeof GAME_INSTANCE_SCHEMA_VERSION;
  definitionId: string;
  definitionSnapshot?: GameDefinition;
  startedAt: number;
  players: PlayerSlot[];
  expectedTurns: number;
  actions: GameSessionAction[];
}
