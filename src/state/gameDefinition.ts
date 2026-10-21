/*
 * GameDefinition / GameInstance schema, defined with Zod.
 *
 * The Zod schemas ARE the source of truth: the TS types are inferred,
 * runtime parsing validates JSON before it reaches the rest of the
 * app, and unsafe `as GameDefinition` casts are gone. Built-in JSON
 * is parsed at registry-load time; user-authored definitions are parsed
 * before save.
 *
 * CRITICAL: Nothing game-specific (eg. "if game === 'some-game'") may
 * live in the core code. All game-shaped behaviour comes through this
 * schema.
 */

import { z } from "zod";
import { EntryIdentitySchema } from "./entryIdentity";
import { GameSoundsSchema } from "./gameSounds";
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

/**
 * How a scored game is won. `firstToMax`: the first seat to reach the
 * score max wins at once. `highestAtTurnLimit`: the game ends when the
 * recorded turns reach the expected turns, and the highest score wins
 * (the earliest seat among equals). Without a victory rule the timer
 * never declares a winner.
 */
const ScoreVictoryTypeSchema = z.enum(["firstToMax", "highestAtTurnLimit"]);
export type ScoreVictoryType = z.infer<typeof ScoreVictoryTypeSchema>;

// Optional fire-once-per-player score thresholds. Each crossing fires
// a fullscreen dismiss-required dialog with the configured label, so a
// game can prompt the active player to act when their score hits a
// specific value (e.g. an event that triggers at 4, 8 and 12 points). The
// reducer tracks fired thresholds in state.firedMilestones so undo +
// re-cross don't re-fire, and so a thresholded player can't see the
// same dialog twice for the same level.
const ScoreMilestoneSchema = z.object({
  atScore: z.number(),
  label: z.string(),
  // When true, fires at most ONCE per game across all players: the
  // first player to cross the threshold gets the dialog and no one else
  // does, even if they cross the same threshold later. Useful for
  // table-wide "warning bell" rules.
  // Default (omitted / false) is per-player firing.
  fireOnce: z.boolean().optional(),
  // Optional visual marker rendered on the score track at this
  // milestone's position. `display` is a short text glyph (1-3
  // chars, e.g. "★" or "H"); `icon` is an appPath to an SVG/PNG.
  // Renderer prefers the icon when both are set.
  marker: z
    .object({
      display: z.string().optional(),
      icon: z.string().optional(),
    })
    .optional(),
});
export type ScoreMilestone = z.infer<typeof ScoreMilestoneSchema>;

