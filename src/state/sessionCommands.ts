import { z } from "zod";
import {
  type GameSessionAction,
  type GameSessionState,
  gameSessionReducer,
  selectAvailableControls,
  selectCurrentPlayerIndex,
  selectNeedsValueStep,
  selectTurnOrder,
  selectUntimedTurnLabel,
} from "./gameSession";
import {
  addSeat,
  MAX_SEAT_NAME,
  moveSeat,
  removeSeat,
  renameSeat,
  type Seat,
  type SeatColorOption,
  setSeatColor,
} from "./seating";

/**
 * The user-level actions a table can take on a game, as data. Every
 * screen builds these: the host runs them directly, a companion sends
 * them over the peer protocol and the host runs them after the same
 * checks. Nothing here knows which screen issued a command.
 */

const id = z.string().min(1);
const seat = z.number().int().nonnegative();
const seatName = z.string().trim().min(1).max(MAX_SEAT_NAME);

/**
 * A seat named by index, plus its id while the setup seating list is
 * open. The id lets a command still find its seat after another screen
 * has reordered the list.
 */
const seatRef = { playerIndex: seat, seatId: id.optional() };

/**
 * The phase a command was issued against. A command carrying one is
 * rejected once the table has moved on, so two screens answering the
 * same prompt cannot both apply.
 */
const PhaseRefSchema = z.object({
  phaseId: id,
  run: z.number().int().positive(),
});
export type PhaseRef = z.infer<typeof PhaseRefSchema>;

/** Whether `state` has anything for UNDO to take back. */
export const canUndo = (state: GameSessionState): boolean =>
  state.turns.length > 0 || (state.undoStack?.length ?? 0) > 0;

/**
 * Every command may name the flow it belongs to (one sheet or prompt),
 * so a flow's commands undo as one event whichever screen sent them.
 */
const command = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, undoGroup: z.string().min(1).max(80).optional() });

