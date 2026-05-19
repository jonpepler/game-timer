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

// ── Setup steps ───────────────────────────────────────────────────
// A generic, ordered set of decisions a game wants the player to make
// before it begins. The wizard renders one screen per step in the
// declared order. Every term in this layer is game-agnostic — the
// game's own vocabulary (Map, Deck, Faction, ...) lives only as
// strings inside the step's `label` field.

const SetupOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  tag: z.string().optional(),
});
export type SetupOption = z.infer<typeof SetupOptionSchema>;

const SetupConstraintSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mutually-exclusive"),
    optionIds: z.tuple([z.string(), z.string()]),
  }),
]);
export type SetupConstraint = z.infer<typeof SetupConstraintSchema>;

const SetupStepKindSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select-one"),
    options: z.array(SetupOptionSchema),
    defaultOptionId: z.string().optional(),
    allowRandom: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("select-count"),
    min: z.number(),
    max: z.number(),
    defaultValue: z.number().optional(),
    allowRandom: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("toggle"),
    defaultValue: z.boolean().optional(),
  }),
  // Per-player option pick. host-only is the only mode implemented in
  // this commit; "turn-based" lights up in a follow-up that broadcasts
  // SETUP_TURN over PeerJS so each connected device picks in order.
  // Constraints reference option ids declared on this same step —
  // making them self-contained, no top-level cross-references needed.
  z.object({
    type: z.literal("player-pick"),
    options: z.array(SetupOptionSchema),
    mode: z.enum(["host-only", "turn-based"]),
    constraints: z.array(SetupConstraintSchema).optional(),
    allowRandom: z.boolean().optional(),
  }),
]);
export type SetupStepKind = z.infer<typeof SetupStepKindSchema>;

const SetupStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  kind: SetupStepKindSchema,
});
export type SetupStep = z.infer<typeof SetupStepSchema>;

// ── GameDefinition ───────────────────────────────────────────────
export const GameDefinitionSchema = z.object({
  schemaVersion: z.literal(GAME_DEFINITION_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultExpectedTurns: z.number(),
  defaultAverageSeconds: z.number(),
  score: ScoreConfigSchema.optional(),
  maxPlayers: z.number().optional(),
  // Ordered wizard steps the game wants the user to walk through
  // before play. Each step renders in its own wizard screen.
  setupSteps: z.array(SetupStepSchema).optional(),
  // Metadata key the renderers should source per-player visuals from.
  playerVisualFrom: z.string().optional(),
  // Metadata key whose label renders as a small subheading beneath
  // each player's name. Suppressed when it'd duplicate the name.
  playerSubheadingFrom: z.string().optional(),
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

// ── Setup wizard outputs ──────────────────────────────────────────
// What the wizard collects per step. Stored in a record keyed by step
// id so future steps can read earlier choices generically.
export type SetupChoice =
  | { kind: "select-one"; optionId: string }
  | { kind: "select-count"; count: number }
  | { kind: "toggle"; value: boolean }
  // Per-player option ids, keyed by player index. The host modal
  // collects this from the faction-picker rows; the page projects it
  // onto player.metadata at apply time so renderers can read it
  // generically.
  | { kind: "player-pick"; picks: Record<number, string> };

export type SetupContext = Record<string, SetupChoice>;

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
