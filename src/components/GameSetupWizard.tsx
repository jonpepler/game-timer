/*
 * Multi-screen game-setup wizard. Replaces the single-panel modal.
 *
 * Screens come from two sources:
 *   1) Built-in: Game-picker, Expected-turns, and a Track-players
 *      fallback for definitions without a seat-players step.
 *   2) Definition setupSteps: rendered one per screen, in declared
 *      order. The visible option set within each step is filtered
 *      against the active modules selection (multi-toggle steps).
 *
 * The wizard accumulates a SetupContext as the user advances. The
 * setupContext is the contract handed back via onSubmit; the parent
 * /timer page projects it onto the runtime player.metadata bag.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Dices,
  Play,
  RefreshCw,
  Settings,
  Users,
  X,
} from "lucide-react";
import styles from "./GameSetupWizard.module.css";
import { FullScreenToggle } from "./FullScreen";
import { NumberField } from "./NumberField";
import { SeatList } from "./SeatList";
import {
  addSeat,
  makeSeatId,
  moveSeat,
  removeSeat,
  renameSeat,
  type Seat,
  type SeatColorOption,
  setSeatColor,
} from "@/state/seating";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
} from "@/state/definitionRegistry";
import {
  optionExcludedByDeals,
  optionVisibleUnderContext,
  visibleSetupSteps,
  type GameDefinition,
  type PickOrder,
  type SetupChoice,
  type SetupConstraint,
  type SetupContext,
  type SetupOption,
  type SetupStep,
} from "@/state/gameDefinition";
import type { Player, PlayerMetadataValue } from "@/state/gameSession";
import { useGameThemePreview } from "@/hooks/useGameTheme";
import { fallbackColor } from "@/lib/playerVisual";
import {
  Button,
  Chip,
  ColourField,
  Field,
  Heading,
  ListRow,
  SectionLabel,
  SelectField,
  Stepper,
  Toggle,
  VisuallyHidden,
} from "@/components/ui";
import { DEFAULT_PLAYER_PALETTE } from "@/lib/playerVisual";

// ── Public contract ─────────────────────────────────────────────────

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
  definitionId: string;
  setupContext?: SetupContext;
  // When true, the timer page starts the clock immediately on
  // applyConfig instead of waiting for the user's first tap. Set
  // by the wizard when the last seat has just confirmed its
  // pick: the natural "start the game now" moment.
  autoStart?: boolean;
  // The table's turn-order choice, set only when the definition's turn
  // order is `selectable`.
  turnOrderMode?: SelectableTurnOrderMode;
}

export type SelectableTurnOrderMode = "round-robin" | "variable";

const defaultTurnOrderMode = (
  definition: GameDefinition,
): SelectableTurnOrderMode =>
  definition.turnOrder?.mode === "variable" ? "variable" : "round-robin";

// Imperative handle exposed to parents (the timer page) so peer
// messages can route into the wizard without lifting all of its state.
// Currently a single method: adds more if more peer-driven steps land.
export interface GameSetupWizardHandle {
  applyPick: (stepId: string, seatIndex: number, optionId: string) => void;
  // Apply a peer-driven dealt-resolve pick: the seated companion
  // chose `optionId` from the remaining dealt items on the step.
  // Validates active-seat + not-already-confirmed under the hood.
  applyResolve: (stepId: string, seatIndex: number, optionId: string) => void;
  // Look up the kind of a setup step on the wizard's CURRENTLY
  // selected definition (which may differ from the timer page's
  // `definitionId`, since that's only set on submit). Used by the
  // host to route an incoming SETUP_PICK message to applyPick vs
  // applyResolve.
  getStepKind: (stepId: string) => string | undefined;
  // Apply a seat command to the seating list. `change` runs against
  // the wizard's latest seats, so changes queued in one tick compose.
  updateSeats: (stepId: string, change: (seats: Seat[]) => Seat[]) => void;
}

// Signals the wizard emits when it's on a turn-based player-pick step.
// The parent wires these to peer messages so seated companions can
// pick on their own devices.
export interface WizardPeerHooks {
  // Called when the active seat changes on a turn-based step (and on
  // first entry to the step). The seat the host is currently awaiting.
  onTurnStart?: (info: {
    stepId: string;
    seatIndex: number;
    seatName: string;
    optionIds: string[];
    excludedOptionIds: string[];
    definition: GameDefinition;
  }) => void;
  // Called when a turn-based step finishes (all seats filled, wizard
  // advances past the step, or wizard closes).
  onTurnEnd?: (info: { stepId: string }) => void;
  // Called whenever the seating list changes (any edit, on any
  // screen) with stable seat ids so claims can follow their seats, and
  // with null while setup is not seating players (wizard closed, or a
  // game without a seating step).
  onSeatingChange?: (info: SeatingInfo | null) => void;
}

export interface SeatingInfo {
  stepId: string;
  seats: Seat[];
  minPlayers: number;
  maxPlayers: number;
  colorOptions?: SeatColorOption[];
}

interface GameSetupWizardProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
  definitions?: GameDefinition[];
  initialDefinitionId?: string;
  peerHooks?: WizardPeerHooks;
  // Optional companion-facing pane rendered alongside the wizard's
  // first screen. Used by the timer page to surface a Share dialog
  // so companions can join from the very start of setup. Animates
  // out as the wizard advances to later screens.
  sidePanel?: React.ReactNode;
  // Notifies the parent when the wizard moves between screens. The
  // timer page uses this to auto-open the peer session as soon as
  // the wizard opens to its first screen.
  onScreenChange?: (screenIndex: number) => void;
}

// ── Screen catalogue ────────────────────────────────────────────────

type WizardScreen =
  | { kind: "game"; id: "game"; label: string }
  | { kind: "expected-turns"; id: "expected-turns"; label: string }
  | { kind: "setup-step"; id: string; label: string; step: SetupStep }
  | { kind: "track-players"; id: "track-players"; label: string };

const buildScreens = (
  definition: GameDefinition,
  context: SetupContext,
): WizardScreen[] => {
  const screens: WizardScreen[] = [{ kind: "game", id: "game", label: "Game" }];
  // Definitions with turnsPerPlayer derive expectedTurns from the
  // seat count at submit time, no need to ask. Generic and similar
  // definitions without that field still get the Expected-turns
  // screen.
  if (definition.turnsPerPlayer == null) {
    screens.push({
      kind: "expected-turns",
      id: "expected-turns",
      label: "Turns",
    });
  }
  const steps = visibleSetupSteps(definition, context);
  let hasSeating = false;
  for (const step of steps) {
    screens.push({ kind: "setup-step", id: step.id, label: step.label, step });
    if (step.kind.type === "seat-players") hasSeating = true;
  }
  if (!hasSeating) {
    screens.push({
      kind: "track-players",
      id: "track-players",
      label: "Players",
    });
  }
  // Players set up immediately on pick, not retrospectively, so there
  // is no closing confirmation screen.
  return screens;
};

// ── Helpers ─────────────────────────────────────────────────────────

const mutexPairsOf = (constraints?: SetupConstraint[]): [string, string][] =>
  (constraints ?? [])
    .filter(
      (c): c is Extract<SetupConstraint, { type: "mutually-exclusive" }> =>
        c.type === "mutually-exclusive",
    )
    .map((c) => c.optionIds);

const findPlayerPickStep = (definition: GameDefinition) =>
  definition.setupSteps?.find((s) => s.kind.type === "player-pick");

const findSeatPlayersStep = (definition: GameDefinition) =>
  definition.setupSteps?.find((s) => s.kind.type === "seat-players");

const visibleOptions = (
  options: SetupOption[],
  context: SetupContext,
): SetupOption[] =>
  options.filter((o) => optionVisibleUnderContext(o, context));

const defaultContext = (definition: GameDefinition): SetupContext => {
  const ctx: SetupContext = {};
  for (const step of definition.setupSteps ?? []) {
    switch (step.kind.type) {
      case "select-one": {
        const id = step.kind.defaultOptionId ?? step.kind.options[0]?.id;
        if (id) ctx[step.id] = { kind: "select-one", optionId: id };
        break;
      }
      case "select-count":
        ctx[step.id] = {
          kind: "select-count",
          count: step.kind.defaultValue ?? step.kind.min,
        };
        break;
      case "toggle":
        ctx[step.id] = {
          kind: "toggle",
          value: step.kind.defaultValue ?? false,
        };
        break;
      case "multi-toggle": {
        const defaults =
          step.kind.defaultSelectedIds ?? step.kind.options.map((o) => o.id);
        ctx[step.id] = { kind: "multi-toggle", selectedIds: defaults };
        break;
      }
      case "deal-random":
        // Start skipped; user can opt in on the screen.
        ctx[step.id] = step.kind.optional
          ? { kind: "deal-random", skipped: true }
          : {
              kind: "deal-random",
              skipped: false,
              dealtIds: shuffleAndTake(
                step.kind.options.map((o) => o.id),
                step.kind.count,
              ),
            };
        break;
      case "seat-players": {
        const count = step.kind.defaultPlayerCount ?? step.kind.minPlayers ?? 2;
        const colors = step.kind.colorOptions ?? [];
        ctx[step.id] = {
          kind: "seat-players",
          seats: Array.from({ length: count }, (_, i) => ({
            id: makeSeatId(),
            name: `Player ${i + 1}`,
            ...(colors[i] ? { colorId: colors[i].id } : {}),
          })),
        };
        break;
      }
      case "player-pick":
        // Picks are built incrementally on the picker screen.
        ctx[step.id] = { kind: "player-pick", picks: {} };
        break;
      case "dealt-resolve":
        ctx[step.id] = { kind: "dealt-resolve", confirmedIds: [] };
        break;
      case "select-lead": {
        // The step's declared default seat; the screen lets the user
        // reassign or randomise. A random default draws from the seats
        // seated by default and is clamped if seats are removed later.
        const seated = Object.values(ctx).find(
          (c) => c.kind === "seat-players",
        );
        const seatCount =
          seated?.kind === "seat-players" ? seated.seats.length : 0;
        ctx[step.id] = {
          kind: "select-lead",
          seatIndex:
            step.kind.defaultLead === "random" ? randomIndex(seatCount) : 0,
        };
        break;
      }
    }
  }
  return ctx;
};

const randomIndex = (length: number): number =>
  length > 0 ? Math.floor(Math.random() * length) : 0;

const shuffleAndTake = <T,>(items: T[], count: number): T[] => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
};

// Deal `count` ids at random, but never deal both members of a
// mutually-exclusive pair into the same hand:
// a drafted pool you can't fully use wastes a slot.
const dealWithoutMutexClashes = (
  ids: string[],
  count: number,
  mutex: [string, string][],
): string[] => {
  const clashes = (a: string, b: string) =>
    mutex.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const out: string[] = [];
  for (const id of shuffleAndTake(ids, ids.length)) {
    if (out.length >= count) break;
    if (out.some((picked) => clashes(picked, id))) continue;
    out.push(id);
  }
  return out;
};

// Some options deal accompanying cards on pick. Which pool and how many
// is declared on the option itself (`characterDraw`), keeping option ids
// out of core code. Pools live on the option as the named passthrough
// array (`characterDraw.poolField`).
const characterDrawOf = (option: SetupOption | undefined) =>
  option?.characterDraw;

// What `count` dealt characters are called on a card, from the option's
// `characterDraw.noun`.
const characterNoun = (option: SetupOption, count: number): string => {
  const noun = characterDrawOf(option)?.noun;
  return count === 1
    ? (noun?.one ?? "character")
    : (noun?.other ?? "characters");
};

const labelForCharacter = (
  option: SetupOption,
  characterId: string,
): string => {
  const draw = characterDrawOf(option);
  if (!draw) return characterId;
  const pool = (
    option as unknown as Record<
      string,
      Array<{ id: string; label?: string }> | undefined
    >
  )[draw.poolField];
  if (!Array.isArray(pool)) return characterId;
  return pool.find((c) => c.id === characterId)?.label ?? characterId;
};

// The meeple to show for an option: if a character was dealt with it,
// that character's own meeple; otherwise the option's default meeple.
// Keeps every surface (card, preview, in-game) showing the chosen
// character rather than the option's generic pawn.
const meepleAppPathFor = (
  option: SetupOption | undefined,
  characters: Record<string, string[]>,
): string | undefined => {
  if (!option) return undefined;
  const optionMeeple = (
    option as unknown as { assets?: { meepleSvg?: { appPath?: string } } }
  ).assets?.meepleSvg?.appPath;
  const draw = characterDrawOf(option);
  const charId = draw && characters[option.id]?.[0];
  if (draw && charId) {
    const pool = (
      option as unknown as Record<
        string,
        Array<{ id: string; meeple?: { appPath?: string } }> | undefined
      >
    )[draw.poolField];
    const charMeeple = pool?.find((c) => c.id === charId)?.meeple?.appPath;
    if (charMeeple) return charMeeple;
  }
  return optionMeeple;
};

// The setup instructions to print on an option's card: its own
// `setupInstructions`, or else a single setup line under
// `cards.promoted.setup`. Returns [] when neither is present.
const setupLinesFor = (option: SetupOption | undefined): string[] => {
  if (!option) return [];
  const lines = option.setupInstructions ?? [];
  if (lines.length > 0) return lines;
  const setup = (
    option as unknown as { cards?: { promoted?: { setup?: string } } }
  ).cards?.promoted?.setup;
  return setup ? [setup] : [];
};

// Project an option for transmission to a companion: bakes the dealt
// character's meeple onto `assets.meepleSvg.appPath` (so the companion
// shows the dealt character's pawn, not the option's generic one) and
// fills `setupInstructions` from the card's setup line (so a single setup line
// renders on the companion through the same code path as a list).
// The companion has neither the dealt-characters map nor the card
// transcription logic, so we resolve both host-side before sending.
const optionForCompanion = (
  option: SetupOption,
  characters: Record<string, string[]>,
): SetupOption => {
  const meeple = meepleAppPathFor(option, characters);
  const lines = setupLinesFor(option);
  const base = option as unknown as {
    assets?: { meepleSvg?: { appPath?: string } };
  };
  return {
    ...option,
    ...(meeple
      ? {
          assets: {
            ...(base.assets ?? {}),
            meepleSvg: { ...(base.assets?.meepleSvg ?? {}), appPath: meeple },
          },
        }
      : {}),
    ...(lines.length > 0 ? { setupInstructions: lines } : {}),
  } as unknown as SetupOption;
};

const dealCharactersFor = (
  optionIds: string[],
  options: SetupOption[],
  context: SetupContext,
  // Characters already dealt this game (from the player-pick choice), so
  // an `exclusive` group (copies of one option) never repeats a
  // character across separate picks.
  existing: Record<string, string[]> = {},
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  // Per exclusive-group set of already-used character ids: seeded from
  // prior picks, then grown as we deal within this call.
  const usedByGroup: Record<string, Set<string>> = {};
  for (const [oid, chars] of Object.entries(existing)) {
    const group = characterDrawOf(
      options.find((o) => o.id === oid),
    )?.exclusiveGroup;
    if (!group) continue;
    if (!usedByGroup[group]) usedByGroup[group] = new Set();
    for (const c of chars) usedByGroup[group].add(c);
  }
  for (const id of optionIds) {
    const option = options.find((o) => o.id === id);
    const draw = characterDrawOf(option);
    if (!option || !draw) continue;
    const pool = (
      option as unknown as Record<
        string,
        Array<{ id: string; module?: string }> | undefined
      >
    )[draw.poolField];
    if (!Array.isArray(pool) || pool.length === 0) continue;
    // Gate pool members by their `module` against the enabled
    // modules, the same rule as any option, so characters from an
    // expansion are only dealt when that module is on.
    let eligible = pool
      .filter((c) => optionVisibleUnderContext(c, context))
      .map((c) => c.id);
    const group = draw.exclusiveGroup;
    if (group) {
      if (!usedByGroup[group]) usedByGroup[group] = new Set();
      const used = usedByGroup[group];
      eligible = eligible.filter((cid) => !used.has(cid));
    }
    if (eligible.length === 0) continue;
    const picked = shuffleAndTake(eligible, draw.count);
    out[id] = picked;
    if (group) {
      const used = usedByGroup[group];
      for (const c of picked) used.add(c);
    }
  }
  return out;
};

// The same colours the app falls back to for an unnamed player.
const GENERIC_PALETTE = DEFAULT_PLAYER_PALETTE;

interface TrackPlayersRow {
  name: string;
  color: string;
}

// ── Component ───────────────────────────────────────────────────────

export const GameSetupWizard = forwardRef<
  GameSetupWizardHandle,
  GameSetupWizardProps
>(function GameSetupWizard(
  {
    isOpen,
    onSubmit,
    onClose,
    definitions = listDefinitions(),
    initialDefinitionId = DEFAULT_DEFINITION_ID,
    peerHooks,
    sidePanel,
    onScreenChange,
  },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const initialDefinition = useMemo(
    () =>
      findDefinition(initialDefinitionId) ??
      definitions[0] ??
      findDefinition(DEFAULT_DEFINITION_ID)!,
    [initialDefinitionId, definitions],
  );

  const [definitionId, setDefinitionId] = useState<string>(
    initialDefinition.id,
  );
  const definition = useMemo(
    () => definitions.find((d) => d.id === definitionId) ?? initialDefinition,
    [definitions, definitionId, initialDefinition],
  );

  // The wizard stays mounted when closed, so the preview is tied to isOpen:
  // a cancelled setup hands the look back to the running game.
  useGameThemePreview(isOpen ? definitionId : undefined);

  const [expectedTurns, setExpectedTurns] = useState<number>(
    initialDefinition.defaultExpectedTurns,
  );
  const [context, setContext] = useState<SetupContext>(
    defaultContext(initialDefinition),
  );

  // Track-players is only used for definitions without a seat-players
  // step (Generic). Driven separately from setupContext.
  const [trackPlayers, setTrackPlayers] = useState(false);
  const [trackRoster, setTrackRoster] = useState<TrackPlayersRow[]>([
    { name: "Player 1", color: GENERIC_PALETTE[0] },
    { name: "Player 2", color: GENERIC_PALETTE[1] },
  ]);

  // Turn-order choice for definitions that mark their turn order
  // `selectable`; defaults to the declared mode.
  const [turnOrderMode, setTurnOrderMode] = useState<SelectableTurnOrderMode>(
    defaultTurnOrderMode(initialDefinition),
  );

  const screens = useMemo(
    () => buildScreens(definition, context),
    [definition, context],
  );
  const [screenIndex, setScreenIndex] = useState(0);
  // Reset wizard when definition changes.
  useEffect(() => {
    setTurnOrderMode(defaultTurnOrderMode(definition));
    setScreenIndex(0);
    setContext(defaultContext(definition));
    setExpectedTurns(definition.defaultExpectedTurns);
  }, [definition]);
  // Notify the parent on every screen change (incl. mount) so it can
  // toggle ancillary UI like the share side panel.
  useEffect(() => {
    onScreenChange?.(screenIndex);
  }, [screenIndex, onScreenChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      // Fresh open: reset everything to the definition's defaults so
      // the user starts from a clean wizard, not mid-stream from an
      // old in-progress run.
      setScreenIndex(0);
      setContext(defaultContext(definition));
      setExpectedTurns(definition.defaultExpectedTurns);
      setTrackPlayers(false);
      setTrackRoster([
        { name: "Player 1", color: GENERIC_PALETTE[0] },
        { name: "Player 2", color: GENERIC_PALETTE[1] },
      ]);
      dialog.showModal();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen, definition]);

  // Steps gate on choices made on earlier screens, so the list can
  // shrink under the cursor; clamp rather than index past the end.
  const currentScreen = screens[Math.min(screenIndex, screens.length - 1)];
  const isLast = screenIndex >= screens.length - 1;
  const isFirst = screenIndex === 0;

  // Imperative pick (driven by peer SETUP_PICK messages). Same shape
  // as the picker's local pick() so the host's reducer is the only
  // mutator of player-pick context.
  const applyPick = useCallback(
    (stepId: string, seatIndex: number, optionId: string) => {
      setContext((prev) => {
        const current =
          prev[stepId]?.kind === "player-pick"
            ? (prev[stepId] as Extract<SetupChoice, { kind: "player-pick" }>)
            : { kind: "player-pick" as const, picks: {} };
        // Deal any character that accompanies this option, exactly as a
        // local pick does, so a companion's turn-based pick still gets its
        // character and meeple.
        const step = definition.setupSteps?.find((s) => s.id === stepId);
        const options =
          step?.kind.type === "player-pick" ? step.kind.options : [];
        // Preserve a character already dealt for this option (draft mode
        // deals up front); only deal here when none exists yet.
        const alreadyDealt = (current.characters?.[optionId]?.length ?? 0) > 0;
        const characterDeal =
          !alreadyDealt &&
          characterDrawOf(options.find((o) => o.id === optionId))
            ? dealCharactersFor([optionId], options, prev, current.characters)
            : null;
        return {
          ...prev,
          [stepId]: {
            ...current,
            picks: { ...current.picks, [seatIndex]: optionId },
            ...(characterDeal
              ? {
                  characters: {
                    ...(current.characters ?? {}),
                    ...characterDeal,
                  },
                }
              : {}),
          },
        };
      });
    },
    [definition],
  );

  // Imperative dealt-resolve pick (driven by peer SETUP_PICK
  // messages on a `dealt-resolve` step). Validates active-seat
  // and not-already-confirmed under the hood: out-of-order or
  // duplicate requests are no-ops.
  const applyResolve = useCallback(
    (stepId: string, seatIndex: number, optionId: string) => {
      setContext((prev) => {
        const current =
          prev[stepId]?.kind === "dealt-resolve"
            ? (prev[stepId] as Extract<SetupChoice, { kind: "dealt-resolve" }>)
            : { kind: "dealt-resolve" as const, confirmedIds: [] };
        // Only the seat whose turn it is may confirm; ignore everyone else.
        const step = definition.setupSteps?.find((s) => s.id === stepId);
        const seated = Object.values(prev).find(
          (c) => c.kind === "seat-players",
        );
        const sequence = seatPickSequence(
          seated?.kind === "seat-players" ? seated.seats.length : 0,
          step?.kind.type === "dealt-resolve" ? step.kind.order : undefined,
        );
        if (sequence[current.confirmedIds.length] !== seatIndex) return prev;
        // Refuse duplicates.
        if (current.confirmedIds.includes(optionId)) return prev;
        return {
          ...prev,
          [stepId]: {
            ...current,
            confirmedIds: [...current.confirmedIds, optionId],
          },
        };
      });
    },
    [definition],
  );

  // Bounds for the seating step (used by applySeatingChange below).
  const seatingStep = useMemo(
    () => definition.setupSteps?.find((s) => s.kind.type === "seat-players"),
    [definition],
  );
  const seatingBounds = useMemo(() => {
    if (seatingStep?.kind.type !== "seat-players") {
      return { min: 1, max: 6 };
    }
    return {
      min: seatingStep.kind.minPlayers ?? 1,
      max: seatingStep.kind.maxPlayers ?? 6,
    };
  }, [seatingStep]);

  const updateSeats = useCallback<GameSetupWizardHandle["updateSeats"]>(
    (stepId, change) => {
      setContext((prev) => {
        const current = prev[stepId];
        if (current?.kind !== "seat-players") return prev;
        return {
          ...prev,
          [stepId]: { ...current, seats: change(current.seats) },
        };
      });
    },
    [],
  );

  const getStepKind = useCallback(
    (stepId: string) =>
      definition.setupSteps?.find((s) => s.id === stepId)?.kind.type,
    [definition],
  );

  useImperativeHandle(
    ref,
    () => ({
      applyPick,
      applyResolve,
      updateSeats,
      getStepKind,
    }),
    [applyPick, applyResolve, updateSeats, getStepKind],
  );

  // Broadcast seating updates so every connected companion can render
  // + edit the seat list in step. Fires on mount + every change.
  const seatingChoice =
    seatingStep && context[seatingStep.id]?.kind === "seat-players"
      ? (context[seatingStep.id] as Extract<
          SetupChoice,
          { kind: "seat-players" }
        >)
      : null;
  useEffect(() => {
    if (
      !isOpen ||
      seatingStep?.kind.type !== "seat-players" ||
      !seatingChoice
    ) {
      peerHooks?.onSeatingChange?.(null);
      return;
    }
    peerHooks?.onSeatingChange?.({
      stepId: seatingStep.id,
      seats: seatingChoice.seats,
      minPlayers: seatingBounds.min,
      maxPlayers: seatingBounds.max,
      colorOptions: seatingStep.kind.colorOptions,
    });
  }, [
    isOpen,
    peerHooks,
    seatingStep,
    seatingChoice,
    seatingBounds.min,
    seatingBounds.max,
  ]);

  // Fire onTurnEnd when navigating away from a turn-based player-pick
  // screen so the parent can broadcast SETUP_DONE to companions.
  const lastTurnBasedStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    const cs = currentScreen;
    const onScreenForStep =
      cs.kind === "setup-step" &&
      cs.step.kind.type === "player-pick" &&
      cs.step.kind.mode === "turn-based"
        ? cs.step.id
        : null;
    const prev = lastTurnBasedStepIdRef.current;
    if (prev && prev !== onScreenForStep) {
      peerHooks?.onTurnEnd?.({ stepId: prev });
    }
    lastTurnBasedStepIdRef.current = onScreenForStep;
  }, [currentScreen, peerHooks]);

  // ── Per-screen guards ───────────────────────────────────────────

  const screenError = useMemo(
    () => validateScreen(currentScreen, context, trackPlayers, trackRoster),
    [currentScreen, context, trackPlayers, trackRoster],
  );

  const next = () => {
    if (screenError) return;
    if (isLast) return submit();
    setScreenIndex((i) => Math.min(i + 1, screens.length - 1));
  };
  const back = () => setScreenIndex((i) => Math.max(0, i - 1));

  const submit = (autoStart = false) => {
    // Only the steps that were actually offered contribute: a hidden
    // step's default choice must not leak into the players or context.
    const shownSteps = visibleSetupSteps(definition, context);
    const shownContext: SetupContext = Object.fromEntries(
      shownSteps
        .filter((s) => context[s.id] !== undefined)
        .map((s) => [s.id, context[s.id]]),
    );
    const players = collectPlayers(
      { ...definition, setupSteps: shownSteps },
      shownContext,
      trackPlayers,
      trackRoster,
    );
    // When the definition declares turnsPerPlayer, derive
    // expectedTurns at submit time from the seat count. Saves the
    // user from a redundant screen and keeps a definition's turns-each
    // rule applied automatically.
    const resolvedExpectedTurns =
      definition.turnsPerPlayer != null && players && players.length > 0
        ? definition.turnsPerPlayer * players.length
        : expectedTurns;
    onSubmit({
      expectedTurns: resolvedExpectedTurns,
      players,
      definitionId: definition.id,
      setupContext: definition.setupSteps?.length ? shownContext : undefined,
      ...(definition.turnOrder?.selectable ? { turnOrderMode } : {}),
      ...(autoStart ? { autoStart: true } : {}),
    });
  };

  // Defer auto-submit by one commit so the just-applied pick reaches
  // `context` before submit() reads it. Background: confirmPreview()
  // calls applyPick (which schedules setContext) and onAllConfirmed
  // synchronously in the same event handler, if we submitted there
  // and then, submit() would close over the stale pre-pick context
  // and emit a players[] missing the LAST seat's metadata. Flipping
  // a flag lets React commit setContext first, then the effect runs
  // with a fresh `context` in scope.
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);
  // submit() intentionally excluded from deps: it reads `context`
  // which IS a dep, and we don't want stale closures racing the
  // flag flip. The effect fires exactly once per request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: submit excluded to fire once per request without stale-closure race
  useEffect(() => {
    if (!autoSubmitPending) return;
    submit(true);
    setAutoSubmitPending(false);
  }, [autoSubmitPending, context]);

  // ── Render ──────────────────────────────────────────────────────

  // Show the side panel only on the very first screen. On later
  // screens it slides out: see `.sidePanelHidden` for the
  // transition (gated by prefers-reduced-motion in CSS).
  const sidePanelVisible = sidePanel != null && screenIndex === 0;
  // Hero mode: the option picker (and any future turn-based
  // player-pick step) takes the whole viewport. The wizard chrome
  // collapses, the modal goes edge-to-edge, and the step renders
  // its card row as the dominant visual.
  const isHeroScreen =
    currentScreen.kind === "setup-step" &&
    currentScreen.step.kind.type === "player-pick" &&
    currentScreen.step.kind.mode === "turn-based";

  return (
    <dialog
      ref={dialogRef}
      className={styles.modal}
      data-hero={isHeroScreen ? "true" : undefined}
      aria-labelledby="wizard-title"
      onClose={onClose}
    >
      <div className={styles.modalInner}>
        {sidePanel != null && (
          <aside
            className={`${styles.sidePanel} ${
              sidePanelVisible ? "" : styles.sidePanelHidden
            }`}
            aria-hidden={!sidePanelVisible}
          >
            {sidePanel}
          </aside>
        )}
        <form
          className={`${styles.form} ${styles.formCard}`}
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <header className={styles.header}>
            <div className={styles.headerRow}>
              <Heading level={2} size={3} id="wizard-title">
                Game setup
              </Heading>
              <span className={styles.crumbs}>
                {screenIndex + 1} / {screens.length} · {currentScreen.label}
              </span>
              {/* In-modal FullScreen toggle: the dialog's backdrop
                blocks the one in the page chrome, so this mirrors
                it inside the modal layer. */}
              <FullScreenToggle tooltipAlign="end" />
            </div>
            <div
              className={styles.progress}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={screens.length}
              aria-valuenow={screenIndex + 1}
            >
              {screens.map((s, i) => (
                <span
                  key={s.id}
                  className={
                    i === screenIndex
                      ? `${styles.progressTick} ${styles.progressTickActive}`
                      : i < screenIndex
                        ? `${styles.progressTick} ${styles.progressTickDone}`
                        : styles.progressTick
                  }
                />
              ))}
            </div>
          </header>

          <section className={styles.body} aria-labelledby="screen-title">
            {currentScreen.kind === "game" && (
              <GameScreen
                definitions={definitions}
                definitionId={definitionId}
                onChange={setDefinitionId}
              />
            )}
            {currentScreen.kind === "expected-turns" && (
              <ExpectedTurnsScreen
                value={expectedTurns}
                onChange={setExpectedTurns}
              />
            )}
            {currentScreen.kind === "setup-step" && (
              <StepScreen
                step={currentScreen.step}
                steps={definition.setupSteps ?? []}
                context={context}
                setContext={setContext}
                peerHooks={peerHooks}
                onAllConfirmed={() => {
                  // Last seat just confirmed its pick: auto-advance
                  // the wizard. If we're already on the final
                  // screen, we defer to a useEffect (see
                  // autoSubmitPending) so React commits the
                  // applyPick'd context before submit() reads it.
                  // Without the defer, the last seat's metadata
                  // races and lands empty on the player record.
                  if (isLast) setAutoSubmitPending(true);
                  else next();
                }}
              />
            )}
            {currentScreen.kind === "track-players" && (
              <TrackPlayersScreen
                enabled={trackPlayers}
                onEnabledChange={setTrackPlayers}
                roster={trackRoster}
                onRosterChange={setTrackRoster}
                turnOrderMode={
                  definition.turnOrder?.selectable
                    ? { value: turnOrderMode, onChange: setTurnOrderMode }
                    : undefined
                }
              />
            )}
            {screenError && <p className={styles.error}>{screenError}</p>}
          </section>

          <footer className={styles.actions}>
            <div className={styles.actionsLeft}>
              {onClose && (
                <Button onClick={onClose}>
                  <X size={16} aria-hidden /> Cancel
                </Button>
              )}
            </div>
            <div className={styles.actionsRight}>
              <Button onClick={back} disabled={isFirst}>
                <ArrowLeft size={16} aria-hidden /> Back
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={screenError != null}
              >
                {isLast ? (
                  <>
                    <Play size={16} aria-hidden /> Start game
                  </>
                ) : (
                  <>
                    Next <ArrowRight size={16} aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </dialog>
  );
});

