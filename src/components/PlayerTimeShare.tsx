import styles from "./PlayerTimeShare.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlayerStats {
  playerIndex: number;
  totalTime: number;
  averageTime: number;
  turnCount: number;
}

export interface Player {
  name: string;
  color: string;
}

interface PlayerTimeShareProps {
  stats: PlayerStats[];
  players: Player[];
}

// ── Component ──────────────────────────────────────────────────────────────

export function PlayerTimeShare({ stats, players }: PlayerTimeShareProps) {
  const totalTime = stats.reduce((sum, s) => sum + s.totalTime, 0);

  if (totalTime === 0) return null;

  return (
    <div className={styles.container} aria-label="Time share by player">
      <span className={styles.label}>Time share</span>
      <div className={styles.bar}>
        {stats.map((s) => {
          const player = players[s.playerIndex];
          const pct = (s.totalTime / totalTime) * 100;
          const name = player?.name ?? `Player ${s.playerIndex + 1}`;
          return (
            <div
              key={s.playerIndex}
              title={`${name}: ${pct.toFixed(1)}%`}
              className={styles.segment}
              style={{
                width: `${pct}%`,
                background: player?.color ?? "var(--color-player-fallback)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