const ScoreConfigSchema = z.object({
  displayStyle: ScoreDisplayStyleSchema,
  min: z.number(),
  max: z.number().optional(),
  // Per-seat-count overrides of `max` (the victory threshold), for
  // games that scale the target score with player count. Resolved by
  // exact seat match via `effectiveScoreMax`, falling back to `max`.
  // The numbers live in the definition, not in app code.
  maxBySeatCount: z
    .array(z.object({ seats: z.number(), max: z.number() }))
    .optional(),
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
// declared order. Every term in this layer is game-agnostic: the
// game's own vocabulary lives only as strings inside the step's
// `label` field.

const SetupOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    // The module this option belongs to: an opaque id pointing at an
    // option in a sibling multi-toggle step (e.g. an option with
    // `module: "base"` references the Expansions step's "base" option).
    // The wizard hides options whose module isn't in the
    // active multi-toggle set. Untagged options always show.
    //
    // Naming note: the *file* is `modules.json` (the content layer in
    // the structure-vs-content split). This *field* names a single
    // module-as-expansion within that file. Different scopes, same word.
    module: z.string().optional(),
    // Optional id of a `toggle` step that must be ON for this option to
    // be offered (in addition to any `module` gate). Lets a variant (such
    // as a second copy of an option) be switched off before the draft.
    requiresToggle: z.string().optional(),
    // For options that deal accompanying cards when picked: which
    // passthrough array on this option holds the pool, and how many to
    // deal. Read generically by the wizard, with no option ids baked in.
    characterDraw: z
      .object({
        poolField: z.string(),
        count: z.number(),
        // When true, copies of this option (see `copies`) draw distinct
        // characters: no two copies share one. `exclusiveGroup` is filled
        // in at resolution with the base option id that copies share.
        exclusive: z.boolean().optional(),
        exclusiveGroup: z.string().optional(),
        // What the dealt items are called on the card, for one and for
        // several. Defaults to "character" / "characters".
        noun: z.object({ one: z.string(), other: z.string() }).optional(),
      })
      .optional(),
    // An option that comes in multiple physical copies (e.g. two pawns of
    // the same kind). At definition load each entry becomes its own
    // pickable card (copy 0 keeps the base id, later copies get a
    // suffixed id), sharing the base's pools/assets but overriding colour,
    // label, module and requiresToggle. Mutex constraints on the base id
    // are mirrored onto each copy, and so are `excludeOptionIds` targets.
    copies: z
      .array(
        z.object({
          label: z.string().optional(),
          color: z.string().optional(),
          module: z.string().optional(),
          requiresToggle: z.string().optional(),
        }),
      )
      .optional(),
    // Numbered setup instructions printed on the option's card.
    setupInstructions: z.array(z.string()).optional(),
    // Option ids (from any step) that this option rules out once a
    // deal-random step has dealt it: later pickers hide them. See
    // `optionExcludedByDeals`.
    excludeOptionIds: z.array(z.string()).optional(),
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

/**
 * The order seats take their turn on a player-pick step. `seat` walks
 * the seating list from the first seat down; `reverse-seat` starts at the
 * last seat and walks back up. Absent means `seat`.
 */
const PickOrderSchema = z.enum(["seat", "reverse-seat"]);
export type PickOrder = z.infer<typeof PickOrderSchema>;

/**
 * Which seat the pick sequence is anchored on. `first-seat` (the default)
 * walks from seat 0; `lead` rotates the walk so it starts at the lead
 * chosen on an earlier select-lead step, so `reverse-seat` then starts
 * with the seat before the lead and ends with the lead.
 */
const PickFromSchema = z.enum(["first-seat", "lead"]);
export type PickFrom = z.infer<typeof PickFromSchema>;

/**
 * The seat a select-lead step offers before the table chooses:
 * `first-seat` (the default) or a `random` seat.
 */
const LeadDefaultSchema = z.enum(["first-seat", "random"]);

/**
 * Picking from a dealt hand: the wizard deals one option per seat plus
 * `dealExtra` from the legal pool. `startsOn: false` opens on the free
 * pick instead; `skippable: false` removes the switch between the two.
 * Absent, every legal option is offered and nothing is dealt.
 */
const PickDraftSchema = z.object({
  dealExtra: z.number().int().nonnegative(),
  // Whether the picker opens on the dealt hand (default true) and
  // whether the table may switch to a free pick (default true).
  startsOn: z.boolean().optional(),
  skippable: z.boolean().optional(),
});

// Optional demotion rule for a deal-random step: how many of the dealt
// items start in their demoted state, scaling with the seat count. The
// wizard reads it generically; the per-game numbers live in the
// definition, not in app code. `count` applies once seats >= `minSeats`;
// the highest matching threshold wins, defaulting to 0.
const DemoteRuleSchema = z
  .object({
    thresholds: z.array(z.object({ minSeats: z.number(), count: z.number() })),
  })
  .optional();

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
  // is the result. Used for the top-of-wizard "Expansions included" step:
  // downstream steps filter their options by `tag` against the active
  // set (when their `tag` is a known option id from this step's category).
  z.object({
    type: z.literal("multi-toggle"),
    options: z.array(SetupOptionSchema),
    defaultSelectedIds: z.array(z.string()).optional(),
  }),
  // Deal-random: shuffle the option pool and draw `count` ids. Optional
  // steps can be skipped entirely (a deal of all or nothing, never
  // partial). The wizard exposes a re-shuffle action.
  z.object({
    type: z.literal("deal-random"),
    options: z.array(SetupOptionSchema),
    count: z.number(),
    optional: z.boolean().optional(),
    demote: DemoteRuleSchema,
    // When set, the player chooses how many to deal (0..maxCount) rather
    // than a fixed `count` (e.g. 0, 1 or 2).
    maxCount: z.number().optional(),
  }),
  // Seat players: the roster + ordering. The wizard renders an editable,
  // reorderable list. Companions can rename / claim seats over PeerJS.
  // `colorOptions`, when present, lets each seat take one distinct
  // colour; every option must carry a `color`.
  z.object({
    type: z.literal("seat-players"),
    minPlayers: z.number().optional(),
    maxPlayers: z.number().optional(),
    defaultPlayerCount: z.number().optional(),
    colorOptions: z
      .array(SetupOptionSchema.extend({ color: z.string() }))
      .optional(),
  }),
  // Per-player option pick. host-only collects picks in the host modal;
  // turn-based broadcasts SETUP_TURN over PeerJS so each seated companion
  // picks from its own screen. Constraints reference option ids declared
  // on this same step: fully self-contained, no top-level cross-refs.
  z.object({
    type: z.literal("player-pick"),
    options: z.array(SetupOptionSchema),
    mode: z.enum(["host-only", "turn-based"]),
    constraints: z.array(SetupConstraintSchema).optional(),
    allowRandom: z.boolean().optional(),
    pickOrder: PickOrderSchema.optional(),
    pickFrom: PickFromSchema.optional(),
    draft: PickDraftSchema.optional(),
  }),
  // Per-player resolution of items dealt by an upstream deal-random
  // step: each seated player resolves one, walking the seats in `order`
  // (see PickOrderSchema; seat order by default). Powers any game with
  // a "walk the dealt deck" setup pattern.
  z.object({
    type: z.literal("dealt-resolve"),
    sourceStepId: z.string(),
    order: PickOrderSchema.optional(),
  }),
  // Choose which seat starts as the turn-order lead. Reads the
  // upstream seat-players roster and
  // records the chosen seat index. `allowRandom` offers a randomise
  // button. Only meaningful when the definition's turnOrder is
  // "lead-relative"; harmless otherwise.
  z.object({
    type: z.literal("select-lead"),
    allowRandom: z.boolean().optional(),
    defaultLead: LeadDefaultSchema.optional(),
  }),
  // Instructional screen with no input: the wizard renders the
  // step's label + description and a Next button. Useful for
  // single-shot table-side instructions that don't fit naturally
  // into the description of any input-bearing step (e.g. "Draw
  // 5 cards" between player setup and the final shuffle).
  z.object({
    type: z.literal("info"),
  }),
]);
export type SetupStepKind = z.infer<typeof SetupStepKindSchema>;

/**
 * Optional gate on whether a step appears at all, keyed either to a
 * module id selected (or not) in a multi-toggle step, or to the value of
 * an earlier toggle step. Lets a game swap whole branches of its setup
 * on one choice, e.g. a variant that replaces the core placement steps
 * with its own. The step owns its gate; nothing at the top level of the
 * definition lists which steps a choice controls.
 */
const StepVisibilitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("module-selected"), module: z.string() }),
  z.object({ type: z.literal("module-not-selected"), module: z.string() }),
  z.object({ type: z.literal("toggle-on"), step: z.string() }),
  z.object({ type: z.literal("toggle-off"), step: z.string() }),
]);
export type StepVisibility = z.infer<typeof StepVisibilitySchema>;

const SetupStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  visibleWhen: StepVisibilitySchema.optional(),
  kind: SetupStepKindSchema,
});
export type SetupStep = z.infer<typeof SetupStepSchema>;

// ── Turn order ────────────────────────────────────────────────────
// How the runtime advances the active player. Absent (or "round-robin")
// keeps the default fixed rotation (active seat = turns % seatCount).
// "lead-relative" anchors each round to a movable lead seat: a round is
// one turn per seat starting from the lead. A definition's controls (see
// ControlSchema) can let the acting seat claim the lead for the *next*
// round.
//
// "variable" keeps explicit, manually reorderable lists of turn
// entries. Each entry is either a seated player or a definition-declared
// entry (see TurnEntryDeclSchema). Turns walk the active list top to
// bottom and wrap; the table can drag entries into a new order at any
// time, and entries can be activated or deactivated mid-game. A
// definition may declare several lists (e.g. one of players and one of
// other entries) and phases that pick which list is active; without
// them there is one implicit list holding everything.

/**
 * A non-player turn entry declared by a definition: anything that takes
 * a turn without holding a seat. `kind` is an opaque grouping tag whose
 * display label comes from `entryKinds`. `inPlay: false` declares an
 * entry that is known up front but only joins the order when it is
 * added during play.
 */
const TurnEntryDeclSchema = z.object({
  // "seat-" ids are reserved for the entries generated for seated players.
  id: z
    .string()
    .min(1)
    .refine((id) => !id.startsWith("seat-"), {
      message: 'turn entry ids may not start with "seat-"',
    }),
  label: z.string(),
  kind: z.string().optional(),
  color: z.string().optional(),
  // Type style and symbol tokens; the framework decides where they show.
  identity: EntryIdentitySchema.optional(),
  inPlay: z.boolean().optional(),
  // Same gates as a setup option: the entry only exists in a game whose
  // setup selected `module` and did not switch `requiresToggle` off.
  module: z.string().optional(),
  requiresToggle: z.string().optional(),
});
export type TurnEntryDecl = z.infer<typeof TurnEntryDeclSchema>;

