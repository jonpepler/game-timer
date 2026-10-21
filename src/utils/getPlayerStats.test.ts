import { describe, expect, it } from "vitest";
import { getPlayerStats } from "./getPlayerStats";

describe("getPlayerStats", () => {
  it("aggregates time, count, and average per player", () => {
    const stats = getPlayerStats([
      { playerIndex: 0, elapsedSeconds: 10 },
      { playerIndex: 1, elapsedSeconds: 20 },
      { playerIndex: 0, elapsedSeconds: 30 },
    ]);

    expect(stats).toEqual(
      expect.arrayContaining([
        { playerIndex: 0, totalTime: 40, averageTime: 20, turnCount: 2 },
        { playerIndex: 1, totalTime: 20, averageTime: 20, turnCount: 1 },
      ]),
    );
  });

  it("leaves untimed turns out of totals, counts and averages", () => {
    const stats = getPlayerStats([
      { playerIndex: 0, elapsedSeconds: 30 },
      { playerIndex: 0, elapsedSeconds: 0, untimed: true },
      { playerIndex: 1, elapsedSeconds: 0, untimed: true },
    ]);

    expect(stats).toEqual([
      { playerIndex: 0, totalTime: 30, averageTime: 30, turnCount: 1 },
    ]);
  });

  it("returns an empty array for no turns", () => {
    expect(getPlayerStats([])).toEqual([]);
  });
});
