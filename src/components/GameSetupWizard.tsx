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
  useMemo,
  useReducer,
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
}

// Imperative handle exposed to parents (the timer page) so peer
// messages can route into the wizard without lifting all of its state.
// Currently a single method — adds more if more peer-driven steps land.
export interface GameSetupWizardHandle {
  applyPick: (stepId: string, seatIndex: number, optionId: string) => void;
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

// Per-faction character draw (ADSET A.8.2): if Vagabond is dealt, deal
// 1 character; if Knaves is dealt, deal 4 captains. Pools live on the
// faction option as `characterPool` / `captainPool` (passthrough).
interface CharacterDraw {
  poolField: "characterPool" | "captainPool";
  count: number;
}
const CHARACTER_DRAWS: Record<string, CharacterDraw> = {
  vagabond: { poolField: "characterPool", count: 1 },
  knaves: { poolField: "captainPool", count: 4 },
};

const labelForCharacter = (
  factionOption: SetupOption,
  characterId: string,
): string => {
  const draw = CHARACTER_DRAWS[factionOption.id];
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
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const id of optionIds) {
    const draw = CHARACTER_DRAWS[id];
    if (!draw) continue;
    const option = options.find((o) => o.id === id);
    if (!option) continue;
    const pool = (
      option as unknown as Record<string, Array<{ id: string }> | undefined>
    )[draw.poolField];
    if (!Array.isArray(pool) || pool.length === 0) continue;
    out[id] = shuffleAndTake(
      pool.map((c) => c.id),
      draw.count,
    );
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
        return {
          ...prev,
          [stepId]: {
            ...current,
            picks: { ...current.picks, [seatIndex]: optionId },
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
    if (!seatingStep || seatingStep.kind.type !== "seat-players") {
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
            nextSeats = current.seats.map((s, i) =>
              i === action.seatIndex
                ? { ...s, name: action.name.trim() || s.name }
                : s,
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

  useImperativeHandle(
    ref,
    () => ({ applyPick, applySeatingChange, hasSeatingStep }),
    [applyPick, applySeatingChange, hasSeatingStep],
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

  const submit = () => {
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
    });
  };

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
    if (step.kind.type === "player-pick") {
      const choice = context[step.id];
      if (choice?.kind !== "player-pick") return null;
      // Look up the seat count to check completeness.
      const seatChoice = Object.values(context).find(
        (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
          c.kind === "seat-players",
      );
      const seatCount = seatChoice?.seats.length;
      if (seatCount != null) {
        const filled = Object.keys(choice.picks).length;
        if (filled < seatCount)
          return `Each of ${seatCount} player${seatCount === 1 ? "" : "s"} needs a faction.`;
      }
    }
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
        const meeple = (
          option as unknown as {
            assets?: { meepleSvg?: { appPath?: string } };
          }
        ).assets?.meepleSvg?.appPath;
        metadata[visualKey] = {
          type: "selected-option",
          optionId: option.id,
          label: option.label,
          color: option.color ?? fallbackColor(i),
          description: option.description,
          ...(meeple ? { iconSrc: meeple } : {}),
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
}: {
  step: SetupStep;
  // Sibling steps — used by `dealt-resolve` to look up option
  // labels on its upstream `sourceStepId`.
  steps: SetupStep[];
  context: SetupContext;
  setContext: (updater: (prev: SetupContext) => SetupContext) => void;
  peerHooks?: WizardPeerHooks;
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
  }
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

// ADSET A.6.2: how many of the dealt hirelings start demoted given
// the player count. 1-2 players: 0; 3: 1; 4: 2; 5+: 3.
const demoteCountForSeats = (seats: number): number => {
  if (seats <= 2) return 0;
  if (seats === 3) return 1;
  if (seats === 4) return 2;
  return 3;
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
  const demoteN = demoteCountForSeats(seatCount);

  const reshuffle = () => {
    const newDealt = shuffleAndTake(
      visible.map((o) => o.id),
      count,
    );
    const newDemoted = shuffleAndTake(newDealt, demoteN);
    onChange({
      kind: "deal-random",
      skipped: false,
      dealtIds: newDealt,
      demotedIds: newDemoted,
    });
  };

  const skip = () => onChange({ kind: "deal-random", skipped: true });

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
            Skipped — no hirelings this game.
          </div>
        )}
        {!isSkipped && dealtIds && (
          <>
            {demoteN > 0 && (
              <span className={styles.help}>
                Per ADSET A.6.2: {demoteN} of {count} start demoted at{" "}
                {seatCount} players.
              </span>
            )}
            <div className={styles.dealtList}>
              {(cards as SetupOption[]).map((o) => {
                const isDemoted = demotedIds.includes(o.id);
                const demoLabel = (
                  o as unknown as { demotedLabel?: string | null }
                ).demotedLabel;
                return (
                  <div
                    key={o.id}
                    className={`${styles.dealtCard} ${
                      isDemoted ? styles.dealtCardDemoted : ""
                    }`}
                  >
                    <span className={styles.dealtLabel}>
                      {isDemoted && demoLabel ? demoLabel : o.label}
                    </span>
                    {isDemoted && (
                      <span className={styles.dealtDemotedTag}>
                        demoted{demoLabel == null ? " (?)" : ""}
                      </span>
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
  useEffect(() => {
    if (!draftEnabled) return;
    if (dealtIds != null) return;
    if (pool.length === 0 || seats.length === 0) return;
    const newDealt = shuffleAndTake(
      pool.map((o) => o.id),
      targetDealCount,
    );
    const newCharacters = dealCharactersFor(newDealt, options);
    onChange((curr) => ({
      ...curr,
      dealtIds: newDealt,
      characters: newCharacters,
    }));
  }, [
    draftEnabled,
    dealtIds,
    pool,
    seats.length,
    targetDealCount,
    options,
    onChange,
  ]);

  // If draft toggled off, drop the dealt hand so re-enabling redeals
  // fresh against the current pool.
  useEffect(() => {
    if (draftEnabled) return;
    if (dealtIds == null) return;
    onChange((curr) => {
      const { dealtIds: _d, characters: _c, ...rest } = curr;
      return rest;
    });
  }, [draftEnabled, dealtIds, onChange]);

  const reshuffle = () => {
    const newDealt = shuffleAndTake(
      pool.map((o) => o.id),
      targetDealCount,
    );
    const newCharacters = dealCharactersFor(newDealt, options);
    onChange((curr) => ({
      ...curr,
      picks: {},
      dealtIds: newDealt,
      characters: newCharacters,
    }));
    setActiveSeat(0);
  };

  // Per ADSET A.8.3: picking goes counterclockwise starting from the
  // LAST seated player. So the picker starts at the last seat and
  // counts down; the last to pick (seat 0) is implicitly the first to
  // play, matching the timer's existing turn order.
  const [activeSeat, setActiveSeat] = useState(() =>
    Math.max(0, seats.length - 1),
  );
  // When seats change (count grows/shrinks), pin activeSeat to the
  // first still-unfilled seat going backwards from the end. Avoids
  // landing on an out-of-range index.
  useEffect(() => {
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

  const blockedForActive = blockedFor(activeSeat, picks, constraints);

  // pick() writes via the updater so it composes correctly even when
  // multiple clicks land before React re-renders. Auto-advance happens
  // in an effect below — keeping pick() pure on the choice.
  //
  // For options that have a character/captain pool (Vagabond /
  // Knaves), we also deal characters here so the picker can render
  // them even outside of draft mode (draft-mode dealing happens up
  // front via the deal effect).
  const pick = (optionId: string) => {
    const seatIdx = activeSeat;
    const characterDeal = CHARACTER_DRAWS[optionId]
      ? dealCharactersFor([optionId], options)
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

  // Hero mode: dominate the viewport with a card row. Triggered
  // for turn-based player-pick steps (Root). Other modes (host-only)
  // keep the compact panel further below.
  if (mode === "turn-based") {
    const seatName =
      seats[activeSeat]?.name ?? `Seat ${activeSeat + 1}`;
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
              pick(o.id);
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
                <span className={styles.heroCardLabel}>{o.label}</span>
                {adsetSteps && adsetSteps.length > 0 && (
                  <ol className={styles.heroCardAdset}>
                    {adsetSteps.map((s, i) => (
                      <li key={i}>
                        <span className={styles.heroCardAdsetIndex}>
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
                    {characters[o.id].length === 1
                      ? "character"
                      : "captains"}
                    <ul className={styles.heroCardCharactersList}>
                      {characters[o.id].map((charId) => (
                        <li key={charId}>{labelForCharacter(o, charId)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {meepleSrc && (
                  /* eslint-disable-next-line @next/next/no-img-element */
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

      <div className={styles.factionDraftRow}>
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
              className={`${styles.factionCard} ${
                active ? styles.factionCardActive : ""
              } ${blocked ? styles.factionCardDisabled : ""} ${
                leaving ? styles.factionCardLeaving : ""
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
              <div className={styles.factionHeader}>
                <span className={styles.factionLabel}>{o.label}</span>
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
                    className={styles.factionAdsetToggle}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdsetOpen(open ? null : o.id);
                    }}
                    aria-label={`${open ? "Hide" : "Show"} setup for ${o.label}`}
                  >
                    {open ? "Hide setup" : "Show setup"}
                  </button>
                  {open && (
                    <ol className={styles.factionAdsetList}>
                      {adsetSteps.map((s, i) => (
                        <li key={i}>
                          <span className={styles.factionAdsetIndex}>
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
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={meepleSrc}
                  alt=""
                  aria-hidden
                  className={styles.factionCardMeeple}
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
                className={styles.factionSwatch}
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

  // Sort dealt ids alphabetically for stable resolution order.
  const ordered = [...dealtIds].sort((a, b) => a.localeCompare(b));
  const current = context[step.id];
  const confirmedIds =
    current?.kind === "dealt-resolve" ? current.confirmedIds : [];

  // The next unconfirmed dealt item (in alphabetical order) is the
  // one currently up for setup.
  const activeIndex = ordered.findIndex((id) => !confirmedIds.includes(id));
  const activeId = activeIndex === -1 ? null : ordered[activeIndex];
  const activeOption =
    activeId != null
      ? (sourceOptions.find((o) => o.id === activeId) ?? {
          id: activeId,
          label: activeId,
        })
      : null;
  const activePlayer =
    activeIndex === -1 || seats.length === 0
      ? null
      : seats[activeIndex % seats.length];

  if (ordered.length === 0) {
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
      <ol className={styles.hirelingProgress} aria-label="Hireling progress">
        {ordered.map((id, i) => {
          const done = confirmedIds.includes(id);
          const isActive = i === activeIndex;
          const seat = seats[i % seats.length];
          return (
            <li
              key={id}
              className={`${styles.hirelingProgressItem} ${
                done
                  ? styles.hirelingProgressItemDone
                  : isActive
                    ? styles.hirelingProgressItemActive
                    : ""
              }`}
              aria-label={
                done
                  ? `${id} — set up by ${seat?.name ?? `Seat ${(i % seats.length) + 1}`}`
                  : `${id} — awaiting ${seat?.name ?? `Seat ${(i % seats.length) + 1}`}`
              }
              title={
                done
                  ? `${id} — set up by ${seat?.name ?? `Seat ${(i % seats.length) + 1}`}`
                  : `${id} — awaiting ${seat?.name ?? `Seat ${(i % seats.length) + 1}`}`
              }
            >
              {i + 1}
            </li>
          );
        })}
      </ol>
      {activeId != null && activeOption && (
        <div className={styles.hirelingPrompt}>
          <span className={styles.hirelingPromptSeat}>
            {activePlayer?.name ?? `Seat ${(activeIndex % Math.max(1, seats.length)) + 1}`}
            {" — set up "}
            <strong>{activeOption.label}</strong>
          </span>
          <button
            type="button"
            onClick={() =>
              onChange((curr) => ({
                ...curr,
                confirmedIds: [...curr.confirmedIds, activeId],
              }))
            }
            className={styles.primary}
          >
            Confirm setup
          </button>
        </div>
      )}
      {activeId == null && (
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