export const SessionCommandSchema = z.discriminatedUnion("type", [
  // `atTurn` is the number of recorded turns the issuer saw; a stale
  // request (the turn already ended elsewhere) is rejected.
  command({
    type: z.literal("END_TURN"),
    valueStepId: id.optional(),
    atTurn: z.number().int().nonnegative().optional(),
  }),
  command({
    type: z.literal("ACTIVATE_ENTRY"),
    entryId: id,
    playerIndex: seat.nullable().optional(),
    value: z.number().optional(),
  }),
  command({ type: z.literal("DEACTIVATE_ENTRY"), entryId: id }),
  command({
    type: z.literal("REORDER_ENTRY"),
    entryId: id,
    toIndex: z.number().int().nonnegative(),
  }),
  command({
    type: z.literal("SET_ENTRY_OWNER"),
    entryId: id,
    playerIndex: seat.nullable(),
  }),
  command({
    type: z.literal("SET_ENTRY_VALUE"),
    entryId: id,
    value: z.number(),
  }),
  // The target is named from the sources in `sourceIds` order.
  command({
    type: z.literal("COMBINE_ENTRIES"),
    sourceIds: z.array(id).min(1),
    targetId: id,
    playerIndex: seat.nullable(),
    value: z.number().optional(),
  }),
  command({
    type: z.literal("SET_PHASE"),
    phaseId: id,
    firstEntryId: id.optional(),
    exitFirstEntryId: id.optional(),
    from: PhaseRefSchema.optional(),
  }),
  command({
    type: z.literal("DISMISS_PHASE_PROMPT"),
    from: PhaseRefSchema.optional(),
  }),
  command({
    type: z.literal("INCREMENT_SCORE"),
    playerIndex: seat,
    delta: z.number(),
  }),
  command({ type: z.literal("TRIGGER_CONTROL"), controlId: id }),
  // Take back the newest undoable event, as the host's Undo does.
  // `atRevision` is the state revision the issuer saw; a stale request
  // (another screen undid or acted first) is rejected, so two taps never
  // undo twice and an undo never takes back an action its issuer had not
  // seen.
  command({
    type: z.literal("UNDO"),
    atRevision: z.number().int().nonnegative().optional(),
  }),
  // Pause or resume the clock. Naming the wanted state rather than
  // toggling keeps two screens pressing at once from cancelling out.
  command({ type: z.literal("SET_PAUSED"), paused: z.boolean() }),
  command({
    type: z.literal("SET_EXPECTED_TURNS"),
    expectedTurns: z.number().int().nonnegative(),
  }),
  command({ type: z.literal("RENAME_PLAYER"), ...seatRef, name: seatName }),
  // The commands below change the seats themselves, so they only apply
  // while setup is seating players.
  command({ type: z.literal("ADD_SEAT"), name: seatName.optional() }),
  command({ type: z.literal("REMOVE_SEAT"), ...seatRef }),
  command({
    type: z.literal("REORDER_SEATS"),
    ...seatRef,
    toIndex: z.number().int().nonnegative(),
  }),
  command({ type: z.literal("SET_SEAT_COLOR"), ...seatRef, colorId: id }),
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand["type"];

/**
 * Who may issue a command:
 * - `table`: any claimed seat, since the whole table shares the job
 * - `turn`: only the seat that owns the acting entry, or any claimed
 *   seat when no seat owns it, since an ownerless entry is the table's
 * - `seat`: a claimed seat acting on itself (its own score, a control
 *   available to it)
 *
 * The host screen is the table's own device and may issue anything. In
 * a running game that tracks no players there are no seats to claim, so
 * every connected screen speaks for the table: it may issue `table` and
 * `turn` commands without a seat.
 */
export type CommandScope = "table" | "turn" | "seat";
export type CommandPolicy = Record<SessionCommandType, CommandScope>;

export const DEFAULT_COMMAND_POLICY: CommandPolicy = {
  END_TURN: "turn",
  ACTIVATE_ENTRY: "table",
  DEACTIVATE_ENTRY: "table",
  REORDER_ENTRY: "table",
  SET_ENTRY_OWNER: "table",
  SET_ENTRY_VALUE: "table",
  COMBINE_ENTRIES: "table",
  SET_PHASE: "table",
  DISMISS_PHASE_PROMPT: "table",
  INCREMENT_SCORE: "seat",
  TRIGGER_CONTROL: "seat",
  // The host's Undo takes back anyone's action, so any seat's may too.
  UNDO: "table",
  SET_PAUSED: "table",
  SET_EXPECTED_TURNS: "table",
  // A phone owns its player's name and colour; the host edits anyone's.
  RENAME_PLAYER: "seat",
  ADD_SEAT: "table",
  REMOVE_SEAT: "table",
  REORDER_SEATS: "table",
  SET_SEAT_COLOR: "seat",
};

/** Commands that edit one player's own data, which only that seat may send. */
const PLAYER_DATA_COMMANDS = new Set<SessionCommandType>([
  "RENAME_PLAYER",
  "SET_SEAT_COLOR",
]);

type SeatCommand = Extract<
  SessionCommand,
  {
    type:
      | "RENAME_PLAYER"
      | "ADD_SEAT"
      | "REMOVE_SEAT"
      | "REORDER_SEATS"
      | "SET_SEAT_COLOR";
  }
>;

const SEAT_COMMANDS = new Set<SessionCommandType>([
  "RENAME_PLAYER",
  "ADD_SEAT",
  "REMOVE_SEAT",
  "REORDER_SEATS",
  "SET_SEAT_COLOR",
]);

export const isSeatCommand = (
  command: SessionCommand,
): command is SeatCommand => SEAT_COMMANDS.has(command.type);

/** The setup seating list, while setup is seating players. */
export interface SetupSeating {
  seats: Seat[];
  minPlayers: number;
  maxPlayers: number;
  colorOptions?: SeatColorOption[];
}

/**
 * What the host knows beyond the game state. While `seating` is set,
 * seat commands act on it instead of the running game's players, and
 * `claimedSeats` are indices into it.
 */
export interface TableContext {
  seating?: SetupSeating | null;
  // Seats a phone has claimed.
  claimedSeats?: ReadonlySet<number>;
}

/**
 * Point a seat command at the seat its id names now, so a command built
 * before another screen reordered the list still lands on the seat the
 * issuer meant. A move keeps its direction and distance from wherever
 * that seat now sits, clamped to the list. Refuses a command whose seat
 * has gone.
 */
export const resolveSeatCommand = (
  command: SessionCommand,
  table: TableContext = {},
): { ok: true; command: SessionCommand } | { ok: false; reason: string } => {
  const seats = table.seating?.seats;
  if (!("seatId" in command) || command.seatId === undefined || !seats)
    return { ok: true, command };
  const index = seats.findIndex((s) => s.id === command.seatId);
  if (index === -1)
    return { ok: false, reason: "That seat was removed on another device" };
  if (command.type === "REORDER_SEATS") {
    const to = index + command.toIndex - command.playerIndex;
    return {
      ok: true,
      command: {
        ...command,
        playerIndex: index,
        toIndex: Math.min(Math.max(to, 0), seats.length - 1),
      },
    };
  }
  return { ok: true, command: { ...command, playerIndex: index } };
};

export type CommandActor =
  | { kind: "host" }
  | { kind: "seat"; seatIndex: number }
  | { kind: "guest" };

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

// Whether a seat-scoped command acts on the given seat.
const boundToSeat = (
  state: GameSessionState,
  command: SessionCommand,
  seatIndex: number,
): boolean => {
  switch (command.type) {
    case "INCREMENT_SCORE":
      return command.playerIndex === seatIndex;
    case "TRIGGER_CONTROL":
      return selectAvailableControls(state, seatIndex).some(
        (c) => c.id === command.controlId,
      );
    case "RENAME_PLAYER":
    case "SET_SEAT_COLOR":
      return command.playerIndex === seatIndex;
    default:
      return false;
  }
};

/** Whether `actor` may issue `command` under `policy`. */
export const authorizeCommand = (
  state: GameSessionState,
  command: SessionCommand,
  actor: CommandActor,
  policy: CommandPolicy = DEFAULT_COMMAND_POLICY,
  table: TableContext = {},
): Verdict => {
  if (actor.kind === "host") return OK;
  if (actor.kind === "guest") {
    const seatless =
      state.started && !table.seating && !(state.players?.length ?? 0);
    return seatless && policy[command.type] !== "seat"
      ? OK
      : no("Claim a seat first");
  }
  // A phone may give up its own seat but not take another phone's away.
  if (
    command.type === "REMOVE_SEAT" &&
    command.playerIndex !== actor.seatIndex &&
    table.claimedSeats?.has(command.playerIndex)
  )
    return no("Another phone has claimed that seat");
  const scope = policy[command.type];
  if (scope === "table") return OK;
  if (scope === "turn") {
    const owner = selectCurrentPlayerIndex(state);
    return owner === null || owner === actor.seatIndex
      ? OK
      : no("It is not your turn");
  }
  if (boundToSeat(state, command, actor.seatIndex)) return OK;
  return PLAYER_DATA_COMMANDS.has(command.type)
    ? no("You can only edit your own player")
    : no("Not available to your seat");
};

/** The running phase as a command reference, or undefined without phases. */
export const currentPhaseRef = (
  state: GameSessionState,
): PhaseRef | undefined =>
  state.activePhaseId !== undefined
    ? { phaseId: state.activePhaseId, run: state.phaseRun ?? 1 }
    : undefined;

const samePhase = (state: GameSessionState, from: PhaseRef | undefined) => {
  if (!from) return true;
  const now = currentPhaseRef(state);
  return now?.phaseId === from.phaseId && now.run === from.run;
};

const inSomeList = (state: GameSessionState, entryId: string) =>
  (state.turnLists ?? []).some((l) => l.order.includes(entryId));

const listOf = (state: GameSessionState, entryId: string) =>
  (state.turnLists ?? []).find((l) => l.order.includes(entryId));

const findEntry = (state: GameSessionState, entryId: string) =>
  state.turnEntries?.find((e) => e.id === entryId);

const validSeat = (state: GameSessionState, index: number | null | undefined) =>
  index === null || index === undefined || index < (state.players?.length ?? 0);

const onTrack = (state: GameSessionState, value: number | undefined) =>
  value === undefined ||
  [
    ...(state.turnOrder?.entryValues?.track ?? []),
    ...(state.turnOrder?.entryValues?.startValues ?? []),
  ].includes(value);

/**
 * Whether `command` still makes sense against `state`. These checks are
 * about the moment, not the issuer: a command built against an older
 * snapshot (another screen got there first) fails with a reason the
 * issuer can show. The reducer still guards its own invariants.
 */
export const validateCommand = (
  state: GameSessionState,
  command: SessionCommand,
  table: TableContext = {},
): Verdict => {
  if (isSeatCommand(command)) return validateSeatCommand(state, command, table);
  if (state.victor !== null && command.type !== "INCREMENT_SCORE")
    return no("The game is over");
  switch (command.type) {
    case "END_TURN": {
      if (command.atTurn !== undefined && command.atTurn !== state.turns.length)
        return no("That turn already ended");
      if (
        selectNeedsValueStep(state) &&
        !state.turnOrder?.entryValues?.steps.some(
          (s) => s.id === command.valueStepId,
        )
      )
        return no("Choose how the value moves");
      return OK;
    }
    case "ACTIVATE_ENTRY": {
      if (!findEntry(state, command.entryId)) return no("Unknown entry");
      if (inSomeList(state, command.entryId))
        return no("Already added on another device");
      if (!validSeat(state, command.playerIndex)) return no("Unknown player");
      if (!onTrack(state, command.value))
        return no("Value is not on the track");
      return OK;
    }
    case "DEACTIVATE_ENTRY":
      return inSomeList(state, command.entryId)
        ? OK
        : no("Already removed on another device");
    case "REORDER_ENTRY": {
      const list = listOf(state, command.entryId);
      if (!list) return no("Already removed on another device");
      if (selectTurnOrder(state, list.id)?.valueOrdered)
        return no("This list orders itself");
      return OK;
    }
    case "SET_ENTRY_OWNER": {
      if (!findEntry(state, command.entryId)) return no("Unknown entry");
      return validSeat(state, command.playerIndex) ? OK : no("Unknown player");
    }
    case "SET_ENTRY_VALUE": {
      if (!inSomeList(state, command.entryId))
        return no("Already removed on another device");
      return onTrack(state, command.value)
        ? OK
        : no("Value is not on the track");
    }
    case "COMBINE_ENTRIES": {
      const combine = state.turnOrder?.combine;
      if (!combine) return no("Nothing can be combined");
      const standIns = new Set(combine.extraSources?.entries.map((e) => e.id));
      const realIds = command.sourceIds.filter((s) => !standIns.has(s));
      const list = realIds.length ? listOf(state, realIds[0]) : undefined;
      if (
        !list ||
        realIds.some((s) => !list.order.includes(s)) ||
        new Set(command.sourceIds).size !== combine.count ||
        command.sourceIds.length !== combine.count
      )
        return no("Those entries changed on another device");
      if (
        !findEntry(state, command.targetId) ||
        inSomeList(state, command.targetId)
      )
        return no("Already added on another device");
      if (!validSeat(state, command.playerIndex)) return no("Unknown player");
      if (!onTrack(state, command.value))
        return no("Value is not on the track");
      return OK;
    }
    case "SET_PHASE": {
      if (!state.turnOrder || state.activePhaseId === undefined)
        return no("No phases in this game");
      if (!samePhase(state, command.from))
        return no("The phase already changed on another device");
      return OK;
    }
    case "DISMISS_PHASE_PROMPT": {
      if (!state.pendingPhasePrompt)
        return no("Already answered on another device");
      if (!samePhase(state, command.from))
        return no("The phase already changed on another device");
      return OK;
    }
    case "INCREMENT_SCORE":
      return validSeat(state, command.playerIndex) ? OK : no("Unknown player");
    case "TRIGGER_CONTROL":
      return (state.controls ?? []).some((c) => c.id === command.controlId)
        ? OK
        : no("Unknown control");
    case "UNDO":
      if (
        command.atRevision !== undefined &&
        command.atRevision !== (state.revision ?? 0)
      )
        return no("That changed on another device");
      return canUndo(state) ? OK : no("Nothing to undo");
    case "SET_PAUSED":
      if (!state.started) return no("The clock has not started");
      return selectUntimedTurnLabel(state) === null
        ? OK
        : no("This turn is untimed");
    case "SET_EXPECTED_TURNS":
      return command.expectedTurns >= state.turns.length
        ? OK
        : no("Fewer than the turns already played");
  }
};

/**
 * Seat commands act on the setup seating while it is open and otherwise
 * on the running game, where only a rename makes sense: renumbering
 * seats mid-game would reassign recorded turns and scores. A finished
 * game can still be renamed.
 */
const validateSeatCommand = (
  state: GameSessionState,
  command: SeatCommand,
  table: TableContext,
): Verdict => {
  const seating = table.seating;
  const count = seating ? seating.seats.length : (state.players?.length ?? 0);
  const exists = (index: number) => index >= 0 && index < count;
  if (command.type === "RENAME_PLAYER")
    return exists(command.playerIndex) ? OK : no("Unknown player");
  if (!seating) return no("Seats can only change during setup");
  switch (command.type) {
    case "ADD_SEAT":
      return count < seating.maxPlayers
        ? OK
        : no(`At most ${seating.maxPlayers} players`);
    case "REMOVE_SEAT":
      if (!exists(command.playerIndex)) return no("Unknown player");
      return count > seating.minPlayers
        ? OK
        : no(`At least ${seating.minPlayers} players`);
    case "REORDER_SEATS":
      return exists(command.playerIndex) && exists(command.toIndex)
        ? OK
        : no("Unknown player");
    case "SET_SEAT_COLOR":
      if (!exists(command.playerIndex)) return no("Unknown player");
      return seating.colorOptions?.some((o) => o.id === command.colorId)
        ? OK
        : no("Unknown colour");
  }
};

/** Authorise then validate: the single gate every command passes. */
export const checkCommand = (
  state: GameSessionState,
  command: SessionCommand,
  actor: CommandActor,
  policy: CommandPolicy = DEFAULT_COMMAND_POLICY,
  table: TableContext = {},
): Verdict => {
  const allowed = authorizeCommand(state, command, actor, policy, table);
  return allowed.ok ? validateCommand(state, command, table) : allowed;
};

/**
 * The setup seating a seat command leaves behind. `newSeatId` names the
 * seat ADD_SEAT creates; the host picks it so no screen can choose one.
 */
export const applySeatCommand = (
  seats: Seat[],
  command: SeatCommand,
  colorOptions: SeatColorOption[] | undefined,
  newSeatId: string,
): Seat[] => {
  switch (command.type) {
    case "RENAME_PLAYER":
      return renameSeat(seats, command.playerIndex, command.name);
    case "ADD_SEAT":
      return addSeat(
        seats,
        { id: newSeatId, name: command.name },
        colorOptions,
      );
    case "REMOVE_SEAT":
      return removeSeat(seats, command.playerIndex);
    case "REORDER_SEATS":
      return moveSeat(seats, command.playerIndex, command.toIndex);
    case "SET_SEAT_COLOR":
      return setSeatColor(seats, command.playerIndex, command.colorId);
  }
};

/**
 * The reducer action a command amounts to, with zero elapsed time. The
 * host's own wrappers also drive the clock, so this is not how commands
 * are run; it lets the host project the state a command leaves behind.
 */
export const commandToAction = (
  state: GameSessionState,
  command: SessionCommand,
  at: number,
): GameSessionAction | undefined => {
  switch (command.type) {
    case "END_TURN":
      return state.started
        ? {
            type: "NEXT_TURN",
            elapsedSeconds: 0,
            at,
            ...(command.valueStepId !== undefined
              ? { valueStepId: command.valueStepId }
              : {}),
          }
        : { type: "START", at };
    case "ACTIVATE_ENTRY":
      return {
        type: "ACTIVATE_TURN_ENTRY",
        entry: {
          id: command.entryId,
          ...(command.playerIndex !== undefined
            ? { playerIndex: command.playerIndex }
            : {}),
          ...(command.value !== undefined ? { value: command.value } : {}),
        },
      };
    case "DEACTIVATE_ENTRY":
      return { type: "DEACTIVATE_TURN_ENTRY", entryId: command.entryId };
    case "REORDER_ENTRY":
      return {
        type: "REORDER_TURN_ENTRY",
        entryId: command.entryId,
        toIndex: command.toIndex,
      };
    case "SET_ENTRY_OWNER":
      return {
        type: "SET_TURN_ENTRY_PLAYER",
        entryId: command.entryId,
        playerIndex: command.playerIndex,
      };
    case "SET_ENTRY_VALUE":
      return {
        type: "SET_ENTRY_VALUE",
        entryId: command.entryId,
        value: command.value,
      };
    case "COMBINE_ENTRIES": {
      const { type: _, ...combine } = command;
      return { type: "COMBINE_TURN_ENTRIES", ...combine, at };
    }
    case "SET_PHASE":
      return {
        type: "SET_PHASE",
        phaseId: command.phaseId,
        at,
        ...(command.firstEntryId !== undefined
          ? { firstEntryId: command.firstEntryId }
          : {}),
        ...(command.exitFirstEntryId !== undefined
          ? { exitFirstEntryId: command.exitFirstEntryId }
          : {}),
      };
    case "DISMISS_PHASE_PROMPT":
      return { type: "DISMISS_PHASE_PROMPT" };
    case "INCREMENT_SCORE":
      return {
        type: "INCREMENT_SCORE",
        playerIndex: command.playerIndex,
        delta: command.delta,
      };
    case "TRIGGER_CONTROL":
      return { type: "TRIGGER_CONTROL", controlId: command.controlId };
    case "UNDO":
      return { type: "UNDO" };
    case "SET_EXPECTED_TURNS":
      return {
        type: "SET_EXPECTED_TURNS",
        expectedTurns: command.expectedTurns,
      };
    // The clock lives outside the game state.
    case "SET_PAUSED":
      return undefined;
    case "RENAME_PLAYER": {
      const player = state.players?.[command.playerIndex];
      return player
        ? {
            type: "SET_PLAYER",
            playerIndex: command.playerIndex,
            player: { ...player, name: command.name },
          }
        : undefined;
    }
    // The rest only touch the setup seating; see applySeatCommand.
    case "ADD_SEAT":
    case "REMOVE_SEAT":
    case "REORDER_SEATS":
    case "SET_SEAT_COLOR":
      return undefined;
  }
};

/**
 * The game state `command` leaves behind, for checking the next one. A
 * seat command during setup leaves the game alone.
 */
export const projectCommand = (
  state: GameSessionState,
  command: SessionCommand,
  at: number,
  table: TableContext = {},
): GameSessionState => {
  if (isSeatCommand(command) && table.seating) return state;
  const action = commandToAction(state, command, at);
  return action ? gameSessionReducer(state, action) : state;
};
