import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dices, Play, Settings, Sliders, X, Users } from "lucide-react";
import styles from "./GameSetupModal.module.css";
import { NumberField } from "./NumberField";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
} from "@/state/definitionRegistry";
import type {
  GameDefinition,
  SetupChoice,
  SetupConstraint,
  SetupContext,
  SetupOption,
  SetupStep,
} from "@/state/gameDefinition";
import type { Player, PlayerMetadataValue } from "@/state/gameSession";
import { fallbackColor } from "@/lib/playerVisual";

// Locate the player-pick step (if any) so the rest of the modal can
// treat it as the per-player picker's data source. There's at most one
// such step in this codebase — future games could have many, but the
// modal only knows about the first.
const findPlayerPickStep = (
  definition: GameDefinition,
):
  | {
      step: SetupStep;
      options: SetupOption[];
      constraints: SetupConstraint[];
    }
  | undefined => {
  const step = definition.setupSteps?.find(
    (s) => s.kind.type === "player-pick",
  );
  if (!step || step.kind.type !== "player-pick") return undefined;
  return {
    step,
    options: step.kind.options,
    constraints: step.kind.constraints ?? [],
  };
};

const mutexPairsOf = (constraints: SetupConstraint[]): [string, string][] =>
  constraints
    .filter(
      (c): c is Extract<SetupConstraint, { type: "mutually-exclusive" }> =>
        c.type === "mutually-exclusive",
    )
    .map((c) => c.optionIds);

// ── Types ──────────────────────────────────────────────────────────────────

// Editing-time state for one player row in the modal. The runtime
// Player (gameSession) drops `color` + `factionId` in favour of a
// metadata bag; the modal still tracks them as ergonomic UI state
// and projects to the runtime shape on submit.
interface PlayerRow {
  name: string;
  color: string;
  factionId?: string;
}

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
  // Definition the modal was configured against — captured so downstream
  // features (score, victory, faction lookup) can read the rules.
  definitionId: string;
  // Choices the user made for each declared SetupStep, keyed by step
  // id. Empty when the definition declares no setupSteps.
  setupContext?: SetupContext;
}

// Project a modal player row into the runtime Player shape. If the
// active definition declares a playerVisualFrom key, the picked
// faction is attached under that key as a selected-option metadata
// entry so renderers can find the colour + label generically.
const projectRow = (
  row: PlayerRow,
  definition: GameDefinition,
): Player => {
  const visualKey = definition.playerVisualFrom;
  const pick = findPlayerPickStep(definition);
  const option = row.factionId
    ? pick?.options.find((o) => o.id === row.factionId)
    : undefined;
  const metadata: Record<string, PlayerMetadataValue> = {};
  if (visualKey && option) {
    metadata[visualKey] = {
      type: "selected-option",
      optionId: option.id,
      label: option.label,
      color: row.color,
      description: option.description,
    };
  }
  return { name: row.name, metadata };
};

interface GameSetupModalProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
  definitions?: GameDefinition[];
  initialDefinitionId?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const GENERIC_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

const GENERIC_MAX_PLAYERS = GENERIC_PALETTE.length;

const buildPlayerRowsForDefinition = (
  definition: GameDefinition,
  count: number,
): PlayerRow[] => {
  const pick = findPlayerPickStep(definition);
  if (pick && pick.options.length > 0) {
    return pick.options.slice(0, count).map((o) => ({
      name: o.label,
      color: o.color ?? fallbackColor(0),
      factionId: o.id,
    }));
  }
  return Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    color: GENERIC_PALETTE[i] ?? fallbackColor(i),
  }));
};

const maxPlayersForDefinition = (definition: GameDefinition): number => {
  if (definition.maxPlayers !== undefined) {
    return Math.max(1, definition.maxPlayers);
  }
  const pick = findPlayerPickStep(definition);
  if (pick && pick.options.length > 0) return pick.options.length;
  return GENERIC_MAX_PLAYERS;
};