// ── Validation ──────────────────────────────────────────────────────

function validateScreen(
  screen: WizardScreen,
  context: SetupContext,
  trackPlayers: boolean,
  trackRoster: TrackPlayersRow[],
): string | null {
  if (screen.kind === "setup-step") {
    const step = screen.step;
    if (step.kind.type === "seat-players") {
      const choice = context[step.id];
      if (choice?.kind !== "seat-players") return null;
      const min = step.kind.minPlayers ?? 1;
      const max = step.kind.maxPlayers ?? 99;
      if (choice.seats.length < min)
        return `At least ${min} player${min === 1 ? "" : "s"} required.`;
      if (choice.seats.length > max) return `At most ${max} players.`;
      if (choice.seats.some((s) => !s.name.trim()))
        return `Every seat needs a name.`;
    }
    // Note: player-pick used to gate Next with an "Each of N players
    // needs a pick." message. Dropped: the picker auto-submits
    // when the last seat confirms (see PlayerPickScreen's
    // onAllConfirmed), so there's no in-practice scenario where a
    // user reaches a complete-picker screen with the button enabled.
    // Removing the gate means the awkward copy is gone too.
  }
  if (screen.kind === "track-players" && trackPlayers) {
    if (trackRoster.some((r) => !r.name.trim()))
      return `Every player needs a name.`;
  }
  return null;
}