/**
 * One ordered list of turn entries, with its own order and position.
 * Membership is by rule: seated players join the first list with
 * `includePlayers`; a declared entry joins the first list whose `kinds`
 * contains its kind. Every declared entry must match some list.
 */
const TurnListDeclSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  includePlayers: z.boolean().optional(),
  kinds: z.array(z.string()).optional(),
  // What happens after the last entry's turn. "wrap" (default) starts
  // the list again from the top. "prompt-phase" also wraps but flags the
  // session so the table is asked which phase comes next.
  onRoundEnd: z.enum(["wrap", "prompt-phase"]).optional(),
  /**
   * "value" orders the list by each entry's numeric value (see
   * `TurnOrder.entryValues`), highest first unless `valueOrder` says
   * otherwise. An entry that arrives at a value goes below the entries
   * already there unless `valueOrder` says otherwise. The order cannot be
   * dragged (unless `valueOrder.reorderEqual` allows it among equals), each entry plays once per visit to a phase running the list,
   * and the phase ends when everyone has played.
   */
  orderBy: z.literal("value").optional(),
  /**
   * How a value-ordered list sorts. `direction` puts the highest value on
   * top ("highest-first", the default) or the lowest ("lowest-first").
   * `arrivals` places an entry that arrives at a value already held
   * below the entries there ("below-equals", the default) or above them
   * ("above-equals"). A kind with `joinsAtTop` always goes above.
   * `reorderEqual` lets the table reorder entries by hand, but only
   * among neighbours sharing a value; values still decide the rest.
   */
  valueOrder: z
    .object({
      direction: z.enum(["highest-first", "lowest-first"]).optional(),
      arrivals: z.enum(["below-equals", "above-equals"]).optional(),
      reorderEqual: z.boolean().optional(),
    })
    .optional(),
  // Every entry in this list must be linked to a seated player (its
  // owner), chosen when it is added.
  ownerRequired: z.boolean().optional(),
});
export type TurnListDecl = z.infer<typeof TurnListDeclSchema>;

/**
 * A named stretch of play that runs one list. Several phases may share
 * a list (two passes over the same order). Array order is the default
 * sequence the table is offered, wrapping at the end; `next` overrides
 * the default successor. `averageSeconds` seeds this phase's countdown
 * until it has recorded turns of its own.
 *
 * `firstEntryPrompt` is a question ("Who goes first?") asked whenever
 * the table starts this phase; the chosen entry is rotated to the top
 * of the list. `module` / `requiresToggle` gate the phase like a setup
 * option, for phases that only exist with an expansion.
 */
const TurnPhaseDeclSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  list: z.string(),
  next: z.string().optional(),
  averageSeconds: z.number().positive().optional(),
  firstEntryPrompt: z.string().optional(),
  /**
   * A question asked when the table ends this phase. The chosen entry
   * moves to the top of this phase's list, so the next visit starts
   * from it.
   */
  exitPrompt: z.string().optional(),
  // How many visits in a row are usual before `next` becomes the
  // default successor. Defaults to 1.
  repeat: z.number().int().positive().optional(),
  // Ending an entry's turn in this phase asks which of the declared
  // value steps applies (see `TurnOrder.entryValues.steps`).
  valueStepOnTurnEnd: z.boolean().optional(),
  // Only entries of these kinds take turns in this phase; the others
  // stay in the list but are skipped.
  kinds: z.array(z.string()).optional(),
  module: z.string().optional(),
  requiresToggle: z.string().optional(),
});
export type TurnPhaseDecl = z.infer<typeof TurnPhaseDeclSchema>;

/**
 * One answer to "how did this entry's value move?", asked at the end of
 * its turn in a phase with `valueStepOnTurnEnd`. "move" shifts the value
 * by `spaces` positions along the track (negative is down; 0 keeps the
 * value but still re-enters it below its equals). "remove" takes the
 * entry out of play. `hint` explains when the answer applies. A step
 * with `module` / `requiresToggle` is offered only when that setup
 * choice is on, like gated entries and phases.
 */
const ValueStepBaseFields = {
  id: z.string().min(1),
  label: z.string(),
  hint: z.string().optional(),
  module: z.string().optional(),
  requiresToggle: z.string().optional(),
};
const ValueStepSchema = z.discriminatedUnion("effect", [
  z.object({
    ...ValueStepBaseFields,
    effect: z.literal("move"),
    spaces: z.number().int(),
  }),
  z.object({
    ...ValueStepBaseFields,
    effect: z.literal("remove"),
  }),
]);
export type ValueStep = z.infer<typeof ValueStepSchema>;

/**
 * Numeric values carried by turn entries, which value-ordered lists sort
 * by. `track` is every value an entry can hold, ascending. `startValues`
 * are the values offered when an entry is added (the whole track when
 * absent). Reaching `removeAt` takes the entry out of play. `stepsLabel`
 * heads the value-step answers (the list is named after `label` without
 * it), so step labels can stay short.
 */
const EntryValuesSchema = z.object({
  label: z.string(),
  stepsLabel: z.string().optional(),
  track: z.array(z.number()).min(2),
  startValues: z.array(z.number()).optional(),
  removeAt: z.number().optional(),
  steps: z.array(ValueStepSchema).min(1),
});
export type EntryValues = z.infer<typeof EntryValuesSchema>;

/**
 * Names that can stand in for a source when combining. They are never in
 * play: one fills a source slot and lends only its name to the result.
 * The combine flow offers them collapsed under `label`, and at least one
 * real source always takes part.
 */
const CombineExtraSourcesSchema = z.object({
  label: z.string().min(1),
  entries: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        color: z.string().optional(),
        identity: EntryIdentitySchema.optional(),
      }),
    )
    .min(1),
});
export type CombineExtraSources = z.infer<typeof CombineExtraSourcesSchema>;

/**
 * Combining `count` entries of `sourceKind` into one entry of
 * `targetKind`. The sources leave play and the target joins with a label
 * built from all their names, a chosen owner and a value. `value` names
 * how the default value is derived: "mean-floor" is the mean of the
 * sources' values (stand-ins have none), rounded down to a track value.
 */
