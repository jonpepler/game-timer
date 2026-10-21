/*
 * Variable turn order: pure helpers over the session's turn entries,
 * lists and phases. The reducer in gameSession.ts delegates here so the
 * list rules live in one place.
 *
 * Vocabulary: an *entry* is anything that takes a turn (a seated player
 * or a definition-declared entry). A *list* is an ordered set of entries
 * with its own position. A *phase* names which list is running. Nothing
 * here knows what any entry represents in a particular game.
 */
import { z } from "zod";
import { EntryIdentitySchema, NamePartsSchema } from "./entryIdentity";
import {
  IMPLICIT_TURN_LIST_ID,
  type TurnListDecl,
  type TurnOrder,
  type TurnPhaseDecl,
} from "./gameDefinition";

/**
 * One turn-taking entry. A seated player's entry has `playerIndex` set
 * and no `label` (the name comes from the player). Other entries carry
 * their own `label` and may still link to a player, so their turns are
 * attributed to that player in per-player stats.
 */
export const TurnEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  kind: z.string().optional(),
  color: z.string().optional(),
  identity: EntryIdentitySchema.optional(),
  // Set when the entry was combined from others; `label` is then the
  // flat form of these parts.
  nameParts: NamePartsSchema.optional(),
  playerIndex: z.number().int().nonnegative().nullable(),
  // The entry's numeric value, for lists ordered by value.
  value: z.number().optional(),
});
export type TurnEntry = z.infer<typeof TurnEntrySchema>;

export const TurnListStateSchema = z.object({
  id: z.string(),
  // Entry ids currently in the list, top to bottom.
  order: z.array(z.string()),
  // Whose turn it is when this list is running.
  activeEntryId: z.string().nullable(),
  // Value-ordered lists only: entries that have taken their turn in the
  // current visit to the running phase.
  played: z.array(z.string()).optional(),
});
export type TurnListState = z.infer<typeof TurnListStateSchema>;

export const PhaseStartSchema = z.object({
  phaseId: z.string(),
  atTurn: z.number().int().nonnegative(),
});
export type PhaseStart = z.infer<typeof PhaseStartSchema>;

/**
 * The variable-order slice of the session. `turnEntries` holds every
 * entry ever known, active or not, so a deactivated entry can come back
 * and historical turns keep their label. `phaseRun` counts this cycle's
 * visits to the running phase, and `phaseVisits` every phase's.
 * `phaseLog` lists every phase started this game, oldest first, with the
 * number of turns recorded when it started; the last is the running one.
 */
export const VariableOrderStateSchema = z.object({
  turnEntries: z.array(TurnEntrySchema),
  turnLists: z.array(TurnListStateSchema),
  activePhaseId: z.string(),
  phaseRun: z.number().int().positive().optional(),
  phaseVisits: z.record(z.string(), z.number().int().positive()).optional(),
  phaseLog: z.array(PhaseStartSchema).optional(),
});
export type VariableOrderState = z.infer<typeof VariableOrderStateSchema>;

/**
 * One recorded entry value, with the number of turns recorded when it
 * was set, so a chart can plot every entry's value over the game.
 */
export const ValuePointSchema = z.object({
  entryId: z.string(),
  value: z.number(),
  turn: z.number().int().nonnegative(),
});
export type ValuePoint = z.infer<typeof ValuePointSchema>;

/**
 * The session as it stood before an undoable action: the whole
 * variable-order slice, plus how many turns and value points had been
 * recorded (both only ever grow, so a length is enough to cut back to).
 * `undoGroup` is the group the action belonged to, so later actions of
 * the same group add no snapshot of their own.
 */
export const UndoSnapshotSchema = VariableOrderStateSchema.extend({
  undoGroup: z.string().optional(),
  pendingPhasePrompt: z.boolean(),
  turnCount: z.number().int().nonnegative(),
  historyLength: z.number().int().nonnegative(),
  currentTurnStartedAt: z.number().nullable(),
});
export type UndoSnapshot = z.infer<typeof UndoSnapshotSchema>;

// Input accepted when activating an entry: an id the session already
// knows needs nothing else; a new id registers an ad hoc entry.
export type TurnEntryInput = {
  id: string;
  label?: string;
  kind?: string;
  color?: string;
  playerIndex?: number | null;
  value?: number;
};