// ── Players projection ─────────────────────────────────────────────

function collectPlayers(
  definition: GameDefinition,
  context: SetupContext,
  trackPlayers: boolean,
  trackRoster: TrackPlayersRow[],
): Player[] | undefined {
  const seatStep = findSeatPlayersStep(definition);
  const pickStep = findPlayerPickStep(definition);
  const visualKey = definition.playerVisualFrom;

  if (seatStep) {
    const seatChoice = context[seatStep.id];
    if (seatChoice?.kind !== "seat-players") return undefined;
    const pickChoice = pickStep ? context[pickStep.id] : undefined;
    const picks = pickChoice?.kind === "player-pick" ? pickChoice.picks : {};
    // Characters dealt alongside a pick, keyed by option id. Used to
    // pick a per-character meeple.
    const characters =
      pickChoice?.kind === "player-pick" ? (pickChoice.characters ?? {}) : {};
    const pickOptions =
      pickStep && pickStep.kind.type === "player-pick"
        ? pickStep.kind.options
        : [];
    return seatChoice.seats.map((seat, i) => {
      const pickedId = picks[i];
      const option = pickedId
        ? pickOptions.find((o) => o.id === pickedId)
        : undefined;
      const metadata: Record<string, PlayerMetadataValue> = {};
      if (visualKey && option) {
        const assets = (
          option as unknown as {
            assets?: {
              meepleSvg?: { appPath?: string };
              headIcon?: Array<{ appPath?: string }>;
            };
          }
        ).assets;
        // Body meeple = the dealt character's meeple when there is one;
        // HEAD stays the option's own head art. The per-character meeple
        // isn't a head crop, so the character comes through via the body
        // meeple, not the head.
        const meeple = meepleAppPathFor(option, characters);
        const head = assets?.headIcon?.[0]?.appPath;
        metadata[visualKey] = {
          type: "selected-option",
          optionId: option.id,
          label: option.label,
          color: option.color ?? fallbackColor(i),
          description: option.description,
          ...(meeple ? { iconSrc: meeple } : {}),
          ...(head ? { headIconSrc: head } : {}),
        };
      }
      // The seat's own colour pick lands under the seating step's id;
      // the definition's `playerColorFrom` points renderers at it.
      const seatColor =
        seatStep.kind.type === "seat-players"
          ? seatStep.kind.colorOptions?.find((o) => o.id === seat.colorId)
          : undefined;
      if (seatColor) {
        metadata[seatStep.id] = {
          type: "selected-option",
          optionId: seatColor.id,
          label: seatColor.label,
          color: seatColor.color,
        };
      }
      return { name: seat.name, metadata };
    });
  }

  if (trackPlayers && trackRoster.length > 0) {
    return trackRoster.map((row) => ({
      name: row.name,
      metadata: visualKey
        ? {
            [visualKey]: {
              type: "selected-option",
              optionId: row.color,
              label: row.name,
              color: row.color,
            },
          }
        : {},
    }));
  }
  return undefined;
}