const CombineEntriesSchema = z.object({
  label: z.string(),
  sourceKind: z.string(),
  count: z.number().int().min(2),
  targetKind: z.string(),
  value: z.literal("mean-floor").optional(),
  extraSources: CombineExtraSourcesSchema.optional(),
  /**
   * The question heading each step of the combine flow. The steps and
   * their order are the framework's: choose the sources, then the
   * target, then the owner, then check the result. A missing heading
   * falls back to a generic one.
   */
  steps: z
    .object({
      sources: z.string(),
      target: z.string(),
      owner: z.string(),
      confirm: z.string(),
    })
    .partial()
    .optional(),
});
export type CombineEntries = z.infer<typeof CombineEntriesSchema>;

// The id of the implicit list (and phase) used when a variable-order
// definition declares no `lists`.
// ── Game model (finish prediction) ─────────────────────────────

/**
 * How many turns one round of a phase takes, read from live state:
 * - "entries": the entries in the phase's list that act in it, raised
 *   to `atLeastPerPlayer` times the player count while few are in play
 * - "players": the player count times `times`
 * - "fixed": a set count
 */
export const RoundTurnsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entries"),
    atLeastPerPlayer: z.number().nonnegative().optional(),
  }),
  z.object({ type: z.literal("players"), times: z.number().positive() }),
  z.object({ type: z.literal("fixed"), count: z.number().positive() }),
]);
export type RoundTurns = z.infer<typeof RoundTurnsSchema>;

/**
 * How many cycles a game lasts. "typical" is a single count. "setup-choice"
 * reads the option picked in a select-one setup step, mapping option ids
 * to cycle counts, with `typical` used when the step was not answered.
 */
export const GameLengthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("typical"), cycles: z.number().positive() }),
  z.object({
    type: z.literal("setup-choice"),
    step: z.string().min(1),
    cycles: z.record(z.string(), z.number().positive()),
    typical: z.number().positive(),
  }),
]);
export type GameLength = z.infer<typeof GameLengthSchema>;

/**
 * A rough model of a whole game, for predicting when it ends: its length
 * in cycles, and what one cycle is made of, as phases (by id) each with a
 * rough number of rounds per cycle and the turns a round takes. With a
 * `remainingLabel`, the footer counts down cycles under the game's own
 * words for them instead of estimated turns.
 */
export const GameModelSchema = z.object({
  length: GameLengthSchema,
  remainingLabel: z
    .object({ one: z.string().min(1), other: z.string().min(1) })
    .optional(),
  cycle: z
    .array(
      z.object({
        phase: z.string().min(1),
        rounds: z.number().positive(),
        turnsPerRound: RoundTurnsSchema,
      }),
    )
    .min(1),
});
export type GameModel = z.infer<typeof GameModelSchema>;

/** The model's length with any setup choice resolved to a typical count. */
export const gameModelForSetup = (
  model: GameModel,
  context: SetupContext,
): GameModel => {
  if (model.length.type !== "setup-choice") return model;
  const choice = context[model.length.step];
  const cycles =
    (choice?.kind === "select-one"
      ? model.length.cycles[choice.optionId]
      : undefined) ?? model.length.typical;
  return { ...model, length: { type: "typical", cycles } };
};

export const IMPLICIT_TURN_LIST_ID = "main";

export const TurnOrderSchema = z
  .object({
    mode: z.enum(["round-robin", "lead-relative", "variable"]),
    /**
     * Which way turns pass round the seats in round-robin and
     * lead-relative order: `seat-order` (the default) walks up the seat
     * list from the lead, `reverse-seat-order` walks down it. Variable
     * order follows its lists instead.
     */
    direction: z.enum(["seat-order", "reverse-seat-order"]).optional(),
    // When true, the setup wizard offers the table a choice between fixed
    // rotation and variable order, defaulting to `mode`.
    selectable: z.boolean().optional(),
    // Variable mode only: whether each seated player is an entry in the
    // implicit list. Defaults to true. Ignored when `lists` is declared
    // (each list says so itself).
    includePlayers: z.boolean().optional(),
    // Variable mode only: non-player entries. Those with `inPlay !== false`
    // start in their list, after any players, in declared order.
    entries: z
      .array(TurnEntryDeclSchema)
      .optional()
      .refine(
        (list) => !list || new Set(list.map((e) => e.id)).size === list.length,
        { message: "turn entry ids must be unique" },
      ),
    // Variable mode only: display labels for the `kind` tags used above.
    // An `ownerless` kind is never linked to a player, even in a list
    // that otherwise requires an owner. A `joinsAtTop` kind joins a
    // value-ordered list at the highest value already in it, above the
    // entries there, instead of at a chosen value below its equals.
    // An "untimed" `turnTiming` (default "timed") marks a shared turn
    // that the whole table plays: no countdown runs, the ring shows
    // `untimedLabel` instead of a time, and the turn records no time.
    // A `prominent` kind's entries keep their type style in list rows,
    // not only in the banner.
    entryKinds: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          prominent: z.boolean().optional(),
          ownerless: z.boolean().optional(),
          joinsAtTop: z.boolean().optional(),
          turnTiming: z.enum(["timed", "untimed"]).optional(),
          untimedLabel: z.string().min(1).optional(),
        }),
      )
      .optional(),
    // Variable mode only: the lists and phases. Absent lists = one
    // implicit list; absent phases = one phase per list, in list order.
    lists: z.array(TurnListDeclSchema).min(1).optional(),
    phases: z.array(TurnPhaseDeclSchema).min(1).optional(),
    // Variable mode only: a numeric value per entry, for lists ordered
    // by value. See EntryValuesSchema.
    entryValues: EntryValuesSchema.optional(),
    // Variable mode only: several entries can be combined into another.
    // See CombineEntriesSchema.
    combine: CombineEntriesSchema.optional(),
    // Variable mode only: a rough model of the whole game, for the
    // predicted finish. See GameModelSchema.
    model: GameModelSchema.optional(),
    // What happens when a round completes and no control claimed the
    // next lead. "prompt-lead" shows a full-screen picker asking the
    // table who leads next, for games where the lead can change by a
    // means the timer can't observe. If a claim-next-lead control fired,
    // the next lead is already known and no prompt shows.
    // `default` controls the picker's pre-selection: "none" forces an
    // explicit tap; "current-lead" pre-highlights the standing lead.
    roundEnd: z
      .object({
        type: z.literal("prompt-lead"),
        label: z.string(),
        default: z.enum(["none", "current-lead"]).optional(),
      })
      .optional(),
  })
  .superRefine((order, ctx) => {
    const listIds = order.lists?.map((l) => l.id) ?? [IMPLICIT_TURN_LIST_ID];
    if (new Set(listIds).size !== listIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["lists"],
        message: "turn list ids must be unique",
      });
    }
    const phaseIds = order.phases?.map((p) => p.id) ?? [];
    if (new Set(phaseIds).size !== phaseIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["phases"],
        message: "turn phase ids must be unique",
      });
    }
    if (order.lists) {
      const kinds = new Set(order.lists.flatMap((l) => l.kinds ?? []));
      order.entries?.forEach((entry, i) => {
        if (!entry.kind || !kinds.has(entry.kind)) {
          ctx.addIssue({
            code: "custom",
            path: ["entries", i, "kind"],
            message: `turn entry "${entry.id}" has no list for its kind`,
          });
        }
      });
    }
    const entryIds = new Set(order.entries?.map((e) => e.id));
    const extraIds = order.combine?.extraSources?.entries.map((e) => e.id);
    if (
      extraIds &&
      (new Set(extraIds).size !== extraIds.length ||
        extraIds.some((id) => entryIds.has(id)))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["combine", "extraSources", "entries"],
        message:
          "combine stand-in ids must be unique and differ from turn entry ids",
      });
    }
    order.lists?.forEach((list, i) => {
      if (list.valueOrder && list.orderBy !== "value") {
        ctx.addIssue({
          code: "custom",
          path: ["lists", i, "valueOrder"],
          message: `list "${list.id}" declares valueOrder without orderBy "value"`,
        });
      }
    });
    if (
      order.lists?.some((l) => l.orderBy === "value") &&
      order.entryValues === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["entryValues"],
        message: "a list ordered by value needs entryValues",
      });
    }
    const track = order.entryValues?.track ?? [];
    if (track.some((v, i) => i > 0 && v <= track[i - 1])) {
      ctx.addIssue({
        code: "custom",
        path: ["entryValues", "track"],
        message: "the value track must be strictly ascending",
      });
    }
    order.phases?.forEach((phase, i) => {
      if (!listIds.includes(phase.list)) {
        ctx.addIssue({
          code: "custom",
          path: ["phases", i, "list"],
          message: `unknown turn list "${phase.list}"`,
        });
      }
      if (phase.next !== undefined && !phaseIds.includes(phase.next)) {
        ctx.addIssue({
          code: "custom",
          path: ["phases", i, "next"],
          message: `unknown turn phase "${phase.next}"`,
        });
      }
    });
    order.model?.cycle.forEach((part, i) => {
      if (!phaseIds.includes(part.phase)) {
        ctx.addIssue({
          code: "custom",
          path: ["model", "cycle", i, "phase"],
          message: `unknown turn phase "${part.phase}"`,
        });
      }
    });
  });