export const seatEntryId = (seatIndex: number): string => `seat-${seatIndex}`;
const isSeatEntry = (entry: TurnEntry) => entry.id.startsWith("seat-");

export const resolveLists = (turnOrder: TurnOrder): TurnListDecl[] =>
  turnOrder.lists ?? [
    {
      id: IMPLICIT_TURN_LIST_ID,
      label: "Turn order",
      includePlayers: turnOrder.includePlayers ?? true,
    },
  ];

export const resolvePhases = (turnOrder: TurnOrder): TurnPhaseDecl[] =>
  turnOrder.phases ??
  resolveLists(turnOrder).map((l) => ({
    id: l.id,
    label: l.label,
    list: l.id,
  }));

// Which list an entry belongs to: seats join the first list with
// `includePlayers`, declared entries the first list naming their kind.
export const listIdForEntry = (
  turnOrder: TurnOrder,
  entry: TurnEntry,
): string | undefined => {
  const lists = resolveLists(turnOrder);
  if (isSeatEntry(entry)) return lists.find((l) => l.includePlayers)?.id;
  // The implicit list takes every declared entry; declared lists only
  // take the kinds they name.
  if (!turnOrder.lists) return lists[0].id;
  return lists.find((l) => entry.kind && l.kinds?.includes(entry.kind))?.id;
};

/**
 * Seed the slice from the definition's turn order and the seated
 * players. Entries with `inPlay: false` are registered but start
 * inactive. The list holding the players is rotated so `leadIndex`'s
 * seat is on top, keeping the cyclic order. Each list starts at its top
 * entry; the first phase runs.
 */
export const seedVariableOrder = (
  turnOrder: TurnOrder,
  playerCount: number,
  leadIndex = 0,
): VariableOrderState => {
  const seatEntries: TurnEntry[] = Array.from(
    { length: playerCount },
    (_, i) => ({
      id: seatEntryId(i),
      playerIndex: i,
    }),
  );
  const declared: TurnEntry[] = (turnOrder.entries ?? []).map((e) => ({
    id: e.id,
    label: e.label,
    ...(e.kind !== undefined ? { kind: e.kind } : {}),
    ...(e.color !== undefined ? { color: e.color } : {}),
    ...(e.identity !== undefined ? { identity: e.identity } : {}),
    playerIndex: null,
  }));
  const inactive = new Set(
    (turnOrder.entries ?? [])
      .filter((e) => e.inPlay === false)
      .map((e) => e.id),
  );
  const turnEntries = [...seatEntries, ...declared];
  const turnLists = resolveLists(turnOrder).map((list) => {
    const order = turnEntries
      .filter(
        (e) => !inactive.has(e.id) && listIdForEntry(turnOrder, e) === list.id,
      )
      .map((e) => e.id);
    const at = order.indexOf(seatEntryId(leadIndex));
    if (at > 0) order.push(...order.splice(0, at));
    return { id: list.id, order, activeEntryId: order[0] ?? null };
  });
  const activePhaseId = resolvePhases(turnOrder)[0].id;
  return {
    turnEntries,
    turnLists,
    activePhaseId,
    phaseLog: [{ phaseId: activePhaseId, atTurn: 0 }],
  };
};

export const findPhase = (turnOrder: TurnOrder, phaseId: string) =>
  resolvePhases(turnOrder).find((p) => p.id === phaseId);

// The list the given phase runs (the active phase by default).
export const listForPhase = (
  turnOrder: TurnOrder,
  slice: VariableOrderState,
  phaseId: string = slice.activePhaseId,
): TurnListState | undefined => {
  const phase = findPhase(turnOrder, phaseId);
  return phase ? slice.turnLists.find((l) => l.id === phase.list) : undefined;
};

export const listContaining = (slice: VariableOrderState, entryId: string) =>
  slice.turnLists.find((l) => l.order.includes(entryId));

export const findEntry = (
  slice: VariableOrderState,
  id: string | null | undefined,
): TurnEntry | undefined =>
  id == null ? undefined : slice.turnEntries.find((e) => e.id === id);

// The id after `id` in `order`, wrapping to the top. Null for an empty
// order; the top entry when `id` is not in the order.
export const entryAfter = (
  order: string[],
  id: string | null | undefined,
): string | null => {
  if (order.length === 0) return null;
  const at = id == null ? -1 : order.indexOf(id);
  return order[(at + 1) % order.length];
};