// ── Screens ─────────────────────────────────────────────────────────

function GameScreen({
  definitions,
  definitionId,
  onChange,
}: {
  definitions: GameDefinition[];
  definitionId: string;
  onChange: (id: string) => void;
}) {
  const def = definitions.find((d) => d.id === definitionId);
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        <Dices size={18} aria-hidden /> Pick a game
      </Heading>
      <SelectField
        aria-label="Game"
        value={definitionId}
        onChange={(e) => onChange(e.target.value)}
      >
        {definitions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      {def?.description && <p className={styles.help}>{def.description}</p>}
      <Link href="/games" className={styles.help}>
        <Settings size={12} aria-hidden /> Manage games
      </Link>
    </>
  );
}

function ExpectedTurnsScreen({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        How long is this game?
      </Heading>
      <SectionLabel as="label" htmlFor="expected-turns">
        Expected turns
      </SectionLabel>
      <NumberField
        id="expected-turns"
        min={1}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

function StepScreen({
  step,
  steps,
  context,
  setContext,
  peerHooks,
  onAllConfirmed,
}: {
  step: SetupStep;
  // Sibling steps: used by `dealt-resolve` to look up option
  // labels on its upstream `sourceStepId`.
  steps: SetupStep[];
  context: SetupContext;
  setContext: (updater: (prev: SetupContext) => SetupContext) => void;
  peerHooks?: WizardPeerHooks;
  // Forwarded to PlayerPickScreen: fires when the last seat
  // confirms its pick so the wizard can auto-advance.
  onAllConfirmed?: () => void;
}) {
  switch (step.kind.type) {
    case "multi-toggle":
      return (
        <MultiToggleScreen
          step={step}
          options={step.kind.options}
          selectedIds={
            context[step.id]?.kind === "multi-toggle"
              ? (
                  context[step.id] as Extract<
                    SetupChoice,
                    { kind: "multi-toggle" }
                  >
                ).selectedIds
              : (step.kind.defaultSelectedIds ?? [])
          }
          onChange={(selectedIds) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "multi-toggle", selectedIds },
            }))
          }
        />
      );
    case "select-one":
      return (
        <SelectOneScreen
          step={step}
          options={step.kind.options}
          context={context}
          selectedId={
            context[step.id]?.kind === "select-one"
              ? (
                  context[step.id] as Extract<
                    SetupChoice,
                    { kind: "select-one" }
                  >
                ).optionId
              : (step.kind.defaultOptionId ?? step.kind.options[0]?.id)
          }
          onChange={(optionId) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "select-one", optionId },
            }))
          }
        />
      );
    case "select-count":
      return (
        <CountScreen
          step={step}
          min={step.kind.min}
          max={step.kind.max}
          value={
            context[step.id]?.kind === "select-count"
              ? (
                  context[step.id] as Extract<
                    SetupChoice,
                    { kind: "select-count" }
                  >
                ).count
              : (step.kind.defaultValue ?? step.kind.min)
          }
          onChange={(count) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "select-count", count },
            }))
          }
        />
      );
    case "toggle":
      return (
        <ToggleScreen
          step={step}
          value={
            context[step.id]?.kind === "toggle"
              ? (context[step.id] as Extract<SetupChoice, { kind: "toggle" }>)
                  .value
              : (step.kind.defaultValue ?? false)
          }
          onChange={(value) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "toggle", value },
            }))
          }
        />
      );
    case "seat-players":
      return (
        <SeatPlayersScreen
          step={step}
          choice={
            context[step.id]?.kind === "seat-players"
              ? (context[step.id] as Extract<
                  SetupChoice,
                  { kind: "seat-players" }
                >)
              : { kind: "seat-players", seats: [] }
          }
          onChange={(next) =>
            setContext((prev) => ({ ...prev, [step.id]: next }))
          }
        />
      );
    case "deal-random":
      return (
        <DealRandomScreen
          step={step}
          options={step.kind.options}
          count={step.kind.count}
          optional={step.kind.optional ?? false}
          context={context}
          choice={context[step.id]}
          onChange={(next) =>
            setContext((prev) => ({ ...prev, [step.id]: next }))
          }
        />
      );
    case "player-pick":
      return (
        <PlayerPickScreen
          step={step}
          steps={steps}
          options={step.kind.options}
          constraints={mutexPairsOf(step.kind.constraints)}
          mode={step.kind.mode}
          context={context}
          peerHooks={peerHooks}
          onChange={(updater) =>
            setContext((prev) => {
              const current =
                prev[step.id]?.kind === "player-pick"
                  ? (prev[step.id] as Extract<
                      SetupChoice,
                      { kind: "player-pick" }
                    >)
                  : { kind: "player-pick" as const, picks: {} };
              return { ...prev, [step.id]: updater(current) };
            })
          }
          onAllConfirmed={onAllConfirmed}
        />
      );
    case "dealt-resolve": {
      const kind = step.kind;
      if (kind.type !== "dealt-resolve") return null;
      const sourceStep = steps.find((s) => s.id === kind.sourceStepId);
      const sourceOptions: SetupOption[] =
        sourceStep && sourceStep.kind.type === "deal-random"
          ? sourceStep.kind.options
          : [];
      return (
        <DealtResolveScreen
          step={step}
          sourceStepId={kind.sourceStepId}
          sourceOptions={sourceOptions}
          context={context}
          peerHooks={peerHooks}
          onChange={(updater) =>
            setContext((prev) => {
              const current =
                prev[step.id]?.kind === "dealt-resolve"
                  ? (prev[step.id] as Extract<
                      SetupChoice,
                      { kind: "dealt-resolve" }
                    >)
                  : {
                      kind: "dealt-resolve" as const,
                      confirmedIds: [],
                    };
              return { ...prev, [step.id]: updater(current) };
            })
          }
        />
      );
    }
    case "select-lead": {
      const seatStep = steps.find((s) => s.kind.type === "seat-players");
      const seatChoice = seatStep ? context[seatStep.id] : undefined;
      const seats = seatChoice?.kind === "seat-players" ? seatChoice.seats : [];
      const current = Math.min(
        leadSeatOf(context, step.id),
        Math.max(seats.length - 1, 0),
      );
      return (
        <SelectLeadScreen
          step={step}
          seats={seats}
          allowRandom={step.kind.allowRandom ?? false}
          selectedIndex={current}
          onChange={(seatIndex) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "select-lead", seatIndex },
            }))
          }
        />
      );
    }
    case "info":
      return <InfoScreen step={step} />;
  }
}

// Pick which seat starts as the turn-order lead. Lists the seated roster as chips; an optional Randomise
// button rolls a fair starting lead. The chosen seat index is stored
// generically: the timer page seeds its lead anchor from it.
function SelectLeadScreen({
  step,
  seats,
  allowRandom,
  selectedIndex,
  onChange,
}: {
  step: SetupStep;
  seats: Array<{ id: string; name: string }>;
  allowRandom: boolean;
  selectedIndex: number;
  onChange: (seatIndex: number) => void;
}) {
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      {seats.length === 0 ? (
        <p className={styles.screenSubtitle}>Seat players first.</p>
      ) : (
        <>
          <div className={styles.chipGrid}>
            {seats.map((seat, i) => (
              <ListRow
                key={seat.id}
                label={seat.name}
                pressed={i === selectedIndex}
                onClick={() => onChange(i)}
                aria-label={seat.name}
              />
            ))}
          </div>
          {allowRandom && (
            <Button onClick={() => onChange(randomIndex(seats.length))}>
              <Dices size={14} aria-hidden /> Randomise
            </Button>
          )}
        </>
      )}
    </>
  );
}

// Pure-text instructional screen: renders the step's label as the
// heading and the description as body. No input, no context entry,
// no validation. The wizard's Next button is the only action. Used
// for table-side reminders that have to live in the flow but don't
// need any decision (e.g. a "draw 5 cards" reminder).
function InfoScreen({ step }: { step: SetupStep }) {
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
    </>
  );
}

function MultiToggleScreen({
  step,
  options,
  selectedIds,
  onChange,
}: {
  step: SetupStep;
  options: SetupOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    const set = new Set(selectedIds);
    set.has(id) ? set.delete(id) : set.add(id);
    onChange(Array.from(set));
  };
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.toggleList}>
        {options.map((o) => {
          const checked = selectedIds.includes(o.id);
          return (
            <Toggle
              key={o.id}
              label={o.label}
              description={o.description}
              checked={checked}
              onChange={() => toggle(o.id)}
            />
          );
        })}
      </div>
    </>
  );
}

