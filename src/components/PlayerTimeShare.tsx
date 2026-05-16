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
    <div
      style={{
        display: "flex",
        width: "80vw",
        height: 40,
        position: "absolute",
        bottom: 80,
        marginLeft: "10vw",
      }}
    >
      {stats.map((s) => {
        const player = players[s.playerIndex];
        const pct = (s.totalTime / totalTime) * 100;
        return (
          <div
            key={s.playerIndex}
            title={`${player?.name ?? `Player ${s.playerIndex + 1}`}: ${pct.toFixed(1)}%`}
            style={{
              width: `${pct}%`,
              background: player?.color ?? "var(--color-player-fallback)",
              transition: "width 0.4s ease",
            }}
          />
        );
      })}
    </div>
  );
}
