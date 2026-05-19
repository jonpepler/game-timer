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
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Dices,
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

interface GameSetupWizardProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
  definitions?: GameDefinition[];
  initialDefinitionId?: string;
}

// ── Screen catalogue ────────────────────────────────────────────────

type WizardScreen =
  | { kind: "game"; id: "game"; label: string }
  | { kind: "expected-turns"; id: "expected-turns"; label: string }
  | { kind: "setup-step"; id: string; label: string; step: SetupStep }
  | { kind: "track-players"; id: "track-players"; label: string }
  | { kind: "adset-confirm"; id: "adset-confirm"; label: string };

const buildScreens = (definition: GameDefinition): WizardScreen[] => {
  const screens: WizardScreen[] = [
    { kind: "game", id: "game", label: "Game" },
    { kind: "expected-turns", id: "expected-turns", label: "Turns" },
  ];
  const steps = definition.setupSteps ?? [];
  let hasSeating = false;
  let hasFactionPick = false;
  for (const step of steps) {
    screens.push({ kind: "setup-step", id: step.id, label: step.label, step });
    if (step.kind.type === "seat-players") hasSeating = true;
    if (step.kind.type === "player-pick") hasFactionPick = true;
  }
  if (!hasSeating) {
    screens.push({
      kind: "track-players",
      id: "track-players",
      label: "Players",
    });
  }
  if (hasFactionPick) {
    screens.push({ kind: "adset-confirm", id: "adset-confirm", label: "Setup" });
  }
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
): SetupOption[] => options.filter((o) => optionVisibleUnderContext(o, context));

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
          step.kind.defaultSelectedIds ??
          step.kind.options.map((o) => o.id);
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
        const count =
          step.kind.defaultPlayerCount ?? step.kind.minPlayers ?? 2;
        ctx[step.id] = {
          kind: "seat-players",
          seats: Array.from({ length: count }, (_, i) => ({
            name: `Player ${i + 1}`,
          })),
        };
        break;
      }
      case "player-pick":
        // Picks are built incrementally on the picker screen.
        ctx[step.id] = { kind: "player-pick", picks: {} };
        break;
    }
  }
  return ctx;
};

const shuffleAndTake = <T,>(items: T[], count: number): T[] => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
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