// Seed a SetupContext with each step's declared default.
const defaultSetupContext = (
  steps: SetupStep[] | undefined,
): SetupContext => {
  const ctx: SetupContext = {};
  if (!steps) return ctx;
  for (const step of steps) {
    switch (step.kind.type) {
      case "select-one": {
        const id =
          step.kind.defaultOptionId ?? step.kind.options[0]?.id;
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
    }
  }
  return ctx;
};

// Compute which faction ids the user can't pick for a given row,
// because another row already picked them OR because they're mutually
// excluded with something another row already picked.
const blockedFactionsForRow = (
  rowIndex: number,
  rows: PlayerRow[],
  mutex: [string, string][] | undefined,
): Set<string> => {
  const blocked = new Set<string>();
  rows.forEach((p, i) => {
    if (i === rowIndex || !p.factionId) return;
    blocked.add(p.factionId);
    if (!mutex) return;
    for (const [a, b] of mutex) {
      if (p.factionId === a) blocked.add(b);
      if (p.factionId === b) blocked.add(a);
    }
  });
  return blocked;
};

// ── Component ──────────────────────────────────────────────────────────────

export const GameSetupModal = ({
  isOpen,
  onSubmit,
  onClose,
  definitions = listDefinitions(),
  initialDefinitionId = DEFAULT_DEFINITION_ID,
}: GameSetupModalProps) => {
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
  const [trackPlayers, setTrackPlayers] = useState(false);
  const [playerCount, setPlayerCount] = useState(2);
  const [players, setPlayers] = useState<PlayerRow[]>(
    buildPlayerRowsForDefinition(initialDefinition, 2),
  );
  const [setupContext, setSetupContext] = useState<SetupContext>(
    defaultSetupContext(initialDefinition.setupSteps),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const applyDefinition = (next: GameDefinition) => {
    setDefinitionId(next.id);
    setExpectedTurns(next.defaultExpectedTurns);
    const maxCount = maxPlayersForDefinition(next);
    const clampedCount = Math.min(playerCount, maxCount);
    setPlayerCount(clampedCount);
    setPlayers(buildPlayerRowsForDefinition(next, clampedCount));
    setSetupContext(defaultSetupContext(next.setupSteps));
  };

  const handleDefinitionChange = (nextId: string) => {
    const next = definitions.find((d) => d.id === nextId);
    if (!next) return;
    applyDefinition(next);
  };

  const maxCount = maxPlayersForDefinition(definition);
  const playerPick = findPlayerPickStep(definition);
  const mutex = playerPick ? mutexPairsOf(playerPick.constraints) : [];
  const hasFactions = !!playerPick;
  // Render the SetupStepsSection only when there are non-player-pick
  // steps to show; player-pick is handled in the player-rows section.
  const nonPlayerPickSteps =
    definition.setupSteps?.filter((s) => s.kind.type !== "player-pick") ?? [];
  const hasAdvanced = nonPlayerPickSteps.length > 0;

  const handlePlayerCountChange = (count: number) => {
    const clamped = Math.max(1, Math.min(maxCount, count));
    setPlayerCount(clamped);
    setPlayers((prev) => {
      const next = [...prev];
      const seed = buildPlayerRowsForDefinition(definition, clamped);
      while (next.length < clamped) next.push(seed[next.length]);
      return next.slice(0, clamped);
    });
  };

  const updatePlayer = (
    index: number,
    field: keyof PlayerRow,
    value: string,
  ) => {
    setPlayers((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const pickFaction = (rowIndex: number, factionId: string) => {
    const o = playerPick?.options.find((x) => x.id === factionId);
    if (!o) return;
    setPlayers((prev) =>
      prev.map((p, i) =>
        i === rowIndex
          ? {
              name: o.label,
              color: o.color ?? fallbackColor(i),
              factionId: o.id,
            }
          : p,
      ),
    );
  };

  const handleSubmit = () => {
    onSubmit({
      expectedTurns,
      players: trackPlayers
        ? players.map((row) => projectRow(row, definition))
        : undefined,
      definitionId: definition.id,
      setupContext: hasAdvanced ? setupContext : undefined,
    });
  };

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose?.();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.modal}
      aria-labelledby="setup-title"
      onClick={handleDialogClick}
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <header className={styles.header}>
          <h2 id="setup-title" className={styles.title}>
            Game Setup
          </h2>
        </header>

        <div className={styles.scroll}>
          <section className={styles.section}>
            <label htmlFor="game-definition" className={styles.label}>
              <span className={styles.labelIcon}>
                <Dices size={14} aria-hidden />
              </span>
              Game
            </label>
            <select
              id="game-definition"
              className={styles.input}
              value={definition.id}
              onChange={(e) => handleDefinitionChange(e.target.value)}
            >
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {definition.description && (
              <p className={styles.help}>{definition.description}</p>
            )}
            <Link href="/games" className={styles.manageLink}>
              <Settings size={12} aria-hidden />
              Manage games
            </Link>
          </section>

          <section className={styles.section}>
            <label htmlFor="expected-turns" className={styles.label}>
              Expected turns
            </label>
            <NumberField
              id="expected-turns"
              min={1}
              value={expectedTurns}
              onChange={setExpectedTurns}
              className={styles.input}
            />
            <p className={styles.help}>
              Used to predict when the game will finish and to set the first
              countdown.
            </p>
          </section>

          {hasAdvanced && (
            <SetupStepsSection
              steps={nonPlayerPickSteps}
              value={setupContext}
              onChange={setSetupContext}
            />
          )}

          <section className={styles.section}>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={trackPlayers}
                onChange={(e) => setTrackPlayers(e.target.checked)}
              />
              <span className={styles.toggleText}>
                <Users size={18} aria-hidden="true" />
                Track individual players
              </span>
              <span className={styles.badge}>Experimental</span>
            </label>

            {trackPlayers && (
              <>
                <div className={styles.playerCount}>
                  <label htmlFor="player-count" className={styles.subLabel}>
                    Number of players
                  </label>
                  <NumberField
                    id="player-count"
                    min={1}
                    max={maxCount}
                    value={playerCount}
                    onChange={handlePlayerCountChange}
                    className={styles.input}
                  />
                </div>

                <ul className={styles.playerList}>
                  {players.map((player, i) => {
                    const blocked = hasFactions
                      ? blockedFactionsForRow(i, players, mutex)
                      : new Set<string>();
                    return (
                      <li key={i} className={styles.playerRow}>
                        <input
                          type="color"
                          value={player.color}
                          onChange={(e) =>
                            updatePlayer(i, "color", e.target.value)
                          }
                          className={styles.colorSwatch}
                          aria-label={`Colour for player ${i + 1}`}
                        />
                        {hasFactions && playerPick && (
                          <select
                            value={player.factionId ?? ""}
                            onChange={(e) => pickFaction(i, e.target.value)}
                            className={styles.input}
                            aria-label={`${playerPick.step.label} for player ${i + 1}`}
                          >
                            <option value="" disabled>
                              — pick a {playerPick.step.label.toLowerCase()} —
                            </option>
                            {playerPick.options.map((o) => (
                              <option
                                key={o.id}
                                value={o.id}
                                disabled={blocked.has(o.id)}
                              >
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          value={player.name}
                          onChange={(e) =>
                            updatePlayer(i, "name", e.target.value)
                          }
                          placeholder={`Player ${i + 1}`}
                          aria-label={`Player ${i + 1} name`}
                          className={styles.input}
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>

        <footer className={styles.actions}>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={styles.secondary}
            >
              <X size={18} aria-hidden="true" />
              Cancel
            </button>
          )}
          <button type="submit" className={styles.primary}>
            <Play size={18} aria-hidden="true" />
            Start Game
          </button>
        </footer>
      </form>
    </dialog>
  );
};

// ── Setup steps (generic, schema-driven) ─────────────────────────────

interface SetupStepsSectionProps {
  steps: SetupStep[];
  value: SetupContext;
  onChange: (next: SetupContext) => void;
}

function SetupStepsSection({ steps, value, onChange }: SetupStepsSectionProps) {
  const setChoice = (stepId: string, choice: SetupChoice) =>
    onChange({ ...value, [stepId]: choice });

  return (
    <section className={styles.section}>
      <span className={styles.label}>
        <span className={styles.labelIcon}>
          <Sliders size={14} aria-hidden />
        </span>
        Advanced setup
      </span>

      {steps.map((step) => (
        <SetupStepRenderer
          key={step.id}
          step={step}
          choice={value[step.id]}
          onChange={(c) => setChoice(step.id, c)}
        />
      ))}
    </section>
  );
}

interface SetupStepRendererProps {
  step: SetupStep;
  choice: SetupChoice | undefined;
  onChange: (next: SetupChoice) => void;
}

function SetupStepRenderer({ step, choice, onChange }: SetupStepRendererProps) {
  const inputId = `step-${step.id}`;
  switch (step.kind.type) {
    case "select-one":
      return (
        <SelectOneStep
          step={step}
          options={step.kind.options}
          value={
            choice?.kind === "select-one"
              ? choice.optionId
              : (step.kind.defaultOptionId ?? "")
          }
          onChange={(optionId) =>
            onChange({ kind: "select-one", optionId })
          }
          inputId={inputId}
        />
      );
    case "select-count":
      return (
        <CountStep
          step={step}
          min={step.kind.min}
          max={step.kind.max}
          value={
            choice?.kind === "select-count"
              ? choice.count
              : (step.kind.defaultValue ?? step.kind.min)
          }
          onChange={(count) => onChange({ kind: "select-count", count })}
          inputId={inputId}
        />
      );
    case "toggle":
      return (
        <ToggleStep
          step={step}
          value={
            choice?.kind === "toggle"
              ? choice.value
              : (step.kind.defaultValue ?? false)
          }
          onChange={(v) => onChange({ kind: "toggle", value: v })}
          inputId={inputId}
        />
      );
  }
}

function SelectOneStep({
  step,
  options,
  value,
  onChange,
  inputId,
}: {
  step: SetupStep;
  options: SetupOption[];
  value: string;
  onChange: (id: string) => void;
  inputId: string;
}) {
  return (
    <div>
      <label htmlFor={inputId} className={styles.subLabel}>
        {step.label}
      </label>
      <select
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.input}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.tag ? ` · ${o.tag}` : ""}
          </option>
        ))}
      </select>
      {step.description && <p className={styles.help}>{step.description}</p>}
    </div>
  );
}

function CountStep({
  step,
  min,
  max,
  value,
  onChange,
  inputId,
}: {
  step: SetupStep;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  inputId: string;
}) {
  return (
    <div className={styles.playerCount}>
      <label htmlFor={inputId} className={styles.subLabel}>
        {step.label}
      </label>
      <NumberField
        id={inputId}
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        className={styles.input}
      />
    </div>
  );
}

function ToggleStep({
  step,
  value,
  onChange,
  inputId,
}: {
  step: SetupStep;
  value: boolean;
  onChange: (v: boolean) => void;
  inputId: string;
}) {
  return (
    <label className={styles.toggleRow} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleText}>{step.label}</span>
    </label>
  );
}