function SelectOneScreen({
  step,
  options,
  context,
  selectedId,
  onChange,
}: {
  step: SetupStep;
  options: SetupOption[];
  context: SetupContext;
  selectedId: string | undefined;
  onChange: (id: string) => void;
}) {
  const filtered = visibleOptions(options, context);
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.chipGrid}>
        {filtered.map((o) => (
          <ListRow
            key={o.id}
            label={o.label}
            hint={
              (o.module || o.description) && (
                <>
                  {o.module && (
                    <span className={styles.chipModule}>{o.module}</span>
                  )}
                  {o.description}
                </>
              )
            }
            pressed={o.id === selectedId}
            onClick={() => onChange(o.id)}
            aria-label={o.label}
          />
        ))}
      </div>
    </>
  );
}

function CountScreen({
  step,
  min,
  max,
  value,
  onChange,
}: {
  step: SetupStep;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <Stepper
        className={styles.stepper}
        value={value}
        valueLabel={`${step.label}: ${value}`}
        onDecrement={() => onChange(Math.max(min, value - 1))}
        onIncrement={() => onChange(Math.min(max, value + 1))}
        canDecrement={!atMin}
        canIncrement={!atMax}
        decrementLabel={`Decrease ${step.label.toLowerCase()}`}
        incrementLabel={`Increase ${step.label.toLowerCase()}`}
      />
    </>
  );
}

function ToggleScreen({
  step,
  value,
  onChange,
}: {
  step: SetupStep;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <Toggle
        label={value ? "Enabled" : "Disabled"}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </>
  );
}

function SeatPlayersScreen({
  step,
  choice,
  onChange,
}: {
  step: SetupStep;
  choice: Extract<SetupChoice, { kind: "seat-players" }>;
  onChange: (next: SetupChoice) => void;
}) {
  if (step.kind.type !== "seat-players") return null;
  const min = step.kind.minPlayers ?? 1;
  const max = step.kind.maxPlayers ?? 99;
  const seats = choice.seats;
  const colorOptions = step.kind.colorOptions ?? [];
  const update = (next: typeof seats) =>
    onChange({ kind: "seat-players", seats: next });

  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        <Users size={18} aria-hidden /> {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <SeatList
        seats={seats}
        label="Seats"
        colorOptions={colorOptions}
        minPlayers={min}
        maxPlayers={max}
        onRename={(i, name) => update(renameSeat(seats, i, name))}
        onMove={(from, to) => update(moveSeat(seats, from, to))}
        onRemove={(i) => {
          if (seats.length > min) update(removeSeat(seats, i));
        }}
        onAdd={() => {
          if (seats.length < max)
            update(addSeat(seats, { id: makeSeatId() }, colorOptions));
        }}
        onColor={(i, colorId) => update(setSeatColor(seats, i, colorId))}
      />
    </>
  );
}

// Generic: resolve a deal-random step's data-driven demotion rule
// against the seat count. The per-game numbers live in the definition
// (see DemoteRuleSchema); this just picks the highest matching threshold.
const demoteCountForSeats = (
  rule: { thresholds: Array<{ minSeats: number; count: number }> } | undefined,
  seats: number,
): number => {
  if (!rule) return 0;
  let n = 0;
  for (const t of rule.thresholds)
    if (seats >= t.minSeats) n = Math.max(n, t.count);
  return n;
};