export type TurnOrder = z.infer<typeof TurnOrderSchema>;

// ── Controls ─────────────────────────────────────────────────────

/**
 * What a control does when triggered. Each effect is a framework
 * operation; the definition only picks one and names it.
 *
 * - `claim-next-lead`: the acting seat leads the next round. Needs
 *   lead-relative turn order. When it fires, the round-end lead prompt
 *   is skipped because the next lead is already known
 */
const ControlEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("claim-next-lead") }),
]);
export type ControlEffect = z.infer<typeof ControlEffectSchema>;

/**
 * When a control is offered, in terms the framework can check.
 *
 * - `actor`: who may trigger it. "active-seat" (the default) means only
 *   the seat whose turn it is; a companion sees it only on its own turn
 * - `limit`: "once-per-round" (the default) withdraws the control for
 *   everyone after one use until the next round starts; "unlimited"
 *   keeps it available. Rounds are counted by lead-relative turn order
 */
const ControlAvailabilitySchema = z.object({
  actor: z.enum(["active-seat"]).optional(),
  limit: z.enum(["once-per-round", "unlimited"]).optional(),
});
export type ControlAvailability = z.infer<typeof ControlAvailabilitySchema>;

/**
 * A turn action a definition offers during play. The definition declares
 * its meaning (label, effect, availability); the framework decides where
 * and how it renders on each screen.
 */
export const ControlSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  effect: ControlEffectSchema,
  availability: ControlAvailabilitySchema.optional(),
});
export type Control = z.infer<typeof ControlSchema>;

const ControlListSchema = z
  .array(ControlSchema)
  .refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
    message: "control ids must be unique",
  });

/**
 * Cross-field rules for controls: effects and limits that depend on
 * lead-relative rounds are rejected under any other turn order, so a
 * definition can't declare a control that would never be offered.
 */
const refineControls = (
  def: { controls?: Control[]; turnOrder?: TurnOrder },
  ctx: z.RefinementCtx,
) => {
  const leadRelative = def.turnOrder?.mode === "lead-relative";
  def.controls?.forEach((control, i) => {
    if (control.effect.type === "claim-next-lead" && !leadRelative) {
      ctx.addIssue({
        code: "custom",
        path: ["controls", i, "effect"],
        message: `control "${control.id}": claim-next-lead needs lead-relative turn order`,
      });
    }
    if (
      (control.availability?.limit ?? "once-per-round") === "once-per-round" &&
      !leadRelative
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["controls", i, "availability", "limit"],
        message: `control "${control.id}": once-per-round needs lead-relative turn order`,
      });
    }
  });
};

/**
 * The pre-controls shape: a single `turnOrder.interrupt` that claimed the
 * next lead. Only read to migrate older definitions and saved sessions.
 */
const LegacyInterruptSchema = z.object({
  id: z.string(),
  label: z.string(),
  effect: z.literal("claim-next-lead"),
  oncePerRound: z.boolean().optional(),
});

const legacyInterruptToControl = (
  interrupt: z.infer<typeof LegacyInterruptSchema>,
): Control => ({
  id: interrupt.id,
  label: interrupt.label,
  effect: { type: "claim-next-lead" },
  availability: {
    actor: "active-seat",
    limit: interrupt.oncePerRound === false ? "unlimited" : "once-per-round",
  },
});

/** The control equivalent to a legacy interrupt, if `input` is one. */
export const parseLegacyInterrupt = (input: unknown): Control | undefined => {
  const parsed = LegacyInterruptSchema.safeParse(input);
  return parsed.success ? legacyInterruptToControl(parsed.data) : undefined;
};

/**
 * Turn a legacy `turnOrder.interrupt` into the equivalent control, so
 * definitions saved before controls existed still load. Input without a
 * valid legacy interrupt passes through untouched for the schema to judge.
 */
