import { useState } from "react";

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
  const [expectedTurns, setExpectedTurns] = useState<number>(90);
  const [trackPlayers, setTrackPlayers] = useState(false);
  const [playerCount, setPlayerCount] = useState(2);
  const [players, setPlayers] = useState<Player[]>([
    makePlayer(0),
    makePlayer(1),
  ]);

  if (!isOpen) return null;

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

  return (
    <dialog open aria-modal="true" aria-labelledby="setup-title">
      <h2 id="setup-title">Game Setup</h2>

      {/* Expected turns */}
      <fieldset>
        <legend>Expected Turns</legend>
        <label htmlFor="expected-turns">
          How many turns do you expect the game to last?
        </label>
        <input
          id="expected-turns"
          type="number"
          min={1}
          value={expectedTurns}
          onChange={(e) =>
            setExpectedTurns(Math.max(1, parseInt(e.target.value) || 1))
          }
        />
      </fieldset>

      {/* Player tracking toggle */}
      <fieldset>
        <legend>Players (optional)</legend>
        <label>
          <input
            type="checkbox"
            checked={trackPlayers}
            onChange={(e) => setTrackPlayers(e.target.checked)}
          />
          Track individual players (Experimental! Can break easily)
        </label>

        {trackPlayers && (
          <div>
            <label htmlFor="player-count">Number of players</label>
            <input
              id="player-count"
              type="number"
              min={1}
              max={6}
              value={playerCount}
              onChange={(e) =>
                handlePlayerCountChange(parseInt(e.target.value) || 1)
              }
            />

            <ul style={{ listStyle: "none", padding: 0 }}>
              {players.map((player, i) => (
                <li key={i}>
                  <label htmlFor={`player-name-${i}`}>
                    Player {i + 1} name
                  </label>
                  <input
                    id={`player-name-${i}`}
                    type="text"
                    value={player.name}
                    onChange={(e) => updatePlayer(i, "name", e.target.value)}
                    placeholder={`Player ${i + 1}`}
                  />
                  <label htmlFor={`player-color-${i}`}>Colour</label>
                  <input
                    id={`player-color-${i}`}
                    type="color"
                    value={player.color}
                    onChange={(e) => updatePlayer(i, "color", e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button onClick={handleSubmit} style={{ width: 250 }}>
          Start Game
        </button>
        {onClose && (
          <button onClick={onClose} style={{ width: 150 }}>
            Cancel
          </button>
        )}
      </div>
    </dialog>
  );
};
