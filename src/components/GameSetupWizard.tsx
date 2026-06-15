/*
 * Multi-screen game-setup wizard. Replaces the single-panel modal.
 *
 * Screens come from two sources:
 *   1) Built-in: Game-picker, Expected-turns, ADSET confirmation,
 *      and a Track-players fallback for definitions without a
 *      seat-players step.
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
  ArrowUp,
  ArrowDown,
  Dices,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import styles from "./GameSetupWizard.module.css";
import { FullScreenToggle } from "./FullScreen";
import { NumberField } from "./NumberField";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
} from "@/state/definitionRegistry";
import {
  optionVisibleUnderContext,
  type GameDefinition,
  type SetupChoice,
  type SetupConstraint,
  type SetupContext,
  type SetupOption,
  type SetupStep,
} from "@/state/gameDefinition";
import type { Player, PlayerMetadataValue } from "@/state/gameSession";
import { fallbackColor } from "@/lib/playerVisual";

// ── Public contract ─────────────────────────────────────────────────

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
  definitionId: string;
  setupContext?: SetupContext;
  // When true, the timer page starts the clock immediately on
  // applyConfig instead of waiting for the user's first tap. Set
  // by the wizard when the last seat has just confirmed its
  // faction pick — the natural "start the game now" moment.
  autoStart?: boolean;
}

// Imperative handle exposed to parents (the timer page) so peer
// messages can route into the wizard without lifting all of its state.
// Currently a single method — adds more if more peer-driven steps land.
export interface GameSetupWizardHandle {
  applyPick: (stepId: string, seatIndex: number, optionId: string) => void;
  // Apply a peer-driven dealt-resolve pick — the seated companion
  // chose `optionId` from the remaining dealt items on the step.
  // Validates active-seat + not-already-confirmed under the hood.
  applyResolve: (stepId: string, seatIndex: number, optionId: string) => void;
  // Look up the kind of a setup step on the wizard's CURRENTLY
  // selected definition (which may differ from the timer page's
  // `definitionId`, since that's only set on submit). Used by the
  // host to route an incoming SETUP_PICK message to applyPick vs
  // applyResolve.
  getStepKind: (stepId: string) => string | undefined;
  // Apply a peer-driven seating change (claim/rename/add/remove)
  // to the wizard's setup-context. Bounds against the step's
  // min/max enforced inside; out-of-bounds requests are no-ops.
  // Returns whether the action mutated state — useful for the
  // host's claim map (only update if the seat actually exists).
  applySeatingChange: (
    stepId: string,
    action:
      | { kind: "add"; name: string }
      | { kind: "rename"; seatIndex: number; name: string }
      | { kind: "remove"; seatIndex: number }
      | { kind: "claim"; seatIndex: number },
  ) => boolean;
  // Whether a seating step exists in the current definition. The
  // host uses this to decide whether to apply a seating change
  // (during the wizard) or treat it as a no-op (e.g. Generic flow).
  hasSeatingStep: () => boolean;
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
  // Called whenever the seating list changes (initial mount + every
  // seat add/rename/remove/move, by host or peer). Includes stable
  // seat ids so the parent can rewrite its claim map when seats are
  // reordered. The wire-format SETUP_SEATING drops the ids before
  // broadcasting (companions key by index).
  onSeatingChange?: (info: {
    stepId: string;
    seats: Array<{ id: string; name: string }>;
    minPlayers: number;
    maxPlayers: number;
  }) => void;
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

const buildScreens = (definition: GameDefinition): WizardScreen[] => {
  const screens: WizardScreen[] = [{ kind: "game", id: "game", label: "Game" }];
  // Definitions with turnsPerPlayer derive expectedTurns from the
  // seat count at submit time — no need to ask. Generic and similar
  // definitions without that field still get the Expected-turns
  // screen.
  if (definition.turnsPerPlayer == null) {
    screens.push({
      kind: "expected-turns",
      id: "expected-turns",
      label: "Turns",
    });
  }
  const steps = definition.setupSteps ?? [];
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
  // Per ADSET: players perform their faction setup immediately on pick,
  // not retrospectively. No closing confirmation screen.
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
        ctx[step.id] = {
          kind: "seat-players",
          seats: Array.from({ length: count }, (_, i) => ({
            id: makeSeatId(),
            name: `Player ${i + 1}`,
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
    }
  }
  return ctx;
};

// Stable per-seat identifier. The host's claim map tracks a peer's
// claim against this id so it follows the seat if the host reorders
// seating. Falls back to a random-suffixed string when `crypto`
// isn't available (tests, older environments).
const makeSeatId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seat-${Math.random().toString(36).slice(2, 11)}`;
};

const shuffleAndTake = <T,>(items: T[], count: number): T[] => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
};

// Deal `count` ids at random, but never deal both members of a
// mutually-exclusive pair into the same hand (e.g. Vagabond + Knaves):
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

// Some faction-style options deal accompanying cards on pick (Root's
// Vagabond character, Knaves' captains). Which pool + how many is
// declared on the option itself (`characterDraw`), keeping faction ids
// out of core code. Pools live on the option as the named passthrough
// array (e.g. `characterPool` / `captainPool`).
const characterDrawOf = (
  option: SetupOption | undefined,
): { poolField: string; count: number; exclusiveGroup?: string } | undefined =>
  (
    option as unknown as {
      characterDraw?: {
        poolField: string;
        count: number;
        exclusiveGroup?: string;
      };
    }
  )?.characterDraw;

const labelForCharacter = (
  factionOption: SetupOption,
  characterId: string,
): string => {
  const draw = characterDrawOf(factionOption);
  if (!draw) return characterId;
  const pool = (
    factionOption as unknown as Record<
      string,
      Array<{ id: string; label?: string }> | undefined
    >
  )[draw.poolField];
  if (!Array.isArray(pool)) return characterId;
  return pool.find((c) => c.id === characterId)?.label ?? characterId;
};

const dealCharactersFor = (
  optionIds: string[],
  options: SetupOption[],
  context: SetupContext,
  // Characters already dealt this game (from the player-pick choice), so
  // an `exclusive` group (e.g. the two Vagabonds) never repeats a
  // character across separate picks.
  existing: Record<string, string[]> = {},
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  // Per exclusive-group set of already-used character ids — seeded from
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
    // expansions — same rule as faction/map options — so e.g. the
    // Vagabond Pack characters are only dealt when that module is on.
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

const GENERIC_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

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

  const screens = useMemo(() => buildScreens(definition), [definition]);
  const [screenIndex, setScreenIndex] = useState(0);
  // Reset wizard when definition changes.
  useEffect(() => {
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

  const currentScreen = screens[screenIndex];
  const isLast = screenIndex === screens.length - 1;
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
        // Deal any character that accompanies this faction (e.g. the
        // Vagabond's character card), exactly as a local pick does — so a
        // companion's turn-based pick still gets its character + meeple.
        const step = definition.setupSteps?.find((s) => s.id === stepId);
        const options =
          step?.kind.type === "player-pick" ? step.kind.options : [];
        const characterDeal = characterDrawOf(
          options.find((o) => o.id === optionId),
        )
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
  // and not-already-confirmed under the hood — out-of-order or
  // duplicate requests are no-ops.
  const applyResolve = useCallback(
    (stepId: string, seatIndex: number, optionId: string) => {
      setContext((prev) => {
        const current =
          prev[stepId]?.kind === "dealt-resolve"
            ? (prev[stepId] as Extract<SetupChoice, { kind: "dealt-resolve" }>)
            : { kind: "dealt-resolve" as const, confirmedIds: [] };
        // Only the seat whose turn it is (= confirmedIds.length)
        // may confirm; ignore everyone else.
        if (current.confirmedIds.length !== seatIndex) return prev;
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
    [],
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

  // Imperative seating change (driven by peer SEATING_REQUEST
  // messages). Lets companions claim/rename/add/remove seats from
  // the very start of setup — the wizard's seating list is the
  // source of truth, this just routes peer edits into it.
  const applySeatingChange = useCallback<
    GameSetupWizardHandle["applySeatingChange"]
  >(
    (stepId, action) => {
      let mutated = false;
      setContext((prev) => {
        const current =
          prev[stepId]?.kind === "seat-players"
            ? (prev[stepId] as Extract<SetupChoice, { kind: "seat-players" }>)
            : null;
        if (!current) return prev;
        let nextSeats = current.seats;
        switch (action.kind) {
          case "add":
            if (current.seats.length >= seatingBounds.max) break;
            nextSeats = [
              ...current.seats,
              {
                id: makeSeatId(),
                name:
                  action.name.trim() || `Player ${current.seats.length + 1}`,
              },
            ];
            mutated = true;
            break;
          case "rename":
            if (
              action.seatIndex < 0 ||
              action.seatIndex >= current.seats.length
            )
              break;
            // Allow empty names during typing — without this the
            // companion can't delete the last character (host
            // would revert to the previous name and bounce the
            // input back). validateScreen still requires every
            // seat to have a non-blank name at submit time.
            nextSeats = current.seats.map((s, i) =>
              i === action.seatIndex ? { ...s, name: action.name } : s,
            );
            mutated = true;
            break;
          case "remove":
            if (current.seats.length <= seatingBounds.min) break;
            if (
              action.seatIndex < 0 ||
              action.seatIndex >= current.seats.length
            )
              break;
            nextSeats = current.seats.filter((_, i) => i !== action.seatIndex);
            mutated = true;
            break;
          case "claim":
            // The wizard doesn't track claim ownership — the host
            // owns the claim map. We just verify the seat exists so
            // the host can mirror it in its own state.
            mutated =
              action.seatIndex >= 0 && action.seatIndex < current.seats.length;
            return prev;
        }
        if (!mutated) return prev;
        return { ...prev, [stepId]: { ...current, seats: nextSeats } };
      });
      return mutated;
    },
    [seatingBounds.min, seatingBounds.max],
  );

  const hasSeatingStep = useCallback(() => seatingStep != null, [seatingStep]);

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
      applySeatingChange,
      hasSeatingStep,
      getStepKind,
    }),
    [applyPick, applyResolve, applySeatingChange, hasSeatingStep, getStepKind],
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
    if (!seatingStep || !seatingChoice) return;
    peerHooks?.onSeatingChange?.({
      stepId: seatingStep.id,
      seats: seatingChoice.seats,
      minPlayers: seatingBounds.min,
      maxPlayers: seatingBounds.max,
    });
  }, [
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
    const players = collectPlayers(
      definition,
      context,
      trackPlayers,
      trackRoster,
    );
    // When the definition declares turnsPerPlayer, derive
    // expectedTurns at submit time from the seat count. Saves the
    // user from a redundant screen and keeps Root's "8 turns each"
    // rule applied automatically.
    const resolvedExpectedTurns =
      definition.turnsPerPlayer != null && players && players.length > 0
        ? definition.turnsPerPlayer * players.length
        : expectedTurns;
    onSubmit({
      expectedTurns: resolvedExpectedTurns,
      players,
      definitionId: definition.id,
      setupContext: definition.setupSteps?.length ? context : undefined,
      ...(autoStart ? { autoStart: true } : {}),
    });
  };

  // Defer auto-submit by one commit so the just-applied pick reaches
  // `context` before submit() reads it. Background: confirmPreview()
  // calls applyPick (which schedules setContext) and onAllConfirmed
  // synchronously in the same event handler — if we submitted there
  // and then, submit() would close over the stale pre-pick context
  // and emit a players[] missing the LAST seat's metadata. Flipping
  // a flag lets React commit setContext first, then the effect runs
  // with a fresh `context` in scope.
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);
  // submit() intentionally excluded from deps — it reads `context`
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
  // screens it slides out — see `.sidePanelHidden` for the
  // transition (gated by prefers-reduced-motion in CSS).
  const sidePanelVisible = sidePanel != null && screenIndex === 0;
  // Hero mode: the faction picker (and any future turn-based
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
              <h2 id="wizard-title" className={styles.title}>
                Game Setup
              </h2>
              <span className={styles.crumbs}>
                {screenIndex + 1} / {screens.length} · {currentScreen.label}
              </span>
              {/* In-modal FullScreen toggle — the dialog's backdrop
                blocks the one in the page chrome, so this mirrors
                it inside the modal layer. */}
              <FullScreenToggle className={styles.headerFullscreen} />
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
                  // Last seat just confirmed its pick — auto-advance
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
              />
            )}
            {screenError && <p className={styles.error}>{screenError}</p>}
          </section>

          <footer className={styles.actions}>
            <div className={styles.actionsLeft}>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className={styles.secondary}
                >
                  <X size={16} aria-hidden /> Cancel
                </button>
              )}
            </div>
            <div className={styles.actionsRight}>
              <button
                type="button"
                onClick={back}
                disabled={isFirst}
                className={styles.secondary}
              >
                <ArrowLeft size={16} aria-hidden /> Back
              </button>
              <button
                type="submit"
                className={styles.primary}
                disabled={screenError != null}
              >
                {isLast ? (
                  <>
                    <Play size={16} aria-hidden /> Start Game
                  </>
                ) : (
                  <>
                    Next <ArrowRight size={16} aria-hidden />
                  </>
                )}
              </button>
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
    // needs a faction." message. Dropped — the picker auto-submits
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
    // Characters dealt alongside a faction (Vagabond's character card),
    // keyed by faction option id. Used to pick a per-character meeple.
    const characters =
      pickChoice?.kind === "player-pick" ? (pickChoice.characters ?? {}) : {};
    const pickOptions =
      pickStep && pickStep.kind.type === "player-pick"
        ? pickStep.kind.options
        : [];
    return seatChoice.seats.map((seat, i) => {
      const factionId = picks[i];
      const option = factionId
        ? pickOptions.find((o) => o.id === factionId)
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
        // Default to the faction meeple, but if a character card was
        // dealt with this faction (Vagabond), use that character's own
        // meeple for the body silhouette. The HEAD stays the faction's
        // own head art (the generic Vagabond crest) — the per-character
        // meeple isn't a head crop, so using it in the head slot reads
        // wrong; the character still comes through via the body meeple.
        let meeple = assets?.meepleSvg?.appPath;
        const head = assets?.headIcon?.[0]?.appPath;
        const draw = characterDrawOf(option);
        const drawnCharId = draw && characters[option.id]?.[0];
        if (draw && drawnCharId) {
          const pool = (
            option as unknown as Record<
              string,
              Array<{ id: string; meeple?: { appPath?: string } }> | undefined
            >
          )[draw.poolField];
          const charMeeple = pool?.find((c) => c.id === drawnCharId)?.meeple
            ?.appPath;
          if (charMeeple) meeple = charMeeple;
        }
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
      <h3 className={styles.screenTitle} id="screen-title">
        <Dices size={18} aria-hidden /> Pick a game
      </h3>
      <select
        className={styles.input}
        aria-label="Game"
        value={definitionId}
        onChange={(e) => onChange(e.target.value)}
      >
        {definitions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
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
      <h3 className={styles.screenTitle} id="screen-title">
        How long is this game?
      </h3>
      <p className={styles.screenSubtitle}>
        Used to predict when the game will finish and to set the first
        countdown.
      </p>
      <label htmlFor="expected-turns" className={styles.label}>
        Expected turns
      </label>
      <NumberField
        id="expected-turns"
        min={1}
        value={value}
        onChange={onChange}
        className={styles.input}
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
  // Sibling steps — used by `dealt-resolve` to look up option
  // labels on its upstream `sourceStepId`.
  steps: SetupStep[];
  context: SetupContext;
  setContext: (updater: (prev: SetupContext) => SetupContext) => void;
  peerHooks?: WizardPeerHooks;
  // Forwarded to PlayerPickScreen — fires when the last seat
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
    case "info":
      return <InfoScreen step={step} />;
  }
}

// Pure-text instructional screen — renders the step's label as the
// heading and the description as body. No input, no context entry,
// no validation. The wizard's Next button is the only action. Used
// for table-side reminders that have to live in the flow but don't
// need any decision (e.g. Root's A.7 "draw 5 cards" reminder).
function InfoScreen({ step }: { step: SetupStep }) {
  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
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
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.toggleList}>
        {options.map((o) => {
          const checked = selectedIds.includes(o.id);
          return (
            <label
              key={o.id}
              className={`${styles.toggleRow} ${
                checked ? styles.toggleRowChecked : ""
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.id)}
                aria-label={o.label}
              />
              <span className={styles.toggleRowLabel}>{o.label}</span>
            </label>
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
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.chipGrid}>
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`${styles.chip} ${
              o.id === selectedId ? styles.chipActive : ""
            }`}
            onClick={() => onChange(o.id)}
            aria-pressed={o.id === selectedId}
            aria-label={o.label}
          >
            <span className={styles.chipLabel}>{o.label}</span>
            {o.module && <span className={styles.chipModule}>{o.module}</span>}
            {o.description && (
              <span className={styles.chipDesc}>{o.description}</span>
            )}
          </button>
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
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.stepper}>
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={atMin}
          className={styles.stepperBtn}
          aria-label={`Decrease ${step.label.toLowerCase()}`}
        >
          <Minus size={16} aria-hidden />
        </button>
        <span
          className={styles.stepperValue}
          aria-live="polite"
          aria-label={`${step.label}: ${value}`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={atMax}
          className={styles.stepperBtn}
          aria-label={`Increase ${step.label.toLowerCase()}`}
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>
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
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={styles.toggleRowLabel}>
          {value ? "Enabled" : "Disabled"}
        </span>
      </label>
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
  const update = (seats: Array<{ id: string; name: string }>) =>
    onChange({ kind: "seat-players", seats });

  const setName = (i: number, name: string) =>
    update(seats.map((s, j) => (i === j ? { ...s, name } : s)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= seats.length) return;
    const next = [...seats];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const remove = (i: number) => {
    if (seats.length <= min) return;
    update(seats.filter((_, j) => j !== i));
  };

  const add = () => {
    if (seats.length >= max) return;
    update([
      ...seats,
      { id: makeSeatId(), name: `Player ${seats.length + 1}` },
    ]);
  };

  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        <Users size={18} aria-hidden /> {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.seatList}>
        {seats.map((seat, i) => (
          <div key={i} className={styles.seatRow}>
            <span className={styles.seatIndex} aria-hidden>
              {i + 1}
            </span>
            <input
              type="text"
              value={seat.name}
              onChange={(e) => setName(i, e.target.value)}
              aria-label={`Seat ${i + 1} name`}
              className={styles.seatName}
            />
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className={styles.seatNudge}
              aria-label={`Move seat ${i + 1} up`}
            >
              <ArrowUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === seats.length - 1}
              className={styles.seatNudge}
              aria-label={`Move seat ${i + 1} down`}
            >
              <ArrowDown size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={seats.length <= min}
              className={styles.seatRemove}
              aria-label={`Remove seat ${i + 1}`}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        disabled={seats.length >= max}
        className={styles.seatAdd}
      >
        <Plus size={14} aria-hidden /> Add seat
      </button>
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
  // in the context as the source — Root has one, generic games have
  // none (in which case demoteCount = 0).
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seatCount = seatChoice?.seats.length ?? 0;
  // Demotion is opt-in per step via the definition's `demote` rule; steps
  // without one (e.g. landmarks) never demote.
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
  // (0..maxCount, e.g. Root landmarks). Otherwise it's a fixed `count`.
  const maxCount =
    step.kind.type === "deal-random" ? step.kind.maxCount : undefined;
  const selectedCount = isSkipped ? 0 : (dealtIds?.length ?? 0);
  const reshuffle = () => dealN(selectedCount > 0 ? selectedCount : count);

  const cards = dealtIds
    ? dealtIds.map((id) => visible.find((o) => o.id === id)).filter(Boolean)
    : [];

  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <div className={styles.deck}>
        {isSkipped && (
          <div className={styles.skipNotice}>
            Skipped — no {step.label.toLowerCase()} this game.
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
                    {isDemoted && (
                      <span className={styles.dealtDemotedTag}>demoted</span>
                    )}
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
              <button
                key={n}
                type="button"
                onClick={() => dealN(n)}
                aria-pressed={selectedCount === n}
                className={
                  selectedCount === n ? styles.secondary : styles.ghost
                }
              >
                {n === 0 ? "None" : n}
              </button>
            ))}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={reshuffle}
                className={styles.ghost}
              >
                <RefreshCw size={14} aria-hidden /> Shuffle again
              </button>
            )}
          </div>
        ) : (
          <div className={styles.actionsLeft}>
            <button
              type="button"
              onClick={reshuffle}
              className={styles.secondary}
            >
              <RefreshCw size={14} aria-hidden /> Shuffle
              {dealtIds ? " again" : ""}
            </button>
            {optional && (
              <button type="button" onClick={skip} className={styles.ghost}>
                Skip
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// Draft mode is the default for the player-pick screen — players
// receive a dealt hand of n+1 cards. The picker offers a local
// toggle to fall back to "show every legal option" when needed.
// The setup-context-driven toggle convention is gone; this is now
// purely picker-local state.

// Find the dealt hireling ids (if any). Walks every deal-random in
// the context — pragmatic for now; if a definition has more than one
// deal-random step the picker would treat both as sources of exclusion.
const findDealtHirelingIds = (context: SetupContext): string[] => {
  const ids: string[] = [];
  for (const choice of Object.values(context)) {
    if (choice.kind === "deal-random" && choice.skipped === false) {
      ids.push(...choice.dealtIds);
    }
  }
  return ids;
};

function PlayerPickScreen({
  step,
  options,
  constraints,
  mode,
  context,
  peerHooks,
  onChange,
  onAllConfirmed,
}: {
  step: SetupStep;
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
  // the clock — see GameConfig.autoStart).
  onAllConfirmed?: () => void;
}) {
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seats = seatChoice?.seats ?? [];
  const choice = context[step.id];
  const playerPick: Extract<SetupChoice, { kind: "player-pick" }> =
    choice?.kind === "player-pick"
      ? choice
      : { kind: "player-pick", picks: {} };
  const picks = playerPick.picks;
  const dealtIds = playerPick.dealtIds;
  const characters = playerPick.characters ?? {};

  // Draft is on by default; the picker exposes a local toggle to
  // fall back to the full pool when the table wants free choice.
  const [draftEnabled, setDraftEnabled] = useState(true);
  // Two-step pick: clicking a card opens a full-screen preview
  // (showing the ADSET steps) instead of immediately committing.
  // A Confirm button accepts the pick; Back returns to the draft.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const dealtHirelings = findDealtHirelingIds(context);

  // Faction ids excluded by any dealt hireling (via faction.matchingHireling).
  const hirelingExcludedIds = useMemo(() => {
    if (dealtHirelings.length === 0) return new Set<string>();
    const excluded = new Set<string>();
    for (const o of options) {
      const mh = (o as { matchingHireling?: string }).matchingHireling;
      if (mh && dealtHirelings.includes(mh)) excluded.add(o.id);
    }
    return excluded;
  }, [options, dealtHirelings]);

  // The legal pool — module-visible AND not hireling-excluded. This
  // is what the draft draws from, and what's shown when draft is off.
  const pool = useMemo(
    () =>
      visibleOptions(options, context).filter(
        (o) => !hirelingExcludedIds.has(o.id),
      ),
    [options, context, hirelingExcludedIds],
  );

  const targetDealCount = seats.length + 1;

  // Lazy deal when draft turns on and we don't yet have a hand.
  // useLayoutEffect (not useEffect) so the deal commits in the same
  // browser task as the picker's first paint — without this, the
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
  ]);

  // Note: previous version dropped dealtIds when draft toggled off,
  // so re-enabling re-dealt a fresh hand and lost the player's
  // remaining picks. The dealt list now persists across draft
  // toggles — `visible` (above) renders the full pool when draft
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
    setActiveSeat(Math.max(0, seats.length - 1));
  };

  // Per ADSET A.8.3: picking goes counterclockwise starting from the
  // LAST seated player. So the picker starts at the last seat and
  // counts down; the last to pick (seat 0) is implicitly the first to
  // play, matching the timer's existing turn order.
  const [activeSeat, setActiveSeat] = useState(() =>
    Math.max(0, seats.length - 1),
  );
  // If the picker mounts before the seat-players context has
  // propagated, useState's initializer lands at 0. Once seats
  // populate, snap once to the last seat per ADSET A.8.3.
  const seatsInitialisedRef = useRef(false);
  useEffect(() => {
    if (seats.length === 0) return;
    if (!seatsInitialisedRef.current) {
      seatsInitialisedRef.current = true;
      setActiveSeat(seats.length - 1);
      return;
    }
    // Pin activeSeat in range when the seat count shrinks.
    if (activeSeat >= seats.length) {
      setActiveSeat(Math.max(0, seats.length - 1));
    }
  }, [seats.length, activeSeat]);

  const [adsetOpen, setAdsetOpen] = useState<string | null>(null);

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
  // in an effect below — keeping pick() pure on the choice.
  //
  // For options that have a character/captain pool (Vagabond /
  // Knaves), we also deal characters here so the picker can render
  // them even outside of draft mode (draft-mode dealing happens up
  // front via the deal effect).
  // Confirming the preview commits the pick AND, if this is the
  // last seat to fill, fires the all-confirmed callback so the
  // wizard can auto-advance and start the timer.
  const confirmPreview = (optionId: string) => {
    pick(optionId);
    setPreviewCardId(null);
    // Was this the LAST remaining seat to pick? Count present picks
    // (excluding the one we're about to write) — if N-1 are already
    // filled and we just covered the Nth, fire onAllConfirmed.
    const filledAfter =
      Object.keys(picks).filter((k) => k !== String(activeSeat)).length + 1;
    if (filledAfter >= seats.length) onAllConfirmed?.();
  };

  const pick = (optionId: string) => {
    const seatIdx = activeSeat;
    // Defensive: refuse to pick a faction that another seat already
    // claims. The card UI marks claimed cards as `blocked`, but the
    // last-seat case has surfaced edge bugs (e.g. draft animation
    // race) — this short-circuits any stale path.
    const takenBy = Object.entries(picks).find(
      ([s, id]) => Number(s) !== seatIdx && id === optionId,
    );
    if (takenBy) return;
    const characterDeal = characterDrawOf(
      options.find((o) => o.id === optionId),
    )
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

  // After a seat is filled, jump to the next unfilled seat counting
  // BACKWARDS (counterclockwise per ADSET A.8.3). If none unfilled
  // remain going down, fall back to the first unfilled going up so
  // the wizard can recover when the user re-edits an earlier pick.
  useEffect(() => {
    if (picks[activeSeat] == null) return;
    let nextDown = -1;
    for (let i = activeSeat - 1; i >= 0; i--) {
      if (picks[i] == null) {
        nextDown = i;
        break;
      }
    }
    const next =
      nextDown !== -1 ? nextDown : seats.findIndex((_, i) => picks[i] == null);
    if (next !== -1 && next !== activeSeat) setActiveSeat(next);
  }, [picks, activeSeat, seats]);

  // Emit onTurnStart per active seat when in turn-based mode. The
  // parent broadcasts SETUP_TURN; companions seated at that index
  // render their picker overlay. Re-fires when the visible pool
  // shrinks (e.g. after a draft re-shuffle) so the seated companion
  // sees the latest legal list.
  const findDefinition = (): GameDefinition | undefined => {
    // The picker has access to the merged option list but not the
    // top-level definition. Reconstruct a minimal definition so the
    // companion can render the picker — for now we ship the step's
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
    peerHooks.onTurnStart({
      stepId: step.id,
      seatIndex: activeSeat,
      seatName: seats[activeSeat]?.name ?? `Seat ${activeSeat + 1}`,
      optionIds: visible.map((o) => o.id),
      excludedOptionIds: Array.from(blockedForActive),
      definition:
        findDefinition() ??
        // Synthetic minimal definition for the companion picker —
        // a single-step shell with this step's resolved options.
        ({
          schemaVersion: 1,
          id: "__wizard-snapshot",
          name: "Setup",
          defaultExpectedTurns: 0,
          defaultAverageSeconds: 0,
          setupSteps: [step],
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
  ]);

  // All hooks above run unconditionally (the two effects no-op when
  // there are no seats); this early return must stay below them.
  if (seats.length === 0) {
    return (
      <>
        <h3 className={styles.screenTitle} id="screen-title">
          {step.label}
        </h3>
        <p className={styles.help}>
          No seated players yet. Go back to the seating step first.
        </p>
      </>
    );
  }

  // Hero mode: dominate the viewport with a card row. Triggered
  // for turn-based player-pick steps (Root). Other modes (host-only)
  // keep the compact panel further below.
  if (mode === "turn-based") {
    const seatName = seats[activeSeat]?.name ?? `Seat ${activeSeat + 1}`;
    // Full-screen preview takes over when the active seat has
    // clicked a card. Shows the chosen option's full setup steps
    // and gates the pick behind an explicit Confirm.
    if (previewCardId != null) {
      const previewOption = options.find((o) => o.id === previewCardId) ?? null;
      const previewAdset = previewOption
        ? (previewOption as unknown as { adsetSteps?: string[] }).adsetSteps
        : undefined;
      const previewMeeple = previewOption
        ? (
            previewOption as unknown as {
              assets?: { meepleSvg?: { appPath?: string } };
            }
          ).assets?.meepleSvg?.appPath
        : undefined;
      const previewColor = previewOption?.color ?? "var(--color-border)";
      const previewLabel = previewOption?.label ?? previewCardId;
      return (
        <div className={styles.heroPreview}>
          <h3 className={styles.heroPickerSrOnly} id="screen-title">
            {step.label}
          </h3>
          <div className={styles.heroPreviewInstruction}>
            <span className={styles.heroPickerInstructionSubtle}>
              {seatName} — confirm your pick
            </span>
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
            {previewMeeple && (
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
            )}
            {previewAdset && previewAdset.length > 0 && (
              <ol className={styles.heroPreviewSteps}>
                {previewAdset.map((s, i) => (
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
                  {characters[previewOption.id].length === 1
                    ? "character"
                    : "captains"}
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
            <button
              type="button"
              onClick={() => setPreviewCardId(null)}
              className={styles.secondary}
            >
              <ArrowLeft size={16} aria-hidden /> Back
            </button>
            <button
              type="button"
              onClick={() => confirmPreview(previewCardId)}
              className={styles.primary}
            >
              Confirm setup
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.heroPicker}>
        {/* Visually-hidden heading keeps screen reader + Playwright
            navigation working alongside the visible instruction. */}
        <h3 className={styles.heroPickerSrOnly} id="screen-title">
          {step.label}
        </h3>
        <div className={styles.heroPickerInstruction}>
          <span className={styles.heroPickerInstructionSubtle}>
            {seats.filter((_, i) => picks[i] != null).length}/{seats.length}{" "}
            picked · seat {activeSeat + 1} of {seats.length}
          </span>
          <span>
            {seatName} — choose your {step.label.toLowerCase()}
          </span>
        </div>

        <div className={styles.heroCardRow}>
          {visible.map((o) => {
            const blocked = blockedForActive.has(o.id);
            const active = picks[activeSeat] === o.id;
            const leaving = leavingIds.includes(o.id);
            const adsetSteps = (o as unknown as { adsetSteps?: string[] })
              .adsetSteps;
            const meepleSrc = (
              o as unknown as {
                assets?: { meepleSvg?: { appPath?: string } };
              }
            ).assets?.meepleSvg?.appPath;
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
                      <span
                        className={styles.heroCardMilitary}
                        data-variant={military}
                      >
                        {military}
                      </span>
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
                    Dealt{" "}
                    {characters[o.id].length === 1 ? "character" : "captains"}
                    <ul className={styles.heroCardCharactersList}>
                      {characters[o.id].map((charId) => (
                        <li key={charId}>{labelForCharacter(o, charId)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {meepleSrc && (
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
                )}
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
              const factionId = picks[i];
              const option = factionId
                ? (visible.find((o) => o.id === factionId) ??
                  options.find((o) => o.id === factionId))
                : undefined;
              const label = option
                ? `${seat.name} — ${option.label}`
                : `${seat.name} — not yet`;
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
              <button
                type="button"
                onClick={reshuffle}
                className={styles.secondary}
              >
                <RefreshCw size={14} aria-hidden /> Shuffle
              </button>
              <button
                type="button"
                onClick={() => setDraftEnabled(false)}
                className={styles.ghost}
              >
                Skip draft
              </button>
            </>
          )}
          {!draftEnabled && (
            <button
              type="button"
              onClick={() => setDraftEnabled(true)}
              className={styles.secondary}
            >
              <RefreshCw size={14} aria-hidden /> Back to draft
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}

      <div className={styles.activePickerHeader}>
        <span className={styles.pickerSeatIndex}>{activeSeat + 1}</span>
        <span className={styles.pickerSeatName}>
          {seats[activeSeat]?.name} — choose a {step.label.toLowerCase()}
        </span>
      </div>

      {draftEnabled && (
        <div className={styles.draftBar}>
          <span className={styles.help}>
            Drafting {targetDealCount} cards from {pool.length} legal options
            {dealtHirelings.length > 0
              ? ` (${hirelingExcludedIds.size} excluded by dealt hirelings)`
              : ""}
            .
          </span>
          <div className={styles.draftBarButtons}>
            <button
              type="button"
              onClick={reshuffle}
              className={styles.secondary}
            >
              <RefreshCw size={14} aria-hidden /> Shuffle again
            </button>
            <button
              type="button"
              onClick={() => setDraftEnabled(false)}
              className={styles.ghost}
            >
              Skip draft
            </button>
          </div>
        </div>
      )}
      {!draftEnabled && (
        <div className={styles.draftBar}>
          <span className={styles.help}>
            Free pick — every legal option visible.
          </span>
          <button
            type="button"
            onClick={() => setDraftEnabled(true)}
            className={styles.secondary}
          >
            <RefreshCw size={14} aria-hidden /> Back to draft
          </button>
        </div>
      )}

      <div className={styles.pickDraftRow}>
        {visible.map((o) => {
          const blocked = blockedForActive.has(o.id);
          const active = picks[activeSeat] === o.id;
          const open = adsetOpen === o.id;
          const leaving = leavingIds.includes(o.id);
          const adsetSteps = (o as unknown as { adsetSteps?: string[] })
            .adsetSteps;
          const meepleSrc = (
            o as unknown as {
              assets?: { meepleSvg?: { appPath?: string } };
            }
          ).assets?.meepleSvg?.appPath;
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
              // just the faction label, not the computed text of all
              // its children (which would include the nested toggle).
              aria-label={o.label}
              tabIndex={blocked || leaving ? -1 : 0}
              className={`${styles.pickCard} ${
                active ? styles.pickCardActive : ""
              } ${blocked ? styles.pickCardDisabled : ""} ${
                leaving ? styles.pickCardLeaving : ""
              }`}
              style={{
                // Faint faction-coloured wash on the card so each one
                // reads as belonging to its faction even at a glance.
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
                  <span className={styles.characterDealHeader}>
                    Dealt{" "}
                    {characters[o.id].length === 1 ? "character" : "captains"}
                  </span>
                  <ul className={styles.characterList}>
                    {characters[o.id].map((charId) => (
                      <li key={charId} className={styles.characterChip}>
                        {labelForCharacter(o, charId)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {adsetSteps && adsetSteps.length > 0 && (
                <>
                  <button
                    type="button"
                    className={styles.pickStepsToggle}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdsetOpen(open ? null : o.id);
                    }}
                    aria-label={`${open ? "Hide" : "Show"} setup for ${o.label}`}
                  >
                    {open ? "Hide setup" : "Show setup"}
                  </button>
                  {open && (
                    <ol className={styles.pickStepsList}>
                      {adsetSteps.map((s, i) => (
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
                    // meeple takes the faction colour. Browsers without
                    // mask-image support fall back to the native black
                    // SVG over the card wash — still readable.
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
          const factionId = picks[i];
          const option = factionId
            ? (visible.find((o) => o.id === factionId) ??
              options.find((o) => o.id === factionId))
            : undefined;
          const isActive = i === activeSeat;
          return (
            <button
              type="button"
              key={i}
              className={`${styles.pickerSummaryRow} ${
                isActive ? styles.pickerSummaryActive : ""
              }`}
              onClick={() => setActiveSeat(i)}
              style={{ all: "unset", cursor: "pointer", padding: "4px 0" }}
            >
              <span
                className={styles.pickSwatch}
                style={{ background: option?.color ?? "var(--color-border)" }}
                aria-hidden
              />
              <span>
                <strong>{seat.name}</strong>
                {" — "}
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

// Per ADSET A.7.3: each seated player takes turns setting up one
// hireling at a time, starting with the alphabetically earliest.
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
  // Same hooks as PlayerPickScreen — when the active seat changes
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

  // Player order: seats in their declared order. Each player picks
  // ONE dealt item in turn; subsequent players choose from what's
  // left. `activeSeatIndex` is the player whose turn it is —
  // equals the count already confirmed. When it reaches either
  // `seats.length` or `dealtIds.length`, the step is complete.
  const activeSeatIndex = confirmedIds.length;
  const activePlayer = seats[activeSeatIndex];
  const remainingIds = dealtIds.filter((id) => !confirmedIds.includes(id));
  const allDone = remainingIds.length === 0 || activeSeatIndex >= seats.length;

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
              options: visibleOptions,
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
        <h3 className={styles.screenTitle} id="screen-title">
          {step.label}
        </h3>
        <p className={styles.help}>
          No hirelings dealt this game — continue to the next screen.
        </p>
      </>
    );
  }

  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      {/* Per-player progress tiles. One per dealt item, in player
          order. Tile shows whether that seat has picked yet, plus a
          hover/aria title noting what they chose. */}
      <ol className={styles.resolveProgress} aria-label="Pick order">
        {dealtIds.map((_, i) => {
          if (i >= seats.length) return null;
          const seat = seats[i];
          const pickedId = confirmedIds[i];
          const pickedOption = pickedId
            ? (sourceOptions.find((o) => o.id === pickedId) ?? {
                id: pickedId,
                label: pickedId,
              })
            : null;
          const isActive = i === activeSeatIndex && !allDone;
          const tip = pickedOption
            ? `${seat.name} — picked ${pickedOption.label}`
            : isActive
              ? `${seat.name} — choosing now`
              : `${seat.name} — waiting`;
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
              {" — choose a hireling to set up"}
            </span>
          </div>
          <div className={styles.resolveChoiceList}>
            {remainingIds.map((id) => {
              const option = sourceOptions.find((o) => o.id === id) ?? {
                id,
                label: id,
              };
              const adsetSteps = (
                option as unknown as { adsetSteps?: string[] }
              ).adsetSteps;
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
                  <span className={styles.resolveChoiceLabel}>
                    {option.label}
                  </span>
                  {adsetSteps && adsetSteps.length > 0 && (
                    <ol className={styles.resolveChoiceSteps}>
                      {adsetSteps.map((s, i) => (
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
        <p className={styles.help}>
          All hirelings resolved. Continue to the next screen.
        </p>
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
  for (const [i, factionId] of Object.entries(picks)) {
    if (Number(i) === seatIndex || !factionId) continue;
    blocked.add(factionId);
    for (const [a, b] of mutex) {
      if (factionId === a) blocked.add(b);
      if (factionId === b) blocked.add(a);
    }
  }
  return blocked;
}

function TrackPlayersScreen({
  enabled,
  onEnabledChange,
  roster,
  onRosterChange,
}: {
  enabled: boolean;
  onEnabledChange: (b: boolean) => void;
  roster: TrackPlayersRow[];
  onRosterChange: (next: TrackPlayersRow[]) => void;
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
      <h3 className={styles.screenTitle} id="screen-title">
        <Users size={18} aria-hidden /> Players (optional)
      </h3>
      <p className={styles.screenSubtitle}>
        Tracking lets the timer show whose turn it is and break time by player.
      </p>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span className={styles.toggleRowLabel}>Track individual players</span>
      </label>
      {enabled && (
        <div className={styles.trackBlock}>
          <label htmlFor="track-player-count" className={styles.label}>
            Number of players
          </label>
          <NumberField
            id="track-player-count"
            min={1}
            max={GENERIC_PALETTE.length}
            value={roster.length}
            onChange={setCount}
            className={styles.input}
          />
          <div className={styles.trackRoster}>
            {roster.map((row, i) => (
              <div key={i} className={styles.trackRow}>
                <input
                  type="color"
                  value={row.color}
                  onChange={(e) => updateRow(i, "color", e.target.value)}
                  className={styles.trackColor}
                  aria-label={`Player ${i + 1} colour`}
                />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(i, "name", e.target.value)}
                  className={styles.input}
                  aria-label={`Player ${i + 1} name`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