export const replaceList = (
  slice: VariableOrderState,
  next: TurnListState,
): VariableOrderState => ({
  ...slice,
  turnLists: slice.turnLists.map((l) => (l.id === next.id ? next : l)),
});

/**
 * Visits to each phase in the current cycle after moving from `from` to
 * `to`. A cycle starts when play returns to the first declared phase from
 * another phase, so a phase visited, left for an inserted phase, then
 * visited again still counts both visits.
 */
export const phaseVisitsAfter = (
  turnOrder: TurnOrder,
  visits: Record<string, number>,
  from: string,
  to: string,
): Record<string, number> => {
  const restart = resolvePhases(turnOrder)[0]?.id === to && from !== to;
  const next = restart ? {} : { ...visits };
  next[to] = (next[to] ?? 0) + 1;
  return next;
};

/**
 * The phase the table is offered after `phaseId`: the same phase again
 * while fewer than its `repeat` visits have run this cycle (see
 * phaseVisitsAfter), then its `next`, else the following phase in
 * declared order, wrapping.
 */
export const defaultNextPhaseId = (
  turnOrder: TurnOrder,
  phaseId: string,
  run = 1,
): string => {
  const phases = resolvePhases(turnOrder);
  const at = phases.findIndex((p) => p.id === phaseId);
  const phase = phases[at];
  if (phase && run < (phase.repeat ?? 1)) return phase.id;
  if (phase?.next) return phase.next;
  return phases[(at + 1) % phases.length].id;
};

export const listDecl = (
  turnOrder: TurnOrder,
  listId: string,
): TurnListDecl | undefined =>
  resolveLists(turnOrder).find((l) => l.id === listId);

export const isValueOrdered = (turnOrder: TurnOrder, listId: string) =>
  listDecl(turnOrder, listId)?.orderBy === "value";

// Whether `entry` takes turns in `phase` (phases may name the kinds
// that act in them).
export const actsInPhase = (
  phase: TurnPhaseDecl | undefined,
  entry: TurnEntry | undefined,
): boolean =>
  entry !== undefined &&
  (!phase?.kinds ||
    (entry.kind !== undefined && phase.kinds.includes(entry.kind)));

export type ValueOrder = {
  direction: "highest-first" | "lowest-first";
  arrivals: "below-equals" | "above-equals";
};

/** A list's declared value order, with today's defaults filled in. */
export const valueOrderOf = (
  turnOrder: TurnOrder,
  listId: string,
): ValueOrder => {
  const declared = listDecl(turnOrder, listId)?.valueOrder;
  return {
    direction: declared?.direction ?? "highest-first",
    arrivals: declared?.arrivals ?? "below-equals",
  };
};

/**
 * Where an entry arriving at `value` goes in a value-ordered list: after
 * every entry that sorts ahead of it under `valueOrder`, so by default it
 * ends up at the bottom of the entries sharing its value. `order` must
 * not contain the arriving entry. Entries without a value sort last, and
 * an arrival without one goes to the bottom.
 */
export const valueSlot = (
  order: string[],
  value: number | undefined,
  valueFor: (id: string) => number | undefined,
  valueOrder: ValueOrder = {
    direction: "highest-first",
    arrivals: "below-equals",
  },
): number => {
  if (value === undefined) return order.length;
  const sign = valueOrder.direction === "highest-first" ? 1 : -1;
  const ahead = (other: number) =>
    valueOrder.arrivals === "below-equals"
      ? sign * other >= sign * value
      : sign * other > sign * value;
  let at = 0;
  order.forEach((id, i) => {
    const other = valueFor(id);
    if (other !== undefined && ahead(other)) at = i + 1;
  });
  return at;
};

/**
 * The value `spaces` positions along the track from `value`, clamped to
 * the track's ends. A value that is not on the track starts from the
 * highest track value below it.
 */
export const stepAlongTrack = (
  track: number[],
  value: number,
  spaces: number,
): number => {
  let at = 0;
  track.forEach((v, i) => {
    if (v <= value) at = i;
  });
  return track[Math.max(0, Math.min(track.length - 1, at + spaces))];
};

// The highest track value at or below `value` (the lowest track value
// when there is none).
export const floorToTrack = (track: number[], value: number): number =>
  stepAlongTrack(track, value, 0);
