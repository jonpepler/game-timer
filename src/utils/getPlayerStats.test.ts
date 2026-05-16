import { describe, expect, it } from "vitest";
import { getPlayerStats } from "./getPlayerStats";

describe("getPlayerStats", () => {
  it("aggregates time, count, and average per player", () => {
    const stats = getPlayerStats([
      { playerIndex: 0, time: 10 },
      { playerIndex: 1, time: 20 },
      { playerIndex: 0, time: 30 },
    ]);

    expect(stats).toEqual(
      expect.arrayContaining([
        { playerIndex: 0, totalTime: 40, averageTime: 20, turnCount: 2 },
        { playerIndex: 1, totalTime: 20, averageTime: 20, turnCount: 1 },
      ]),
    );
  });

  it("returns an empty array for no turns", () => {
    expect(getPlayerStats([])).toEqual([]);
  });
});