export const GameSetupWizard = ({
  isOpen,
  onSubmit,
  onClose,
  definitions = listDefinitions(),
  initialDefinitionId = DEFAULT_DEFINITION_ID,
}: GameSetupWizardProps) => {
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      // Fresh open: rewind to the first screen so the user doesn't
      // resume in the middle of an old in-progress wizard.
      setScreenIndex(0);
      dialog.showModal();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const currentScreen = screens[screenIndex];
  const isLast = screenIndex === screens.length - 1;
  const isFirst = screenIndex === 0;

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
    const players = collectPlayers(definition, context, trackPlayers, trackRoster);
    onSubmit({
      expectedTurns,
      players,
      definitionId: definition.id,
      setupContext: definition.setupSteps?.length ? context : undefined,
    });
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <dialog
      ref={dialogRef}
      className={styles.modal}
      aria-labelledby="wizard-title"
      onClose={onClose}
    >
      <form
        className={styles.form}
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
          <div className={styles.progress} role="progressbar"
               aria-valuemin={1} aria-valuemax={screens.length}
               aria-valuenow={screenIndex + 1}>
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
              context={context}
              setContext={setContext}
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
          {currentScreen.kind === "adset-confirm" && (
            <AdsetConfirmScreen
              definition={definition}
              context={context}
              expectedTurns={expectedTurns}
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
    </dialog>
  );
};

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
    const picks =
      pickChoice?.kind === "player-pick" ? pickChoice.picks : {};
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
        metadata[visualKey] = {
          type: "selected-option",
          optionId: option.id,
          label: option.label,
          color: option.color ?? fallbackColor(i),
          description: option.description,
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
  context,
  setContext,
}: {
  step: SetupStep;
  context: SetupContext;
  setContext: (updater: (prev: SetupContext) => SetupContext) => void;
}) {
  switch (step.kind.type) {
    case "multi-toggle":
      return (
        <MultiToggleScreen
          step={step}
          options={step.kind.options}
          selectedIds={
            context[step.id]?.kind === "multi-toggle"
              ? (context[step.id] as Extract<
                  SetupChoice,
                  { kind: "multi-toggle" }
                >).selectedIds
              : step.kind.defaultSelectedIds ?? []
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
              ? (context[step.id] as Extract<
                  SetupChoice,
                  { kind: "select-one" }
                >).optionId
              : step.kind.defaultOptionId ?? step.kind.options[0]?.id
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
              ? (context[step.id] as Extract<
                  SetupChoice,
                  { kind: "select-count" }
                >).count
              : step.kind.defaultValue ?? step.kind.min
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
              ? (context[step.id] as Extract<
                  SetupChoice,
                  { kind: "toggle" }
                >).value
              : step.kind.defaultValue ?? false
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
          context={context}
          onChange={(picks) =>
            setContext((prev) => ({
              ...prev,
              [step.id]: { kind: "player-pick", picks },
            }))
          }
        />
      );
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
          >
            <span className={styles.chipLabel}>{o.label}</span>
            {o.module && (
              <span className={styles.chipModule}>{o.module}</span>
            )}
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
  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        {step.label}
      </h3>
      {step.description && (
        <p className={styles.screenSubtitle}>{step.description}</p>
      )}
      <NumberField
        id={`count-${step.id}`}
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        className={styles.input}
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
  const update = (seats: Array<{ name: string }>) =>
    onChange({ kind: "seat-players", seats });

  const setName = (i: number, name: string) =>
    update(seats.map((s, j) => (i === j ? { name } : s)));

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
    update([...seats, { name: `Player ${seats.length + 1}` }]);
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
  const isSkipped =
    choice?.kind === "deal-random" && choice.skipped === true;
  const dealtIds =
    choice?.kind === "deal-random" && choice.skipped === false
      ? choice.dealtIds
      : null;

  const reshuffle = () => {
    onChange({
      kind: "deal-random",
      skipped: false,
      dealtIds: shuffleAndTake(
        visible.map((o) => o.id),
        count,
      ),
    });
  };

  const skip = () => onChange({ kind: "deal-random", skipped: true });

  // If we don't have a deal yet (and we're not skipping), deal once on
  // first render via effect would be cleaner — but doing it here keeps
  // the screen idempotent during navigation.
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
          <div className={styles.skipNotice}>Skipped — no hirelings this game.</div>
        )}
        {!isSkipped && dealtIds && (
          <div className={styles.dealtList}>
            {(cards as SetupOption[]).map((o) => (
              <div key={o.id} className={styles.dealtCard}>
                <span className={styles.dealtLabel}>{o.label}</span>
                {o.module && (
                  <span className={styles.dealtModule}>{o.module}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className={styles.actionsLeft}>
          <button
            type="button"
            onClick={reshuffle}
            className={styles.secondary}
          >
            <RefreshCw size={14} aria-hidden /> Shuffle{dealtIds ? " again" : ""}
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

function PlayerPickScreen({
  step,
  options,
  constraints,
  context,
  onChange,
}: {
  step: SetupStep;
  options: SetupOption[];
  constraints: [string, string][];
  context: SetupContext;
  onChange: (picks: Record<number, string>) => void;
}) {
  const filtered = visibleOptions(options, context);
  const seatChoice = Object.values(context).find(
    (c): c is Extract<SetupChoice, { kind: "seat-players" }> =>
      c.kind === "seat-players",
  );
  const seats = seatChoice?.seats ?? [];
  const choice = context[step.id];
  const picks =
    choice?.kind === "player-pick" ? choice.picks : {};

  const [activeSeat, setActiveSeat] = useState(0);
  // When seats change, clamp activeSeat to range.
  useEffect(() => {
    if (activeSeat >= seats.length) setActiveSeat(0);
  }, [seats.length, activeSeat]);

  const [adsetOpen, setAdsetOpen] = useState<string | null>(null);

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

  const pick = (optionId: string) => {
    const next = { ...picks, [activeSeat]: optionId };
    onChange(next);
    // Auto-advance to next unfilled seat.
    const nextUnfilled = seats.findIndex((_, i) => next[i] == null);
    if (nextUnfilled !== -1) setActiveSeat(nextUnfilled);
  };

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

      <div className={styles.factionGrid}>
        {filtered.map((o) => {
          const blocked = blockedForActive.has(o.id);
          const active = picks[activeSeat] === o.id;
          const open = adsetOpen === o.id;
          const adsetSteps = (
            o as unknown as { adsetSteps?: string[] }
          ).adsetSteps;
          // Card is a div, not a button, so it can host the inner
          // "Show setup" button. role="button" + tabIndex keeps it
          // keyboard- and AT-accessible.
          const onActivate = () => {
            if (blocked) return;
            pick(o.id);
          };
          return (
            <div
              key={o.id}
              role="button"
              aria-pressed={active}
              aria-disabled={blocked}
              data-testid={`faction-card-${o.id}`}
              tabIndex={blocked ? -1 : 0}
              className={`${styles.factionCard} ${
                active ? styles.factionCardActive : ""
              } ${blocked ? styles.factionCardDisabled : ""}`}
              onClick={onActivate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate();
                }
              }}
            >
              <div className={styles.factionHeader}>
                <span
                  className={styles.factionSwatch}
                  style={{ background: o.color ?? "var(--color-text-dim)" }}
                  aria-hidden
                />
                <span className={styles.factionLabel}>{o.label}</span>
              </div>
              {o.description && (
                <span className={styles.chipDesc}>{o.description}</span>
              )}
              {adsetSteps && adsetSteps.length > 0 && (
                <>
                  <button
                    type="button"
                    className={styles.factionAdsetToggle}
                    data-testid={`faction-adset-toggle-${o.id}`}
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
            </div>
          );
        })}
      </div>

      <div className={styles.pickerSummary} aria-label="Seat picks so far">
        {seats.map((seat, i) => {
          const factionId = picks[i];
          const option = factionId
            ? filtered.find((o) => o.id === factionId) ??
              options.find((o) => o.id === factionId)
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

function AdsetConfirmScreen({
  definition,
  context,
  expectedTurns,
}: {
  definition: GameDefinition;
  context: SetupContext;
  expectedTurns: number;
}) {
  const pickStep = findPlayerPickStep(definition);
  const seatStep = findSeatPlayersStep(definition);
  const pickChoice =
    pickStep && context[pickStep.id]?.kind === "player-pick"
      ? (context[pickStep.id] as Extract<
          SetupChoice,
          { kind: "player-pick" }
        >)
      : null;
  const seatChoice =
    seatStep && context[seatStep.id]?.kind === "seat-players"
      ? (context[seatStep.id] as Extract<
          SetupChoice,
          { kind: "seat-players" }
        >)
      : null;
  const factionOptions =
    pickStep && pickStep.kind.type === "player-pick"
      ? pickStep.kind.options
      : [];
  const seats = seatChoice?.seats ?? [];

  // Summary lines pulled from other steps (map, deck, etc.).
  const summaryLines: { key: string; value: string }[] = [];
  for (const step of definition.setupSteps ?? []) {
    const choice = context[step.id];
    if (!choice) continue;
    if (choice.kind === "select-one") {
      const opt =
        step.kind.type === "select-one"
          ? step.kind.options.find((o) => o.id === choice.optionId)
          : null;
      if (opt) summaryLines.push({ key: step.label, value: opt.label });
    } else if (choice.kind === "multi-toggle") {
      summaryLines.push({
        key: step.label,
        value: choice.selectedIds.join(", ") || "—",
      });
    } else if (choice.kind === "select-count") {
      summaryLines.push({ key: step.label, value: String(choice.count) });
    } else if (choice.kind === "toggle") {
      summaryLines.push({
        key: step.label,
        value: choice.value ? "Yes" : "No",
      });
    } else if (choice.kind === "deal-random") {
      if (choice.skipped) {
        summaryLines.push({ key: step.label, value: "Skipped" });
      } else if (step.kind.type === "deal-random") {
        const opts = step.kind.options;
        const labels = choice.dealtIds
          .map((id) => opts.find((o) => o.id === id)?.label ?? id)
          .join(", ");
        summaryLines.push({ key: step.label, value: labels });
      }
    }
  }
  summaryLines.push({ key: "Expected turns", value: String(expectedTurns) });

  return (
    <>
      <h3 className={styles.screenTitle} id="screen-title">
        Set up the table
      </h3>
      <p className={styles.screenSubtitle}>
        Walk through these steps before starting the timer.
      </p>

      <div className={styles.confirmSummary}>
        {summaryLines.map((line) => (
          <div key={line.key} className={styles.summaryRow}>
            <span className={styles.summaryKey}>{line.key}</span>
            <span>{line.value}</span>
          </div>
        ))}
      </div>

      <div className={styles.confirmList}>
        {seats.map((seat, i) => {
          const factionId = pickChoice?.picks[i];
          const option = factionId
            ? factionOptions.find((o) => o.id === factionId)
            : undefined;
          const adset = (
            option as unknown as { adsetSteps?: string[] } | undefined
          )?.adsetSteps;
          return (
            <div key={i} className={styles.confirmCard}>
              <div className={styles.confirmHeader}>
                <span
                  className={styles.factionSwatch}
                  style={{ background: option?.color ?? "var(--color-border)" }}
                  aria-hidden
                />
                <span className={styles.confirmName}>
                  {seat.name}
                  {option && (
                    <>
                      {" — "}
                      <span className={styles.confirmFaction}>
                        {option.label}
                      </span>
                    </>
                  )}
                </span>
              </div>
              {adset && adset.length > 0 ? (
                <ol className={styles.confirmSteps}>
                  {adset.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ol>
              ) : (
                <span className={styles.help}>No setup steps recorded.</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
