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

const ScoreVictoryTypeSchema = z.enum(["firstToMax", "highestAtTurnLimit"]);
export type ScoreVictoryType = z.infer<typeof ScoreVictoryTypeSchema>;

// Optional fire-once-per-player score thresholds. Each crossing fires
// a fullscreen dismiss-required dialog with the configured label, so a
// game can prompt the active player to act when their score hits a
// specific value (e.g. Root's hireling triggers at 4, 8, 12 VP). The
// reducer tracks fired thresholds in state.firedMilestones so undo +
// re-cross don't re-fire, and so a thresholded player can't see the
// same dialog twice for the same level.
const ScoreMilestoneSchema = z.object({
  atScore: z.number(),
  label: z.string(),
});
export type ScoreMilestone = z.infer<typeof ScoreMilestoneSchema>;

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
  milestones: z.array(ScoreMilestoneSchema).optional(),
});
export type ScoreConfig = z.infer<typeof ScoreConfigSchema>;

// ── Setup steps ───────────────────────────────────────────────────
// A generic, ordered set of decisions a game wants the player to make
// before it begins. The wizard renders one screen per step in the
// declared order. Every term in this layer is game-agnostic — the
// game's own vocabulary (Map, Deck, Faction, ...) lives only as
// strings inside the step's `label` field.

const SetupOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    // The module this option belongs to — an opaque id pointing at an
    // option in a sibling multi-toggle step (e.g. faction "marquise"
    // has `module: "base"` referencing the Expansions step's "base"
    // option). The wizard hides options whose module isn't in the
    // active multi-toggle set. Untagged options always show.
    //
    // Naming note: the *file* is `modules.json` (the content layer in
    // the structure-vs-content split). This *field* names a single
    // module-as-expansion within that file. Different scopes, same word.
    module: z.string().optional(),
  })
  // Passthrough so extra fields supplied by a content modules file
  // (e.g. asset references, custom per-option data the renderers want
  // to read) survive the merge. The required fields are still validated.
  .passthrough();
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
  // Multi-toggle: a checkbox list. The active set of selected option ids
  // is the result. Used for the top-of-wizard "Expansions included" step
  // — downstream steps filter their options by `tag` against the active
  // set (when their `tag` is a known option id from this step's category).
  z.object({
    type: z.literal("multi-toggle"),
    options: z.array(SetupOptionSchema),
    defaultSelectedIds: z.array(z.string()).optional(),
  }),
  // Deal-random: shuffle the option pool and draw `count` ids. Optional
  // steps can be skipped entirely (e.g. ADSET A.6 Hirelings — use 0 or 3,
  // never partial). The wizard exposes a re-shuffle action.
  z.object({
    type: z.literal("deal-random"),
    options: z.array(SetupOptionSchema),
    count: z.number(),
    optional: z.boolean().optional(),
  }),
  // Seat players: the roster + ordering. The wizard renders an editable,
  // reorderable list. Companions can rename / claim seats over PeerJS.
  z.object({
    type: z.literal("seat-players"),
    minPlayers: z.number().optional(),
    maxPlayers: z.number().optional(),
    defaultPlayerCount: z.number().optional(),
  }),
  // Per-player option pick. host-only collects picks in the host modal;
  // turn-based broadcasts SETUP_TURN over PeerJS so each seated companion
  // picks from its own screen. Constraints reference option ids declared
  // on this same step — fully self-contained, no top-level cross-refs.
  z.object({
    type: z.literal("player-pick"),
    options: z.array(SetupOptionSchema),
    mode: z.enum(["host-only", "turn-based"]),
    constraints: z.array(SetupConstraintSchema).optional(),
    allowRandom: z.boolean().optional(),
  }),
  // Per-player resolution of items dealt by an upstream deal-random
  // step — each seated player resolves one in alphabetical order.
  // Root uses this for hirelings; same kind powers any game with a
  // "walk the dealt deck" setup pattern.
  z.object({
    type: z.literal("dealt-resolve"),
    sourceStepId: z.string(),
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
  // When set, the wizard hides the Expected-turns screen and computes
  // expectedTurns = seatCount * turnsPerPlayer at submit time. Useful
  // for games where turn budget scales linearly with player count
  // (e.g. Root ≈ 8 turns/player). The Expected-turns screen still
  // appears for definitions without this set.
  turnsPerPlayer: z.number().optional(),
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
  // Optional path (relative to the deployment basePath) to a laurel
  // wreath asset wrapping the leading player's head icon in the
  // VictoryBanner. Resolved from the modules file's referenceCatalog
  // at merge time.
  vpLaurelPath: z.string().optional(),
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

// ── Structure + content modules split ────────────────────────────
// A definition can ship as either:
//   (a) one monolithic JSON parsed by `parseGameDefinition` (Generic +
//       user-saved custom defs), or
//   (b) a structure file (steps + category + option ids) + a sibling
//       modules file (per-option content grouped by category), joined
//       by `loadGameDefinitionWithModules`.
//
// Content modules are organised by *content category* (faction, map,
// deck, ...), declared by the definition's vocabulary. Categories are
// *not* step ids — multiple steps can pull from one category, and a
// step can be renamed without touching modules. Each step in the
// structure file declares which `optionCategory` it draws from plus
// the ordered `optionIds` it actually uses.

const StructureSetupStepKindSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select-one"),
    optionCategory: z.string(),
    optionIds: z.array(z.string()),
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
  z.object({
    type: z.literal("multi-toggle"),
    optionCategory: z.string(),
    optionIds: z.array(z.string()),
    defaultSelectedIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("deal-random"),
    optionCategory: z.string(),
    optionIds: z.array(z.string()),
    count: z.number(),
    optional: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("seat-players"),
    minPlayers: z.number().optional(),
    maxPlayers: z.number().optional(),
    defaultPlayerCount: z.number().optional(),
  }),
  z.object({
    type: z.literal("player-pick"),
    optionCategory: z.string(),
    optionIds: z.array(z.string()),
    mode: z.enum(["host-only", "turn-based"]),
    constraints: z.array(SetupConstraintSchema).optional(),
    allowRandom: z.boolean().optional(),
  }),
  // Per-player resolution of items dealt by an upstream deal-random
  // step — each seated player takes turns setting up one of the
  // dealt items at a time in alphabetical order (Root uses this
  // for hirelings, per its ADSET A.7.3). `sourceStepId` names the
  // deal-random step whose `dealtIds` provide the items.
  z.object({
    type: z.literal("dealt-resolve"),
    sourceStepId: z.string(),
  }),
]);

const StructureSetupStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  kind: StructureSetupStepKindSchema,
});

export const GameDefinitionStructureSchema = z.object({
  schemaVersion: z.literal(GAME_DEFINITION_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultExpectedTurns: z.number(),
  turnsPerPlayer: z.number().optional(),
  defaultAverageSeconds: z.number(),
  score: ScoreConfigSchema.optional(),
  maxPlayers: z.number().optional(),
  setupSteps: z.array(StructureSetupStepSchema).optional(),
  playerVisualFrom: z.string().optional(),
  playerSubheadingFrom: z.string().optional(),
  // Sibling content modules file. Relative path purely for human
  // readability — the loader doesn't fetch it; the importer threads
  // both JSONs in.
  contentSource: z.string().optional(),
});
export type GameDefinitionStructure = z.infer<
  typeof GameDefinitionStructureSchema
>;

export const parseGameDefinitionStructure = (
  input: unknown,
): GameDefinitionStructure => GameDefinitionStructureSchema.parse(input);

const OptionContentSchema = z
  .object({
    label: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    // See SetupOptionSchema.module — same semantics.
    module: z.string().optional(),
  })
  // Passthrough so per-option asset refs and other authored fields
  // survive the merge — they ride along on the SetupOption.
  .passthrough();
export type OptionContent = z.infer<typeof OptionContentSchema>;

export const GameContentModulesSchema = z
  .object({
    schemaVersion: z.number(),
    categories: z.record(z.string(), z.record(z.string(), OptionContentSchema)),
  })
  // Passthrough so reference catalogue blocks (sources, gaps, colour
  // palette, hireling icons, vp laurels, ...) coexist alongside the
  // loader-consumed `categories` map without failing validation.
  .passthrough();
export type GameContentModules = z.infer<typeof GameContentModulesSchema>;

export const parseGameContentModules = (input: unknown): GameContentModules =>
  GameContentModulesSchema.parse(input);

// Resolve a structure + modules pair into a fully-realised, validated
// GameDefinition. Throws with a path-into-the-document on a missing
// category or option id.
export const loadGameDefinitionWithModules = (
  structureInput: unknown,
  modulesInput: unknown,
): GameDefinition => {
  const structure = parseGameDefinitionStructure(structureInput);
  const modules = parseGameContentModules(modulesInput);

  const setupSteps = structure.setupSteps?.map((step) => {
    const kind = step.kind;
    // Step kinds that carry an `optionCategory` get their option ids
    // resolved against the modules. The rest pass straight through.
    if (
      kind.type !== "select-one" &&
      kind.type !== "player-pick" &&
      kind.type !== "multi-toggle" &&
      kind.type !== "deal-random"
    ) {
      return step;
    }
    const { optionCategory, optionIds } = kind;
    const category = modules.categories[optionCategory];
    if (!category) {
      throw new Error(
        `Step "${step.id}" references unknown content category "${optionCategory}" — declared categories: ${Object.keys(modules.categories).join(", ") || "(none)"}`,
      );
    }
    const options = optionIds.map((id) => {
      const content = category[id];
      if (!content) {
        throw new Error(
          `Step "${step.id}" (category "${optionCategory}") references unknown option id "${id}"`,
        );
      }
      return { id, ...content };
    });
    const { optionIds: _drop, optionCategory: _drop2, ...kindRest } = kind;
    return { ...step, kind: { ...kindRest, options } };
  });

  const { contentSource: _src, ...rest } = structure;
  // Lift the laurel asset path out of the reference catalog if the
  // modules file declared one. The catalog block sits alongside
  // `categories` via the passthrough() escape hatch.
  const refCatalog = (
    modules as unknown as {
      referenceCatalog?: {
        vpLaurel?: { candidates?: Array<{ appPath?: string }> };
      };
    }
  ).referenceCatalog;
  const vpLaurelPath = refCatalog?.vpLaurel?.candidates?.[0]?.appPath;
  return parseGameDefinition({
    ...rest,
    setupSteps,
    ...(vpLaurelPath ? { vpLaurelPath } : {}),
  });
};

// ── Setup wizard outputs ──────────────────────────────────────────
// What the wizard collects per step. Stored in a record keyed by step
// id so future steps can read earlier choices generically.
export type SetupChoice =
  | { kind: "select-one"; optionId: string }
  | { kind: "select-count"; count: number }
  | { kind: "toggle"; value: boolean }
  | { kind: "multi-toggle"; selectedIds: string[] }
  // Optional steps record `skipped: true`; otherwise `dealtIds` holds
  // the randomly-drawn option ids (length === step.kind.count) and
  // `demotedIds` is a subset of those that should render in their
  // demoted (flipped-card) state. Demotion is driven by the seat count
  // for the hireling deal (ADSET A.6.2).
  | { kind: "deal-random"; skipped: true }
  | {
      kind: "deal-random";
      skipped: false;
      dealtIds: string[];
      demotedIds?: string[];
    }
  // Per-seat name + order. Index in the array is the seat (turn order).
  // Later turn-based steps (player-pick) read this to drive the picker.
  // `id` is a stable per-seat identifier — host uses it to track a
  // seat across reorders so a companion's claim follows the seat
  // when the host shuffles seating.
  | { kind: "seat-players"; seats: Array<{ id: string; name: string }> }
  // Resolved-hireling marker per item. `confirmedIds` lists the
  // dealt items the player has confirmed setting up, in the order
  // they were resolved. Empty until the first player taps Confirm.
  | { kind: "dealt-resolve"; confirmedIds: string[] }
  // Per-player option ids, keyed by player index. The host modal
  // collects this from the faction-picker rows; the page projects it
  // onto player.metadata at apply time so renderers can read it
  // generically.
  //
  // `dealtIds` is populated when the upstream draft toggle is on:
  // n+1 option ids drawn from the legal pool (modules visible, not
  // matched by an already-dealt hireling, not picked by a prior seat).
  // When undefined, the picker offers the entire visible pool.
  //
  // `characters` carries per-option subdraws — Vagabond gets 1
  // character, Knaves get 4 captains. Keyed by option id.
  | {
      kind: "player-pick";
      picks: Record<number, string>;
      dealtIds?: string[];
      characters?: Record<string, string[]>;
    };

export type SetupContext = Record<string, SetupChoice>;

// ── Wizard helpers ────────────────────────────────────────────────

// Step-level options are filtered by the active module set. If an
// option's `module` field points at an id that no earlier multi-toggle
// step has selected, the option is hidden. Options with no `module`
// field always show. If the wizard hasn't reached any multi-toggle
// step yet, everything shows.
export const optionVisibleUnderContext = (
  option: { module?: string },
  context: SetupContext,
): boolean => {
  if (!option.module) return true;
  for (const choice of Object.values(context)) {
    if (choice.kind === "multi-toggle") {
      if (choice.selectedIds.includes(option.module)) return true;
    }
  }
  const hasMultiToggle = Object.values(context).some(
    (c) => c.kind === "multi-toggle",
  );
  return !hasMultiToggle;
};

// ── PlayerSlot / GameInstance — used by the future serialised
// session export. The reducer's runtime Player shape lives in
// gameSession.ts and intentionally carries less metadata for now.
const PlayerSlotSchema = z.object({
  name: z.string(),
  optionId: z.string().optional(),
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
