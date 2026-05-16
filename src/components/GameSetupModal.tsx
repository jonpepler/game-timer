import { useEffect, useRef, useState } from "react";
import { Play, X, Users } from "lucide-react";
import styles from "./GameSetupModal.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Player {
  name: string;
  color: string;
}

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
}

interface GameSetupModalProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

const makePlayer = (index: number): Player => ({
  name: `Player ${index + 1}`,
  // Fallback is a literal hex because Player.color flows into native colour
  // inputs and SVG strokes that require a concrete value, not a CSS var.
  color: DEFAULT_COLORS[index] ?? "#ffffff",
});

// ── Component ──────────────────────────────────────────────────────────────

export const GameSetupModal = ({
  isOpen,
  onSubmit,
  onClose,
}: GameSetupModalProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [expectedTurns, setExpectedTurns] = useState<number>(90);
  const [trackPlayers, setTrackPlayers] = useState(false);
  const [playerCount, setPlayerCount] = useState(2);
  const [players, setPlayers] = useState<Player[]>([
    makePlayer(0),
    makePlayer(1),
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const handlePlayerCountChange = (count: number) => {
    const clamped = Math.max(1, Math.min(6, count));
    setPlayerCount(clamped);
    setPlayers((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push(makePlayer(next.length));
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
                    max={6}
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
