import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dices, Play, Settings, X, Users } from "lucide-react";
import styles from "./GameSetupModal.module.css";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
} from "@/state/definitionRegistry";
import type { GameDefinition } from "@/state/gameDefinition";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Player {
  name: string;
  color: string;
}

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
  // Definition the modal was configured against — captured so downstream
  // features (score, victory, faction lookup) can read the rules.
  definitionId: string;
}

interface GameSetupModalProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
  // Defaults to the built-in registry; override for tests or future
  // user-imported definitions.
  definitions?: GameDefinition[];
  // Pre-selected definition id; defaults to the registry default (Generic).
  initialDefinitionId?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────────

// Used when a definition declares no factions of its own. Anonymous
// "Player N" rows with a serviceable distinct palette.
const GENERIC_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

const GENERIC_MAX_PLAYERS = GENERIC_PALETTE.length;

const buildPlayersForDefinition = (
  definition: GameDefinition,
  count: number,
): Player[] => {
  if (definition.factions && definition.factions.length > 0) {
    return definition.factions.slice(0, count).map((f) => ({
      name: f.name,
      color: f.color,
    }));
  }
  return Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    color: GENERIC_PALETTE[i] ?? "#ffffff",
  }));
};

const maxPlayersForDefinition = (definition: GameDefinition): number => {
  // Explicit cap wins over derived counts so Root can offer 13 factions
  // while still capping the table at 6 humans.
  if (definition.maxPlayers !== undefined) {
    return Math.max(1, definition.maxPlayers);
  }
  if (definition.factions && definition.factions.length > 0) {
    return definition.factions.length;
  }
  return GENERIC_MAX_PLAYERS;
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
  const [players, setPlayers] = useState<Player[]>(
    buildPlayersForDefinition(initialDefinition, 2),
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
    setPlayers(buildPlayersForDefinition(next, clampedCount));
  };

  const handleDefinitionChange = (nextId: string) => {
    const next = definitions.find((d) => d.id === nextId);
    if (!next) return;
    applyDefinition(next);
  };

  const maxCount = maxPlayersForDefinition(definition);

  const handlePlayerCountChange = (count: number) => {
    const clamped = Math.max(1, Math.min(maxCount, count));
    setPlayerCount(clamped);
    setPlayers((prev) => {
      const next = [...prev];
      const seed = buildPlayersForDefinition(definition, clamped);
      while (next.length < clamped) next.push(seed[next.length]);
      return next.slice(0, clamped);
    });
  };

  const updatePlayer = (index: number, field: keyof Player, value: string) => {
    setPlayers((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const handleSubmit = () => {
    onSubmit({
      expectedTurns,
      players: trackPlayers ? players : undefined,
      definitionId: definition.id,
    });
  };

  // Close when the user clicks the backdrop (the dialog itself, not its
  // form contents).
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
            <input
              id="expected-turns"
              type="number"
              min={1}
              value={expectedTurns}
              onChange={(e) =>
                setExpectedTurns(Math.max(1, parseInt(e.target.value) || 1))
              }
              className={styles.input}
            />
            <p className={styles.help}>
              Used to predict when the game will finish and to set the first
              countdown.
            </p>
          </section>

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
                  <input
                    id="player-count"
                    type="number"
                    min={1}
                    max={maxCount}
                    value={playerCount}
                    onChange={(e) =>
                      handlePlayerCountChange(parseInt(e.target.value) || 1)
                    }
                    className={styles.input}
                  />
                </div>

                <ul className={styles.playerList}>
                  {players.map((player, i) => (
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
                  ))}
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
