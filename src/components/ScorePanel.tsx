import { Minus, Plus } from "lucide-react";
import styles from "./ScorePanel.module.css";
import type { ScoreConfig } from "@/state/gameDefinition";

interface Player {
  name: string;
  color: string;
}

interface ScorePanelProps {
  players: Player[];
  scores: Record<number, number>;
  scoreConfig: ScoreConfig;
  onIncrement?: (playerIndex: number, delta: number) => void;
  // When true, the +/- buttons disappear — for read-only views (the
  // companion screen mirrors host state without write access in v1).
  readOnly?: boolean;
}

export function ScorePanel({
  players,
  scores,
  scoreConfig,
  onIncrement,
  readOnly = false,
}: ScorePanelProps) {
  if (scoreConfig.displayStyle === "hidden") return null;
  if (players.length === 0) return null;

  const min = scoreConfig.min;
  const max = scoreConfig.max;
  const step = scoreConfig.increment;

  // Stop click propagation so the tap-to-advance handler on the parent
  // container doesn't also fire when the user hits +/-.
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className={styles.container} aria-label="Scores">
      <span className={styles.label}>Scores</span>
      <div className={styles.rows}>
        {players.map((player, index) => {
          const score = scores[index] ?? min;
          const atMin = score <= min;
          const atMax = max !== undefined ? score >= max : false;
          return (
            <div key={index} className={styles.row}>
              <span
                className={styles.swatch}
                style={{ background: player.color }}
                aria-hidden
              />
              <span className={styles.name}>{player.name}</span>
              {!readOnly && onIncrement && (
                <button
                  type="button"
                  onClick={stop(() => onIncrement(index, -step))}
                  disabled={atMin}
                  className={styles.scoreButton}
                  aria-label={`Decrease score for ${player.name}`}
                >
                  <Minus aria-hidden />
                </button>
              )}
              <span className={styles.score}>{score}</span>
              {!readOnly && onIncrement && (
                <button
                  type="button"
                  onClick={stop(() => onIncrement(index, step))}
                  disabled={atMax}
                  className={styles.scoreButton}
                  aria-label={`Increase score for ${player.name}`}
                >
                  <Plus aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