export const migrateLegacyInterrupt = (input: unknown): unknown => {
  const shape = z
    .object({
      turnOrder: z.object({ interrupt: LegacyInterruptSchema }).passthrough(),
      controls: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .safeParse(input);
  if (!shape.success) return input;
  const { interrupt, ...turnOrder } = shape.data.turnOrder;
  return {
    ...shape.data,
    turnOrder,
    controls: [
      ...(shape.data.controls ?? []),
      legacyInterruptToControl(interrupt),
    ],
  };
};

// ── GameDefinition ───────────────────────────────────────────────
const GameDefinitionShape = z.object({
  schemaVersion: z.literal(GAME_DEFINITION_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultExpectedTurns: z.number(),
  // When set, the wizard hides the Expected-turns screen and computes
  // expectedTurns = seatCount * turnsPerPlayer at submit time. Useful
  // for games where turn budget scales linearly with player count
  // (e.g. about 8 turns per player). The Expected-turns screen still
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
  // Metadata key the player colour is read from, when it differs from
  // `playerVisualFrom` (e.g. icons from one pick, colour from the seat).
  playerColorFrom: z.string().optional(),
  // How the runtime advances turns. Absent = round-robin. See TurnOrderSchema.
  turnOrder: TurnOrderSchema.optional(),
  // Turn actions offered during play. See ControlSchema.
  controls: ControlListSchema.optional(),
  // Optional path (relative to the deployment basePath) to a laurel
  // wreath asset wrapping the leading player's head icon in the
  // VictoryBanner. Resolved from the modules file's referenceCatalog
  // at merge time.
  vpLaurelPath: z.string().optional(),
  // Sounds this game swaps in for the core ones. See GameSoundsSchema.
  sounds: GameSoundsSchema.optional(),
  /**
   * Words that belong to this game's own vocabulary (names of its pieces,
   * unique mechanics, the game's name). They may appear only inside the game's
   * definition files; a guard test fails if any of them shows up in
   * framework code.
   */
  gameSpecificTerms: z.array(z.string()).optional(),
});

/**
 * Checks the declared controls (see refineControls), then that a
 * `visibleWhen` gate names a module some multi-toggle step offers,
 * or a toggle step that comes before it. Otherwise a typo would silently
 * hide (or always show) the step.
 */
export const GameDefinitionSchema = GameDefinitionShape.superRefine(
  (definition, ctx) => {
    refineControls(definition, ctx);
    const steps = definition.setupSteps ?? [];
    const moduleIds = new Set(
      steps.flatMap((s) =>
        s.kind.type === "multi-toggle" ? s.kind.options.map((o) => o.id) : [],
      ),
    );
    steps.forEach((step, i) => {
      const gate = step.visibleWhen;
      if (!gate) return;
      if (gate.type === "toggle-on" || gate.type === "toggle-off") {
        const earlierToggles = steps
          .slice(0, i)
          .filter((s) => s.kind.type === "toggle")
          .map((s) => s.id);
        if (!earlierToggles.includes(gate.step)) {
          ctx.addIssue({
            code: "custom",
            path: ["setupSteps", i, "visibleWhen", "step"],
            message: `Step "${step.id}" is gated on "${gate.step}", which is not an earlier toggle step; earlier toggle steps: ${earlierToggles.join(", ") || "(none)"}`,
          });
        }
        return;
      }
      if (!moduleIds.has(gate.module)) {
        ctx.addIssue({
          code: "custom",
          path: ["setupSteps", i, "visibleWhen", "module"],
          message: `Step "${step.id}" is gated on unknown module "${gate.module}"; declared modules: ${Array.from(moduleIds).join(", ") || "(none)"}`,
        });
      }
    });
  },
);
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

// ── Parsing helpers ───────────────────────────────────────────────

// Parse + validate raw JSON (or a JS object) as a GameDefinition.
// Throws a ZodError with a path-into-the-document if anything's off.
// Use this everywhere the codebase previously did `data as GameDefinition`.
export const parseGameDefinition = (input: unknown): GameDefinition =>
  GameDefinitionSchema.parse(migrateLegacyInterrupt(input));

export const safeParseGameDefinition = (input: unknown) =>
  GameDefinitionSchema.safeParse(migrateLegacyInterrupt(input));

// Resolve a game's victory threshold for a given seat count: an exact
// `maxBySeatCount` match wins, else the flat `max`. Used by the
// score/victory logic so player-count-scaled targets work without any
// game-specific branching in the runtime.
export const effectiveScoreMax = (
  score: ScoreConfig | undefined,
  seatCount: number,
): number | undefined => {
  if (!score) return undefined;
  const override = score.maxBySeatCount?.find((e) => e.seats === seatCount);
  return override?.max ?? score.max;
};

// ── Structure + content modules split ────────────────────────────
// A definition can ship as either:
//   (a) one monolithic JSON parsed by `parseGameDefinition` (Generic +
//       user-saved custom defs), or
//   (b) a structure file (steps + category + option ids) + a sibling
//       modules file (per-option content grouped by category), joined
//       by `loadGameDefinitionWithModules`.
//
// Content modules are organised by *content category*, named in the
// definition's own vocabulary. Categories are *not* step ids: multiple
// steps can pull from one category, and a
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
    demote: DemoteRuleSchema,
    maxCount: z.number().optional(),
  }),
  // Seat colours resolve from `colorOptionCategory` + `colorOptionIds`
  // into the resolved kind's `colorOptions`.
  z.object({
    type: z.literal("seat-players"),
    minPlayers: z.number().optional(),
    maxPlayers: z.number().optional(),
    defaultPlayerCount: z.number().optional(),
    colorOptionCategory: z.string().optional(),
    colorOptionIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("player-pick"),
    optionCategory: z.string(),
    optionIds: z.array(z.string()),
    mode: z.enum(["host-only", "turn-based"]),
    constraints: z.array(SetupConstraintSchema).optional(),
    allowRandom: z.boolean().optional(),
    pickOrder: PickOrderSchema.optional(),
    pickFrom: PickFromSchema.optional(),
    draft: PickDraftSchema.optional(),
  }),
  // Per-player resolution of items dealt by an upstream deal-random
  // step: each seated player takes turns setting up one of the dealt
  // items at a time, walking the seats in `order`. `sourceStepId` names
  // the deal-random step whose `dealtIds` provide the items.
  z.object({
    type: z.literal("dealt-resolve"),
    sourceStepId: z.string(),
    order: PickOrderSchema.optional(),
  }),
  // Choose the starting turn-order lead. Passes through unchanged to
  // the resolved schema. See the post-resolve SetupStepKindSchema.
  z.object({
    type: z.literal("select-lead"),
    allowRandom: z.boolean().optional(),
    defaultLead: LeadDefaultSchema.optional(),
  }),
  // Instructional screen. Passes through unchanged to the resolved
  // schema. See the post-resolve SetupStepKindSchema for full
  // semantics.
  z.object({
    type: z.literal("info"),
  }),
]);

const StructureSetupStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  visibleWhen: StepVisibilitySchema.optional(),
  kind: StructureSetupStepKindSchema,
});

export const GameDefinitionStructureSchema = z
  .object({
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
    playerColorFrom: z.string().optional(),
    turnOrder: TurnOrderSchema.optional(),
    controls: ControlListSchema.optional(),
    // Sibling content modules file. Relative path purely for human
    // readability: the loader doesn't fetch it; the importer threads
    // both JSONs in.
    contentSource: z.string().optional(),
    sounds: GameSoundsSchema.optional(),
    gameSpecificTerms: z.array(z.string()).optional(),
  })
  .superRefine(refineControls);
export type GameDefinitionStructure = z.infer<
  typeof GameDefinitionStructureSchema
>;

export const parseGameDefinitionStructure = (
  input: unknown,
): GameDefinitionStructure =>
  GameDefinitionStructureSchema.parse(migrateLegacyInterrupt(input));

const OptionContentSchema = z
  .object({
    label: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    // See SetupOptionSchema.module, same semantics.
    module: z.string().optional(),
  })
  // Passthrough so per-option asset refs and other authored fields
  // survive the merge; they ride along on the SetupOption.
  .passthrough();
export type OptionContent = z.infer<typeof OptionContentSchema>;

export const GameContentModulesSchema = z
  .object({
    schemaVersion: z.number(),
    categories: z.record(z.string(), z.record(z.string(), OptionContentSchema)),
  })
  // Passthrough so reference catalogue blocks (sources, gaps, colour
  // palette, icons, laurels, ...) coexist alongside the
  // loader-consumed `categories` map without failing validation.
  .passthrough();
export type GameContentModules = z.infer<typeof GameContentModulesSchema>;

export const parseGameContentModules = (input: unknown): GameContentModules =>
  GameContentModulesSchema.parse(input);

const COPY_ID = /__\d+$/;
const copyOptionId = (baseId: string, copyIndex: number): string =>
  copyIndex === 0 ? baseId : `${baseId}__${copyIndex + 1}`;

/** The id an option was copied from (see `copies`), or its own id. */
export const baseOptionId = (id: string): string => id.replace(COPY_ID, "");

// Expand any option carrying `copies` into one concrete option per copy
// (copy 0 keeps the base id; later copies get `${id}__${n}`), and mirror
// the step's mutex constraints from each base id onto its copies. Runs at
// resolution so the wizard, metadata and companion all see plain options.
type ResolvedOption = Record<string, unknown> & { id: string };
const expandOptionCopies = (
  options: ResolvedOption[],
  constraints: SetupConstraint[] | undefined,
): {
  options: ResolvedOption[];
  constraints: SetupConstraint[] | undefined;
} => {
  const out: ResolvedOption[] = [];
  const extra: SetupConstraint[] = [];
  for (const opt of options) {
    const copies = (
      opt as {
        copies?: Array<{
          label?: string;
          color?: string;
          module?: string;
          requiresToggle?: string;
        }>;
      }
    ).copies;
    if (!Array.isArray(copies) || copies.length === 0) {
      out.push(opt);
      continue;
    }
    const { copies: _drop, ...base } = opt;
    const baseLabel = base.label as string;
    const cd = (base as { characterDraw?: { exclusive?: boolean } })
      .characterDraw;
    copies.forEach((copy, i) => {
      const id = copyOptionId(opt.id, i);
      const merged: ResolvedOption = {
        ...base,
        id,
        label: copy.label ?? (i === 0 ? baseLabel : `${baseLabel} ${i + 1}`),
        ...(copy.color ? { color: copy.color } : {}),
        ...(copy.module ? { module: copy.module } : {}),
        ...(copy.requiresToggle ? { requiresToggle: copy.requiresToggle } : {}),
      };
      if (cd?.exclusive) {
        merged.characterDraw = { ...cd, exclusiveGroup: opt.id };
      }
      out.push(merged);
      if (i > 0 && constraints) {
        for (const c of constraints) {
          if (c.optionIds.includes(opt.id)) {
            extra.push({
              ...c,
              optionIds: c.optionIds.map((x) => (x === opt.id ? id : x)) as [
                string,
                string,
              ],
            });
          }
        }
      }
    });
  }
  const merged = constraints ? [...constraints, ...extra] : extra;
  return { options: out, constraints: merged.length ? merged : undefined };
};

