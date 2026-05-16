interface TurnInput {
  playerIndex: number;
  elapsedSeconds: number;
}

interface PlayerStats {
  playerIndex: number;
  totalTime: number;
  averageTime: number;
  turnCount: number;
}

export function getPlayerStats(turns: TurnInput[]): PlayerStats[] {
  const totals = new Map<number, { total: number; count: number }>();

  for (const turn of turns) {
    const existing = totals.get(turn.playerIndex) ?? { total: 0, count: 0 };
    totals.set(turn.playerIndex, {
      total: existing.total + turn.elapsedSeconds,
      count: existing.count + 1,
    });
  }

  return Array.from(totals.entries()).map(
    ([playerIndex, { total, count }]) => ({
      playerIndex,
      totalTime: total,
      averageTime: total / count,
      turnCount: count,
    }),
  );
}