function DealRandomScreen({
  step,
  options,
  count,
  optional,
  context,
  choice,
  onChange,
}: {
  step: SetupStep;
  options: SetupOption[];
  count: number;
  optional: boolean;
  context: SetupContext;
  choice: SetupChoice | undefined;
  onChange: (next: SetupChoice) => void;
}) {
  const visible = visibleOptions(options, context);
  const isSkipped = choice?.kind === "deal-random" && choice.skipped === true;
  const dealtIds =
    choice?.kind === "deal-random" && choice.skipped === false
      ? choice.dealtIds
      : null;
  const demotedIds =
    choice?.kind === "deal-random" && choice.skipped === false
      ? (choice.demotedIds ?? [])
      : [];

  // Seat count drives the demote rule. We treat any seat-players choice
  // in the context as the source: a game with seating has one, others have
  // none (in which case demoteCount = 0).
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seatCount = seatChoice?.seats.length ?? 0;
  // Demotion is opt-in per step via the definition's `demote` rule; steps
  // without one never demote.
  const demoteRule =
    step.kind.type === "deal-random" ? step.kind.demote : undefined;
  const demoteN = demoteCountForSeats(demoteRule, seatCount);

  const skip = () => onChange({ kind: "deal-random", skipped: true });

  // Deal exactly `n` (0 = skip). Used both by the fixed-count Shuffle
  // button and the 0..maxCount chooser below.
  const dealN = (n: number) => {
    if (n <= 0) {
      skip();
      return;
    }
    const newDealt = shuffleAndTake(
      visible.map((o) => o.id),
      n,
    );
    const newDemoted = shuffleAndTake(newDealt, demoteN);
    onChange({
      kind: "deal-random",
      skipped: false,
      dealtIds: newDealt,
      demotedIds: newDemoted,
    });
  };

  // When the step sets maxCount, the player picks how many to deal
  // (0..maxCount). Otherwise it's a fixed `count`.
  const maxCount =
    step.kind.type === "deal-random" ? step.kind.maxCount : undefined;
  const selectedCount = isSkipped ? 0 : (dealtIds?.length ?? 0);
  const reshuffle = () => dealN(selectedCount > 0 ? selectedCount : count);

  const cards = dealtIds
    ? dealtIds.map((id) => visible.find((o) => o.id === id)).filter(Boolean)
    : [];

  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.deck}>
        {isSkipped && (
          <div className={styles.skipNotice}>
            Skipped: no {step.label.toLowerCase()} this game.
          </div>
        )}
        {!isSkipped && dealtIds && (
          <>
            {demoteN > 0 && (
              <span className={styles.help}>
                {demoteN} of {count} start demoted at {seatCount} players.
              </span>
            )}
            <div className={styles.dealtList}>
              {(cards as SetupOption[]).map((o) => {
                const isDemoted = demotedIds.includes(o.id);
                const demoLabel = (
                  o as unknown as { demotedLabel?: string | null }
                ).demotedLabel;
                const iconSrc = (
                  o as unknown as {
                    assets?: { meepleSvg?: { appPath?: string } };
                  }
                ).assets?.meepleSvg?.appPath;
                return (
                  <div
                    key={o.id}
                    className={`${styles.dealtCard} ${
                      isDemoted ? styles.dealtCardDemoted : ""
                    }`}
                  >
                    {iconSrc && (
                      <img
                        src={iconSrc}
                        alt=""
                        aria-hidden
                        className={styles.dealtIcon}
                      />
                    )}
                    <span className={styles.dealtLabel}>
                      {isDemoted && demoLabel ? demoLabel : o.label}
                    </span>
                    {isDemoted && <Chip tone="muted">demoted</Chip>}
                    {(() => {
                      const lines = setupLinesFor(o);
                      if (lines.length === 0) return null;
                      return (
                        <ol className={styles.dealtSetup}>
                          {lines.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      );
                    })()}
                    {o.module && (
                      <span className={styles.dealtModule}>{o.module}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {maxCount != null ? (
          <div className={styles.actionsLeft}>
            {Array.from({ length: maxCount + 1 }, (_, n) => (
              <Chip
                key={n}
                pressed={selectedCount === n}
                onPress={() => dealN(n)}
              >
                {n === 0 ? "None" : n}
              </Chip>
            ))}
            {selectedCount > 0 && (
              <Button variant="ghost" onClick={reshuffle}>
                <RefreshCw size={14} aria-hidden /> Shuffle again
              </Button>
            )}
          </div>
        ) : (
          <div className={styles.actionsLeft}>
            <Button onClick={reshuffle}>
              <RefreshCw size={14} aria-hidden /> Shuffle
              {dealtIds ? " again" : ""}
            </Button>
            {optional && (
              <Button variant="ghost" onClick={skip}>
                Skip
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// Draft mode is the default for the player-pick screen: players
// receive a dealt hand of n+1 cards. The picker offers a local
// toggle to fall back to "show every legal option" when needed.
// The setup-context-driven toggle convention is gone; this is now
// purely picker-local state.

/** The seat chosen on a select-lead step (the first such step when no id is given), else 0. */
const leadSeatOf = (context: SetupContext, stepId?: string): number => {
  const choice =
    stepId !== undefined
      ? context[stepId]
      : Object.values(context).find((c) => c.kind === "select-lead");
  return choice?.kind === "select-lead" ? choice.seatIndex : 0;
};

/**
 * Seat indices in the order a player-pick step visits them: seat order
 * from `start`, reversed for `reverse-seat` (so the walk ends at `start`).
 */
const seatPickSequence = (
  count: number,
  order: PickOrder | undefined,
  start = 0,
): number[] => {
  const from = count > 0 ? Math.min(start, count - 1) : 0;
  const listed = Array.from({ length: count }, (_, i) => (from + i) % count);
  return order === "reverse-seat" ? listed.reverse() : listed;
};

function PlayerPickScreen({
  step,
  steps,
  options,
  constraints,
  mode,
  context,
  peerHooks,
  onChange,
  onAllConfirmed,
}: {
  step: SetupStep;
  // Every setup step, so options dealt earlier can rule picks out.
  steps: SetupStep[];
  options: SetupOption[];
  constraints: [string, string][];
  mode: "host-only" | "turn-based";
  context: SetupContext;
  peerHooks?: WizardPeerHooks;
  onChange: (
    updater: (
      current: Extract<SetupChoice, { kind: "player-pick" }>,
    ) => Extract<SetupChoice, { kind: "player-pick" }>,
  ) => void;
  // Fired once the last seat confirms its pick. The wizard
  // responds by auto-submitting (and the timer page auto-starts
  // the clock: see GameConfig.autoStart).
  onAllConfirmed?: () => void;
}) {
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seats = seatChoice?.seats ?? [];
  const pickOrder =
    step.kind.type === "player-pick" ? step.kind.pickOrder : undefined;
  const pickStart =
    step.kind.type === "player-pick" && step.kind.pickFrom === "lead"
      ? leadSeatOf(context)
      : 0;
  const seatSequence = useMemo(
    () => seatPickSequence(seats.length, pickOrder, pickStart),
    [seats.length, pickOrder, pickStart],
  );
  const firstSeat = seatSequence[0] ?? 0;
  const choice = context[step.id];
  const playerPick: Extract<SetupChoice, { kind: "player-pick" }> =
    choice?.kind === "player-pick"
      ? choice
      : { kind: "player-pick", picks: {} };
  const picks = playerPick.picks;
  const dealtIds = playerPick.dealtIds;
  const characters = playerPick.characters ?? {};

  // A step that declares a draft starts on the dealt hand; the picker
  // exposes a local toggle to fall back to the full pool when the table
  // wants free choice. Without one there is only the full pool.
  const draft = step.kind.type === "player-pick" ? step.kind.draft : undefined;
  const [draftChosen, setDraftEnabled] = useState(draft?.startsOn ?? true);
  const draftEnabled = draft !== undefined && draftChosen;
  const draftSkippable = draft?.skippable ?? true;
  // Two-step pick: clicking a card opens a full-screen preview
  // (showing the option's setup steps) instead of immediately committing.
  // A Confirm button accepts the pick; Back returns to the draft.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);

  // The legal pool: module-visible AND not ruled out by an option dealt
  // earlier. This is what the draft draws from, and what's shown when
  // draft is off.
  const offered = useMemo(
    () => visibleOptions(options, context),
    [options, context],
  );
  const pool = useMemo(
    () => offered.filter((o) => !optionExcludedByDeals(o.id, steps, context)),
    [offered, context, steps],
  );
  const excludedCount = offered.length - pool.length;

  const targetDealCount = seats.length + (draft?.dealExtra ?? 0);

  // Lazy deal when draft turns on and we don't yet have a hand.
  // useLayoutEffect (not useEffect) so the deal commits in the same
  // browser task as the picker's first paint, without this, the
  // hero card row paints empty for a frame between mount and the
  // post-paint useEffect that fills dealtIds. That empty frame is
  // both a visible flash and a real race for code (or tests) that
  // queries the dealt hand right after the heading appears. The
  // updater-form `if (curr.dealtIds != null) return curr` guards
  // against Strict Mode's double-invoked layout effect committing
  // two different deals back to back in dev.
  useLayoutEffect(() => {
    if (!draftEnabled) return;
    if (dealtIds != null) return;
    if (pool.length === 0 || seats.length === 0) return;
    const newDealt = dealWithoutMutexClashes(
      pool.map((o) => o.id),
      targetDealCount,
      constraints,
    );
    const newCharacters = dealCharactersFor(newDealt, options, context);
    onChange((curr) => {
      if (curr.dealtIds != null) return curr;
      return {
        ...curr,
        dealtIds: newDealt,
        characters: newCharacters,
      };
    });
  }, [
    draftEnabled,
    dealtIds,
    pool,
    seats.length,
    targetDealCount,
    options,
    onChange,
    context,
    constraints,
  ]);

  // Note: previous version dropped dealtIds when draft toggled off,
  // so re-enabling re-dealt a fresh hand and lost the player's
  // remaining picks. The dealt list now persists across draft
  // toggles: `visible` (above) renders the full pool when draft
  // is off and the still-in-hand subset when draft is on. Users
  // wanting a fresh deal use the Shuffle button explicitly.

  const reshuffle = () => {
    const newDealt = dealWithoutMutexClashes(
      pool.map((o) => o.id),
      targetDealCount,
      constraints,
    );
    const newCharacters = dealCharactersFor(newDealt, options, context);
    onChange((curr) => ({
      ...curr,
      picks: {},
      dealtIds: newDealt,
      characters: newCharacters,
    }));
    setActiveSeat(firstSeat);
  };

  // The step's pickOrder decides which seat picks first and which way
  // picking moves.
  const [activeSeat, setActiveSeat] = useState(firstSeat);
  // If the picker mounts before the seat-players context has
  // propagated, useState's initializer lands at 0. Once seats
  // populate, snap once to the first seat in pick order.
  const seatsInitialisedRef = useRef(false);
  useEffect(() => {
    if (seats.length === 0) return;
    if (!seatsInitialisedRef.current) {
      seatsInitialisedRef.current = true;
      setActiveSeat(firstSeat);
      return;
    }
    // Pin activeSeat in range when the seat count shrinks.
    if (activeSeat >= seats.length) {
      setActiveSeat(firstSeat);
    }
  }, [seats.length, activeSeat, firstSeat]);

  const [stepsOpenId, setStepsOpenId] = useState<string | null>(null);

  // When a card is picked in draft mode it animates out before being
  // removed from the dealt hand. `leavingIds` tracks the cards mid-
  // animation so the renderer keeps them mounted with the leave class
  // until the timer expires.
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const LEAVE_MS = 420;

  // What's actually rendered:
  //  - non-draft: the full legal pool, even already-picked cards (so
  //    picks render disabled instead of vanishing)
  //  - draft: dealt cards minus those already picked, PLUS any cards
  //    currently mid-leave-animation (so they animate out of the row
  //    rather than blinking away)
  const visible = useMemo(() => {
    if (!draftEnabled) return pool;
    if (!dealtIds) return [];
    const pickedIds = new Set(Object.values(picks));
    const stillInHand = dealtIds.filter(
      (id) => !pickedIds.has(id) || leavingIds.includes(id),
    );
    return stillInHand
      .map((id) => pool.find((o) => o.id === id))
      .filter((x): x is SetupOption => !!x);
  }, [draftEnabled, dealtIds, pool, picks, leavingIds]);

  const blockedForActive = blockedFor(activeSeat, picks, constraints);

  // pick() writes via the updater so it composes correctly even when
  // multiple clicks land before React re-renders. Auto-advance happens
  // in an effect below: keeping pick() pure on the choice.
  //
  // For options that have a character pool (`characterDraw`), we also
  // deal characters here so the picker can render
  // them even outside of draft mode (draft-mode dealing happens up
  // front via the deal effect).
  // Confirming the preview commits the pick AND, if this is the
  // last seat to fill, fires the all-confirmed callback so the
  // wizard can auto-advance and start the timer.
  const confirmPreview = (optionId: string) => {
    pick(optionId);
    setPreviewCardId(null);
  };

  // Fire onAllConfirmed once every seat has a pick: watching the
  // committed `picks` rather than firing inline from confirmPreview, so
  // a remote (companion) pick applied via applyPick advances the wizard
  // exactly like a local one. Guarded by a ref so it fires a single
  // time even if picks mutate again before the screen unmounts.
  const allConfirmedFiredRef = useRef(false);
  const allPicked = seats.length > 0 && seats.every((_, i) => picks[i] != null);
  useEffect(() => {
    if (!allPicked) {
      allConfirmedFiredRef.current = false;
      return;
    }
    if (allConfirmedFiredRef.current) return;
    allConfirmedFiredRef.current = true;
    // Tell companions the turn phase is over (clears their picker) and
    // lets the host stop re-broadcasting the now-stale SETUP_TURN.
    if (mode === "turn-based") peerHooks?.onTurnEnd?.({ stepId: step.id });
    onAllConfirmed?.();
  }, [allPicked, onAllConfirmed, mode, peerHooks, step.id]);

  const pick = (optionId: string) => {
    const seatIdx = activeSeat;
    // Defensive: refuse to pick an option that another seat already
    // claims. The card UI marks claimed cards as `blocked`, but the
    // last-seat case has surfaced edge bugs (e.g. draft animation
    // race): this short-circuits any stale path.
    const takenBy = Object.entries(picks).find(
      ([s, id]) => Number(s) !== seatIdx && id === optionId,
    );
    if (takenBy) return;
    // Preserve a character already dealt for this option (in draft mode
    // it was dealt up front, and the preview showed its meeple), only
    // deal on pick when none exists yet (skip-draft mode).
    const alreadyDealt = (characters[optionId]?.length ?? 0) > 0;
    const characterDeal =
      !alreadyDealt && characterDrawOf(options.find((o) => o.id === optionId))
        ? dealCharactersFor([optionId], options, context, characters)
        : null;
    onChange((curr) => ({
      ...curr,
      picks: { ...curr.picks, [seatIdx]: optionId },
      ...(characterDeal
        ? {
            characters: { ...(curr.characters ?? {}), ...characterDeal },
          }
        : {}),
    }));
    if (draftEnabled) {
      setLeavingIds((curr) => [...curr, optionId]);
      window.setTimeout(() => {
        setLeavingIds((curr) => curr.filter((id) => id !== optionId));
      }, LEAVE_MS);
    }
  };

  // After a seat is filled, jump to the next unfilled seat in pick
  // order. If none remain after it, fall back to the first unfilled
  // seat in pick order, so the wizard recovers when the user re-edits
  // an earlier pick.
  useEffect(() => {
    if (picks[activeSeat] == null) return;
    const unfilled = (i: number) => picks[i] == null;
    const after = seatSequence.slice(seatSequence.indexOf(activeSeat) + 1);
    const next = after.find(unfilled) ?? seatSequence.find(unfilled);
    if (next !== undefined && next !== activeSeat) setActiveSeat(next);
  }, [picks, activeSeat, seatSequence]);

  // Emit onTurnStart per active seat when in turn-based mode. The
  // parent broadcasts SETUP_TURN; companions seated at that index
  // render their picker overlay. Re-fires when the visible pool
  // shrinks (e.g. after a draft re-shuffle) so the seated companion
  // sees the latest legal list.
  const findDefinition = (): GameDefinition | undefined => {
    // The picker has access to the merged option list but not the
    // top-level definition. Reconstruct a minimal definition so the
    // companion can render the picker: for now we ship the step's
    // options inline as `definition.setupSteps[0].kind.options` via
    // the picker-only synthetic def below.
    return undefined;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: findDefinition is a stable stub (always undefined); excluding avoids re-running every render
  useEffect(() => {
    if (mode !== "turn-based") return;
    if (!peerHooks?.onTurnStart) return;
    if (activeSeat < 0 || activeSeat >= seats.length) return;
    if (picks[activeSeat] != null) return; // already filled, no turn
    // Resolve each option for the companion: dealt-character meeple +
    // setup text baked in, since the companion has neither the
    // characters map nor the card-transcription logic of its own.
    const companionStep =
      step.kind.type === "player-pick"
        ? {
            ...step,
            kind: {
              ...step.kind,
              options: step.kind.options.map((o) =>
                optionForCompanion(o, characters),
              ),
            },
          }
        : step;
    peerHooks.onTurnStart({
      stepId: step.id,
      seatIndex: activeSeat,
      seatName: seats[activeSeat]?.name ?? `Seat ${activeSeat + 1}`,
      optionIds: visible.map((o) => o.id),
      excludedOptionIds: Array.from(blockedForActive),
      definition:
        findDefinition() ??
        // Synthetic minimal definition for the companion picker:
        // a single-step shell with this step's resolved options.
        ({
          schemaVersion: 1,
          id: "__wizard-snapshot",
          name: "Setup",
          defaultExpectedTurns: 0,
          defaultAverageSeconds: 0,
          setupSteps: [companionStep],
        } as unknown as GameDefinition),
    });
  }, [
    mode,
    peerHooks,
    activeSeat,
    seats,
    picks,
    visible,
    blockedForActive,
    step,
    characters,
  ]);

  // All hooks above run unconditionally (the two effects no-op when
  // there are no seats); this early return must stay below them.
  if (seats.length === 0) {
    return (
      <>
        <Heading
          level={3}
          size={2}
          className={styles.screenTitle}
          id="screen-title"
        >
          {step.label}
        </Heading>
        <p className={styles.help}>
          No seated players yet. Go back to the seating step first.
        </p>
      </>
    );
  }

  // Hero mode: dominate the viewport with a card row. Triggered
  // for turn-based player-pick steps. Other modes (host-only)
  // keep the compact panel further below.
  if (mode === "turn-based") {
    const seatName = seats[activeSeat]?.name ?? `Seat ${activeSeat + 1}`;
    // Full-screen preview takes over when the active seat has
    // clicked a card. Shows the chosen option's full setup steps
    // and gates the pick behind an explicit Confirm.
    if (previewCardId != null) {
      const previewOption = options.find((o) => o.id === previewCardId) ?? null;
      const previewSteps = setupLinesFor(previewOption ?? undefined);
      const previewMeeple = meepleAppPathFor(
        previewOption ?? undefined,
        characters,
      );
      const previewColor = previewOption?.color ?? "var(--color-border)";
      const previewLabel = previewOption?.label ?? previewCardId;
      const previewPortrait = previewMeeple
        ? undefined
        : (
            previewOption as unknown as {
              assets?: { headIcon?: Array<{ appPath?: string }> };
            }
          )?.assets?.headIcon?.[0]?.appPath;
      return (
        <div className={styles.heroPreview}>
          <VisuallyHidden as="h3" id="screen-title">
            {step.label}
          </VisuallyHidden>
          <div className={styles.heroPreviewInstruction}>
            <SectionLabel as="span">{seatName}: confirm your pick</SectionLabel>
            <span className={styles.heroPreviewTitle}>{previewLabel}</span>
          </div>
          <div
            className={styles.heroPreviewCard}
            style={
              {
                background: `color-mix(in srgb, ${previewColor} 18%, var(--color-surface))`,
                borderColor: previewColor,
              } as React.CSSProperties
            }
          >
            {previewMeeple ? (
              <img
                src={previewMeeple}
                alt=""
                aria-hidden
                className={styles.heroPreviewMeeple}
                style={{
                  background: previewColor,
                  WebkitMaskImage: `url(${previewMeeple})`,
                  maskImage: `url(${previewMeeple})`,
                }}
              />
            ) : previewPortrait ? (
              <img
                src={previewPortrait}
                alt=""
                aria-hidden
                className={styles.heroPreviewPortrait}
              />
            ) : null}
            {previewSteps.length > 0 && (
              <ol className={styles.heroPreviewSteps}>
                {previewSteps.map((s, i) => (
                  <li key={i}>
                    <span className={styles.heroCardStepsIndex}>{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            {previewOption &&
              characters[previewOption.id] &&
              characters[previewOption.id].length > 0 && (
                <div className={styles.heroCardCharacters}>
                  Dealt{" "}
                  {characterNoun(
                    previewOption,
                    characters[previewOption.id].length,
                  )}
                  <ul className={styles.heroCardCharactersList}>
                    {characters[previewOption.id].map((charId) => (
                      <li key={charId}>
                        {labelForCharacter(previewOption, charId)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
          <div className={styles.heroPreviewActions}>
            <Button onClick={() => setPreviewCardId(null)}>
              <ArrowLeft size={16} aria-hidden /> Back
            </Button>
            <Button
              variant="primary"
              onClick={() => confirmPreview(previewCardId)}
            >
              Confirm setup
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.heroPicker}>
        {/* Visually-hidden heading keeps screen reader + Playwright
            navigation working alongside the visible instruction. */}
        <VisuallyHidden as="h3" id="screen-title">
          {step.label}
        </VisuallyHidden>
        <div className={styles.heroPickerInstruction}>
          <SectionLabel as="span">
            {seats.filter((_, i) => picks[i] != null).length}/{seats.length}{" "}
            picked · seat {activeSeat + 1} of {seats.length}
          </SectionLabel>
          <span>
            {seatName}: choose your {step.label.toLowerCase()}
          </span>
        </div>

        <div className={styles.heroCardRow}>
          {visible.map((o) => {
            const blocked = blockedForActive.has(o.id);
            const active = picks[activeSeat] === o.id;
            const leaving = leavingIds.includes(o.id);
            const adsetSteps = o.setupInstructions;
            const meepleSrc = meepleAppPathFor(o, characters);
            // Fallback art for options that ship a portrait (headIcon)
            // but no silhouette meeple. Rendered as a plain image, not a
            // tinted mask.
            const portraitSrc = meepleSrc
              ? undefined
              : (
                  o as unknown as {
                    assets?: { headIcon?: Array<{ appPath?: string }> };
                  }
                ).assets?.headIcon?.[0]?.appPath;
            const onActivate = () => {
              if (blocked || leaving) return;
              // Two-step: clicking a card opens a full-screen
              // preview with the ADSET instructions; user must
              // press Confirm to commit the pick.
              setPreviewCardId(o.id);
            };
            return (
              <div
                key={o.id}
                role="button"
                aria-pressed={active}
                aria-disabled={blocked || leaving}
                aria-label={o.label}
                tabIndex={blocked || leaving ? -1 : 0}
                className={`${styles.heroCard} ${
                  active ? styles.heroCardActive : ""
                } ${blocked ? styles.heroCardDisabled : ""} ${
                  leaving ? styles.heroCardLeaving : ""
                }`}
                style={{
                  background: o.color
                    ? `color-mix(in srgb, ${o.color} 18%, var(--color-surface))`
                    : "var(--color-surface)",
                  borderColor: o.color ?? "var(--color-border)",
                }}
                onClick={onActivate}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onActivate();
                  }
                }}
              >
                <span className={styles.heroCardLabel}>
                  {o.label}
                  {(() => {
                    const military = (o as unknown as { military?: string })
                      .military;
                    if (military !== "militant" && military !== "insurgent")
                      return null;
                    return (
                      <Chip
                        tone="muted"
                        className={styles.heroCardMilitary}
                        data-variant={military}
                      >
                        {military}
                      </Chip>
                    );
                  })()}
                </span>
                {adsetSteps && adsetSteps.length > 0 && (
                  <ol className={styles.heroCardSteps}>
                    {adsetSteps.map((s, i) => (
                      <li key={i}>
                        <span className={styles.heroCardStepsIndex}>
                          {i + 1}.
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {characters[o.id] && characters[o.id].length > 0 && (
                  <div className={styles.heroCardCharacters}>
                    Dealt {characterNoun(o, characters[o.id].length)}
                    <ul className={styles.heroCardCharactersList}>
                      {characters[o.id].map((charId) => (
                        <li key={charId}>{labelForCharacter(o, charId)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {meepleSrc ? (
                  <img
                    src={meepleSrc}
                    alt=""
                    aria-hidden
                    className={styles.heroCardMeeple}
                    style={{
                      background: o.color ?? "var(--color-text)",
                      WebkitMaskImage: `url(${meepleSrc})`,
                      maskImage: `url(${meepleSrc})`,
                    }}
                  />
                ) : portraitSrc ? (
                  <img
                    src={portraitSrc}
                    alt=""
                    aria-hidden
                    className={styles.heroCardPortrait}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={styles.heroPickerFootnote}>
          <ul
            className={styles.heroPickerSummary}
            aria-label="Seat picks so far"
          >
            {seats.map((seat, i) => {
              const pickedId = picks[i];
              const option = pickedId
                ? (visible.find((o) => o.id === pickedId) ??
                  options.find((o) => o.id === pickedId))
                : undefined;
              const label = option
                ? `${seat.name}: ${option.label}`
                : `${seat.name}: not yet`;
              return (
                <li
                  key={i}
                  className={`${styles.heroPickerSummaryDot} ${
                    i === activeSeat
                      ? styles.heroPickerSummaryDotActive
                      : picks[i] != null
                        ? styles.heroPickerSummaryDotFilled
                        : ""
                  }`}
                  aria-label={label}
                  title={label}
                />
              );
            })}
          </ul>
          {draftEnabled && (
            <>
              <Button onClick={reshuffle}>
                <RefreshCw size={14} aria-hidden /> Shuffle
              </Button>
              {draftSkippable && (
                <Button variant="ghost" onClick={() => setDraftEnabled(false)}>
                  Skip draft
                </Button>
              )}
            </>
          )}
          {draft && draftSkippable && !draftEnabled && (
            <Button onClick={() => setDraftEnabled(true)}>
              <RefreshCw size={14} aria-hidden /> Back to draft
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}

      <div className={styles.activePickerHeader}>
        <span className={styles.pickerSeatIndex}>{activeSeat + 1}</span>
        <span className={styles.pickerSeatName}>
          {seats[activeSeat]?.name}: choose a {step.label.toLowerCase()}
        </span>
      </div>

      {draftEnabled && (
        <div className={styles.draftBar}>
          <span className={styles.help}>
            Drafting {targetDealCount} cards from {pool.length} legal options
            {excludedCount > 0
              ? ` (${excludedCount} excluded by dealt options)`
              : ""}
            .
          </span>
          <div className={styles.draftBarButtons}>
            <Button onClick={reshuffle}>
              <RefreshCw size={14} aria-hidden /> Shuffle again
            </Button>
            {draftSkippable && (
              <Button variant="ghost" onClick={() => setDraftEnabled(false)}>
                Skip draft
              </Button>
            )}
          </div>
        </div>
      )}
      {draft && draftSkippable && !draftEnabled && (
        <div className={styles.draftBar}>
          <span className={styles.help}>
            Free pick: every legal option visible.
          </span>
          <Button onClick={() => setDraftEnabled(true)}>
            <RefreshCw size={14} aria-hidden /> Back to draft
          </Button>
        </div>
      )}

      <div className={styles.pickDraftRow}>
        {visible.map((o) => {
          const blocked = blockedForActive.has(o.id);
          const active = picks[activeSeat] === o.id;
          const open = stepsOpenId === o.id;
          const leaving = leavingIds.includes(o.id);
          const setupSteps = setupLinesFor(o);
          const meepleSrc = meepleAppPathFor(o, characters);
          // Card is a div, not a button, so it can host the inner
          // "Show setup" button. role="button" + tabIndex keeps it
          // keyboard- and AT-accessible.
          const onActivate = () => {
            if (blocked || leaving) return;
            pick(o.id);
          };
          return (
            <div
              key={o.id}
              role="button"
              aria-pressed={active}
              aria-disabled={blocked || leaving}
              // Explicit aria-label so the card's accessible name is
              // just the option label, not the computed text of all
              // its children (which would include the nested toggle).
              aria-label={o.label}
              tabIndex={blocked || leaving ? -1 : 0}
              className={`${styles.pickCard} ${
                active ? styles.pickCardActive : ""
              } ${blocked ? styles.pickCardDisabled : ""} ${
                leaving ? styles.pickCardLeaving : ""
              }`}
              style={{
                // Faint wash of the option's colour so each card reads
                // as belonging to its option even at a glance.
                background: o.color
                  ? `color-mix(in srgb, ${o.color} 14%, transparent)`
                  : undefined,
                borderColor: o.color ?? undefined,
              }}
              onClick={onActivate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate();
                }
              }}
            >
              <div className={styles.pickHeader}>
                <span className={styles.pickLabel}>{o.label}</span>
              </div>
              {characters[o.id] && characters[o.id].length > 0 && (
                <div className={styles.characterDeal}>
                  <SectionLabel as="span">
                    Dealt {characterNoun(o, characters[o.id].length)}
                  </SectionLabel>
                  <ul className={styles.characterList}>
                    {characters[o.id].map((charId) => (
                      <li key={charId} className={styles.characterChip}>
                        {labelForCharacter(o, charId)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {setupSteps.length > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.pickStepsToggle}
                    onClick={() => setStepsOpenId(open ? null : o.id)}
                    aria-label={`${open ? "Hide" : "Show"} setup for ${o.label}`}
                  >
                    {open ? "Hide setup" : "Show setup"}
                  </Button>
                  {open && (
                    <ol className={styles.pickStepsList}>
                      {setupSteps.map((s, i) => (
                        <li key={i}>
                          <span className={styles.pickStepsIndex}>
                            {i + 1}.
                          </span>{" "}
                          {s}
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
              {meepleSrc && (
                <img
                  src={meepleSrc}
                  alt=""
                  aria-hidden
                  className={styles.pickCardIcon}
                  style={{
                    // Tint the silhouette via background + mask so the
                    // meeple takes the option colour. Browsers without
                    // mask-image support fall back to the native black
                    // SVG over the card wash: still readable.
                    background: o.color ?? "var(--color-text)",
                    WebkitMaskImage: `url(${meepleSrc})`,
                    maskImage: `url(${meepleSrc})`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.pickerSummary} aria-label="Seat picks so far">
        {seats.map((seat, i) => {
          const pickedId = picks[i];
          const option = pickedId
            ? (visible.find((o) => o.id === pickedId) ??
              options.find((o) => o.id === pickedId))
            : undefined;
          const isActive = i === activeSeat;
          return (
            <button
              type="button"
              key={i}
              className={`${styles.summaryButton} ${
                isActive ? styles.pickerSummaryActive : ""
              }`}
              onClick={() => setActiveSeat(i)}
            >
              <span
                className={styles.pickSwatch}
                style={{ background: option?.color ?? "var(--color-border)" }}
                aria-hidden
              />
              <span>
                <strong>{seat.name}</strong>
                {": "}
                {option ? (
                  option.label
                ) : (
                  <em className={styles.pickerSummaryPending}>not yet</em>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// Each seated player takes turns setting up one dealt item at a time,
// in seat order; each chooses from what the earlier seats left.
// This screen walks the dealt hand (from `sourceStepId`) one card
// at a time, names the seated player whose turn it is, and tracks
// confirmed setups in setupContext so Back/Next behave sanely.
function DealtResolveScreen({
  step,
  sourceStepId,
  sourceOptions,
  context,
  onChange,
  peerHooks,
}: {
  step: SetupStep;
  sourceStepId: string;
  sourceOptions: SetupOption[];
  context: SetupContext;
  onChange: (
    updater: (
      current: Extract<SetupChoice, { kind: "dealt-resolve" }>,
    ) => Extract<SetupChoice, { kind: "dealt-resolve" }>,
  ) => void;
  // Same hooks as PlayerPickScreen, when the active seat changes
  // we broadcast SETUP_TURN with a synthetic player-pick step
  // containing the remaining dealt items, so the seated companion
  // can pick on its own device via the same SETUP_PICK round-trip.
  peerHooks?: WizardPeerHooks;
}) {
  // Resolve the upstream deal-random step + the seat list.
  const sourceChoice = context[sourceStepId];
  const dealtIds =
    sourceChoice?.kind === "deal-random" && sourceChoice.skipped === false
      ? sourceChoice.dealtIds
      : [];
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seats = seatChoice?.seats ?? [];

  const current = context[step.id];
  const confirmedIds =
    current?.kind === "dealt-resolve" ? current.confirmedIds : [];

  // Each player resolves ONE dealt item in turn, walking the seats in
  // the step's `order`; later players choose from what's left. The step
  // is complete once every item or every seat has had its turn.
  const order =
    step.kind.type === "dealt-resolve" ? step.kind.order : undefined;
  const sequence = seatPickSequence(seats.length, order);
  const allDone =
    dealtIds.every((id) => confirmedIds.includes(id)) ||
    confirmedIds.length >= seats.length;
  const activeSeatIndex = allDone ? -1 : sequence[confirmedIds.length];
  const activePlayer = seats[activeSeatIndex];
  const remainingIds = dealtIds.filter((id) => !confirmedIds.includes(id));

  // Broadcast the active seat's choice list to companions via the
  // SETUP_TURN message. The synthetic definition wraps this step
  // in a `player-pick` shell so the companion's existing
  // SetupTurnPanel can render the dealt items without any
  // dealt-resolve-specific code on its side.
  // biome-ignore lint/correctness/useExhaustiveDependencies: peerHooks has stable identity; including it re-broadcasts every render
  useEffect(() => {
    if (!peerHooks?.onTurnStart) return;
    if (allDone) {
      peerHooks.onTurnEnd?.({ stepId: step.id });
      return;
    }
    if (activeSeatIndex < 0 || activeSeatIndex >= seats.length) return;
    const visibleOptions = remainingIds
      .map((id) => sourceOptions.find((o) => o.id === id))
      .filter((x): x is SetupOption => !!x);
    peerHooks.onTurnStart({
      stepId: step.id,
      seatIndex: activeSeatIndex,
      seatName: seats[activeSeatIndex]?.name ?? `Seat ${activeSeatIndex + 1}`,
      optionIds: remainingIds,
      excludedOptionIds: [],
      // Synthetic single-step definition: presents the dealt-resolve
      // step as a `player-pick` with options = remaining items.
      definition: {
        schemaVersion: 1,
        id: "__wizard-snapshot",
        name: "Setup",
        defaultExpectedTurns: 0,
        defaultAverageSeconds: 0,
        setupSteps: [
          {
            id: step.id,
            label: step.label,
            description: step.description,
            kind: {
              type: "player-pick",
              // Project setup text + meeple onto each option so the
              // companion shows the item's setup line (it has no
              // card-transcription logic of its own).
              options: visibleOptions.map((o) => optionForCompanion(o, {})),
              mode: "turn-based",
            },
          },
        ],
      } as unknown as GameDefinition,
    });
  }, [activeSeatIndex, allDone, dealtIds.length, sourceOptions, step.id]);

  if (dealtIds.length === 0) {
    return (
      <>
        <Heading
          level={3}
          size={2}
          className={styles.screenTitle}
          id="screen-title"
        >
          {step.label}
        </Heading>
        <p className={styles.help}>
          Nothing was dealt this game. Continue to the next screen.
        </p>
      </>
    );
  }

  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        {step.label}
      </Heading>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      {/* Per-player progress tiles. One per dealt item, in player
          order. Tile shows whether that seat has picked yet, plus a
          hover/aria title noting what they chose. */}
      <ol className={styles.resolveProgress} aria-label="Pick order">
        {dealtIds.map((_, i) => {
          if (i >= seats.length) return null;
          const seat = seats[sequence[i]];
          const pickedId = confirmedIds[i];
          const pickedOption = pickedId
            ? (sourceOptions.find((o) => o.id === pickedId) ?? {
                id: pickedId,
                label: pickedId,
              })
            : null;
          const isActive = i === confirmedIds.length && !allDone;
          const tip = pickedOption
            ? `${seat.name}: picked ${pickedOption.label}`
            : isActive
              ? `${seat.name}: choosing now`
              : `${seat.name}: waiting`;
          return (
            <li
              key={i}
              className={`${styles.resolveProgressItem} ${
                pickedOption
                  ? styles.resolveProgressItemDone
                  : isActive
                    ? styles.resolveProgressItemActive
                    : ""
              }`}
              aria-label={tip}
              title={tip}
            >
              {i + 1}
            </li>
          );
        })}
      </ol>
      {!allDone && activePlayer && (
        <>
          <div className={styles.resolvePrompt}>
            <span className={styles.resolvePromptSeat}>
              <strong>{activePlayer.name}</strong>
              {": choose one to set up"}
            </span>
          </div>
          <div className={styles.resolveChoiceList}>
            {remainingIds.map((id) => {
              const option = sourceOptions.find((o) => o.id === id) ?? {
                id,
                label: id,
              };
              const setupSteps = setupLinesFor(option as SetupOption);
              const meepleSrc = meepleAppPathFor(option as SetupOption, {});
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.resolveChoiceCard}
                  onClick={() =>
                    onChange((curr) => ({
                      ...curr,
                      confirmedIds: [...curr.confirmedIds, id],
                    }))
                  }
                  aria-label={`Set up ${option.label}`}
                >
                  {meepleSrc && (
                    <img
                      src={meepleSrc}
                      alt=""
                      aria-hidden
                      className={styles.dealtIcon}
                    />
                  )}
                  <span className={styles.resolveChoiceLabel}>
                    {option.label}
                  </span>
                  {setupSteps.length > 0 && (
                    <ol className={styles.resolveChoiceSteps}>
                      {setupSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
      {allDone && (
        <p className={styles.help}>All set up. Continue to the next screen.</p>
      )}
    </>
  );
}

function blockedFor(
  seatIndex: number,
  picks: Record<number, string>,
  mutex: [string, string][],
): Set<string> {
  const blocked = new Set<string>();
  for (const [i, pickedId] of Object.entries(picks)) {
    if (Number(i) === seatIndex || !pickedId) continue;
    blocked.add(pickedId);
    for (const [a, b] of mutex) {
      if (pickedId === a) blocked.add(b);
      if (pickedId === b) blocked.add(a);
    }
  }
  return blocked;
}

function TrackPlayersScreen({
  enabled,
  onEnabledChange,
  roster,
  onRosterChange,
  turnOrderMode,
}: {
  enabled: boolean;
  onEnabledChange: (b: boolean) => void;
  roster: TrackPlayersRow[];
  onRosterChange: (next: TrackPlayersRow[]) => void;
  // Present when the definition lets the table choose the turn order.
  turnOrderMode?: {
    value: SelectableTurnOrderMode;
    onChange: (mode: SelectableTurnOrderMode) => void;
  };
}) {
  const updateRow = (i: number, field: keyof TrackPlayersRow, value: string) =>
    onRosterChange(
      roster.map((r, j) => (i === j ? { ...r, [field]: value } : r)),
    );
  const setCount = (n: number) => {
    const next = [...roster];
    while (next.length < n)
      next.push({
        name: `Player ${next.length + 1}`,
        color: GENERIC_PALETTE[next.length % GENERIC_PALETTE.length],
      });
    onRosterChange(next.slice(0, n));
  };
  return (
    <>
      <Heading
        level={3}
        size={2}
        className={styles.screenTitle}
        id="screen-title"
      >
        <Users size={18} aria-hidden /> Players (optional)
      </Heading>
      <p className={styles.screenSubtitle}>
        Tracking lets the timer show whose turn it is and break time by player.
      </p>
      <Toggle
        label="Track individual players"
        checked={enabled}
        onChange={(e) => onEnabledChange(e.target.checked)}
      />
      {enabled && (
        <div className={styles.trackBlock}>
          <SectionLabel as="label" htmlFor="track-player-count">
            Number of players
          </SectionLabel>
          <NumberField
            id="track-player-count"
            min={1}
            max={GENERIC_PALETTE.length}
            value={roster.length}
            onChange={setCount}
          />
          <div className={styles.trackRoster}>
            {roster.map((row, i) => (
              <div key={i} className={styles.trackRow}>
                <ColourField
                  value={row.color}
                  onChange={(e) => updateRow(i, "color", e.target.value)}
                  aria-label={`Player ${i + 1} colour`}
                />
                <Field
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(i, "name", e.target.value)}
                  aria-label={`Player ${i + 1} name`}
                />
              </div>
            ))}
          </div>
          {turnOrderMode && (
            <fieldset className={styles.turnOrderField}>
              <SectionLabel as="legend">Turn order</SectionLabel>
              {TURN_ORDER_CHOICES.map((choice) => (
                <Toggle
                  key={choice.mode}
                  type="radio"
                  name="turn-order-mode"
                  value={choice.mode}
                  label={choice.label}
                  description={choice.hint}
                  checked={turnOrderMode.value === choice.mode}
                  onChange={() => turnOrderMode.onChange(choice.mode)}
                />
              ))}
            </fieldset>
          )}
        </div>
      )}
    </>
  );
}

const TURN_ORDER_CHOICES: Array<{
  mode: SelectableTurnOrderMode;
  label: string;
  hint: string;
}> = [
  {
    mode: "round-robin",
    label: "Fixed rotation",
    hint: "Players always go in seat order",
  },
  {
    mode: "variable",
    label: "Variable (reorder during play)",
    hint: "Drag players into a new order from the score panel at any time",
  },
];