// Resolve a structure + modules pair into a fully-realised, validated
// GameDefinition. Throws with a path-into-the-document on a missing
// category or option id.
export const loadGameDefinitionWithModules = (
  structureInput: unknown,
  modulesInput: unknown,
): GameDefinition => {
  const structure = parseGameDefinitionStructure(structureInput);
  const modules = parseGameContentModules(modulesInput);

  const resolveOptions = (
    stepId: string,
    optionCategory: string,
    optionIds: string[],
  ) => {
    const category = modules.categories[optionCategory];
    if (!category) {
      throw new Error(
        `Step "${stepId}" references unknown content category "${optionCategory}"; declared categories: ${Object.keys(modules.categories).join(", ") || "(none)"}`,
      );
    }
    return optionIds.map((id) => {
      const content = category[id];
      if (!content) {
        throw new Error(
          `Step "${stepId}" (category "${optionCategory}") references unknown option id "${id}"`,
        );
      }
      return { id, ...content };
    });
  };

  const setupSteps = structure.setupSteps?.map((step) => {
    const kind = step.kind;
    if (kind.type === "seat-players") {
      const { colorOptionCategory, colorOptionIds, ...seatRest } = kind;
      if (!colorOptionCategory) return { ...step, kind: seatRest };
      return {
        ...step,
        kind: {
          ...seatRest,
          colorOptions: resolveOptions(
            step.id,
            colorOptionCategory,
            colorOptionIds ?? [],
          ),
        },
      };
    }
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
    const options = resolveOptions(step.id, optionCategory, optionIds);
    const { optionIds: _drop, optionCategory: _drop2, ...kindRest } = kind;
    if (kind.type === "player-pick") {
      const expanded = expandOptionCopies(
        options,
        (kindRest as { constraints?: SetupConstraint[] }).constraints,
      );
      return {
        ...step,
        kind: {
          ...kindRest,
          options: expanded.options,
          ...(expanded.constraints
            ? { constraints: expanded.constraints }
            : {}),
        },
      };
    }
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
  // demoted (flipped-card) state, driven by the step's `demote` rule and
  // the seat count.
  | { kind: "deal-random"; skipped: true }
  | {
      kind: "deal-random";
      skipped: false;
      dealtIds: string[];
      demotedIds?: string[];
    }
  // Per-seat name + order. Index in the array is the seat (turn order).
  // Later turn-based steps (player-pick) read this to drive the picker.
  // `id` is a stable per-seat identifier: the host uses it to track a
  // seat across reorders so a companion's claim follows the seat
  // when the host shuffles seating.
  // `colorId` is the seat's pick from the step's `colorOptions`, when
  // the step offers colours.
  | {
      kind: "seat-players";
      seats: Array<{ id: string; name: string; colorId?: string }>;
    }
  // Resolution marker per dealt item. `confirmedIds` lists the
  // dealt items the player has confirmed setting up, in the order
  // they were resolved. Empty until the first player taps Confirm.
  | { kind: "dealt-resolve"; confirmedIds: string[] }
  // Per-player option ids, keyed by player index. The host modal
  // collects this from the option-picker rows; the page projects it
  // onto player.metadata at apply time so renderers can read it
  // generically.
  //
  // `dealtIds` is populated when the upstream draft toggle is on:
  // n+1 option ids drawn from the legal pool (modules visible, not
  // excluded by an already-dealt option, not picked by a prior seat).
  // When undefined, the picker offers the entire visible pool.
  //
  // `characters` carries per-option subdraws (see `characterDraw`),
  // keyed by option id.
  | {
      kind: "player-pick";
      picks: Record<number, string>;
      dealtIds?: string[];
      characters?: Record<string, string[]>;
    }
  // The seat (index into the seat-players roster) chosen to start as
  // the turn-order lead. The page seeds the runtime lead anchor from it.
  | { kind: "select-lead"; seatIndex: number };

export type SetupContext = Record<string, SetupChoice>;

// ── Wizard helpers ────────────────────────────────────────────────

// Step-level options are filtered by the active module set. If an
// option's `module` field points at an id that no earlier multi-toggle
// step has selected, the option is hidden. Options with no `module`
// field always show. If the wizard hasn't reached any multi-toggle
// step yet, everything shows.
// Whether `module` is selected in any multi-toggle step of the context.
const moduleSelected = (module: string, context: SetupContext): boolean =>
  Object.values(context).some(
    (c) => c.kind === "multi-toggle" && c.selectedIds.includes(module),
  );

// Whether the toggle step `stepId` is switched on. A toggle not yet in
// the context counts as off.
const toggleOn = (stepId: string, context: SetupContext): boolean => {
  const choice = context[stepId];
  return choice?.kind === "toggle" && choice.value;
};

// Whether a step's own `visibleWhen` gate lets it appear under the
// current choices. Ungated steps always appear.
export const stepVisibleUnderContext = (
  step: { visibleWhen?: StepVisibility },
  context: SetupContext,
): boolean => {
  const gate = step.visibleWhen;
  if (!gate) return true;
  switch (gate.type) {
    case "module-selected":
      return moduleSelected(gate.module, context);
    case "module-not-selected":
      return !moduleSelected(gate.module, context);
    case "toggle-on":
      return toggleOn(gate.step, context);
    case "toggle-off":
      return !toggleOn(gate.step, context);
  }
};

// The definition's steps that appear under the current choices, in order.
export const visibleSetupSteps = (
  definition: GameDefinition,
  context: SetupContext,
): SetupStep[] =>
  (definition.setupSteps ?? []).filter((s) =>
    stepVisibleUnderContext(s, context),
  );

export const optionVisibleUnderContext = (
  option: { module?: string; requiresToggle?: string },
  context: SetupContext,
): boolean => {
  // Variant gate: a referenced toggle step being explicitly off hides
  // the option regardless of module.
  if (option.requiresToggle) {
    const t = context[option.requiresToggle];
    if (t?.kind === "toggle" && t.value === false) return false;
  }
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

/**
 * Whether the options dealt so far rule out `optionId`: true when any
 * option a deal-random step has dealt lists it (or the option it was
 * copied from) in `excludeOptionIds`.
 */
export const optionExcludedByDeals = (
  optionId: string,
  steps: SetupStep[],
  context: SetupContext,
): boolean => {
  const targets = [optionId, baseOptionId(optionId)];
  return steps.some((step) => {
    if (step.kind.type !== "deal-random") return false;
    const choice = context[step.id];
    if (choice?.kind !== "deal-random" || choice.skipped) return false;
    return step.kind.options.some(
      (o) =>
        choice.dealtIds.includes(o.id) &&
        targets.some((t) => o.excludeOptionIds?.includes(t)),
    );
  });
};

/**
 * The turn order a game actually plays with, given its setup choices:
 * declared entries and phases whose module or toggle gate is closed are
 * dropped. A phase's `next` that pointed at a dropped phase falls back
 * to the declared sequence, and a cycle anchored on one is dropped.
 */
export const turnOrderForSetup = (
  turnOrder: TurnOrder,
  context: SetupContext,
): TurnOrder => {
  const entries = turnOrder.entries?.filter((e) =>
    optionVisibleUnderContext(e, context),
  );
  const kept = turnOrder.phases?.filter((p) =>
    optionVisibleUnderContext(p, context),
  );
  const keptIds = new Set(kept?.map((p) => p.id));
  const phases = kept?.map(({ next, ...p }) =>
    next !== undefined && keptIds.has(next) ? { ...p, next } : p,
  );
  const entryValues = turnOrder.entryValues && {
    ...turnOrder.entryValues,
    steps: turnOrder.entryValues.steps.filter((s) =>
      optionVisibleUnderContext(s, context),
    ),
  };
  const {
    entries: _e,
    phases: _p,
    entryValues: _v,
    model,
    ...rest
  } = turnOrder;
  return {
    ...rest,
    ...(entries ? { entries } : {}),
    ...(phases && phases.length > 0 ? { phases } : {}),
    ...(entryValues ? { entryValues } : {}),
    ...(model ? { model: gameModelForSetup(model, context) } : {}),
  };
};

// ── PlayerSlot / GameInstance: used by the future serialised
// session export. The reducer's runtime Player shape lives in
// gameSession.ts and intentionally carries less metadata for now.
const PlayerSlotSchema = z.object({
  name: z.string(),
  optionId: z.string().optional(),
  color: z.string(),
});
export type PlayerSlot = z.infer<typeof PlayerSlotSchema>;

// Re-import GameSessionAction without making the cycle structural;
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
