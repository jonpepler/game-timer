import { describe, expect, it } from "vitest";
import type { GameModel, TurnOrder } from "./gameDefinition";
import { createInitialGameSessionState } from "./gameSession";
import { selectPrediction } from "./prediction";
import { add, end, init, phase, run, seats, VALUED } from "./valuedFixture";

const MODEL: GameModel = {
  length: { type: "typical", cycles: 2 },
  cycle: [
    { phase: "open", rounds: 1, turnsPerRound: { type: "players", times: 2 } },
    {
      phase: "valued",
      rounds: 2,
      turnsPerRound: { type: "entries", atLeastPerPlayer: 1 },
    },
    { phase: "select", rounds: 1, turnsPerRound: { type: "entries" } },
  ],
};

// Three seats; "open" averages 30s, "valued" 100s, "select" has no
// declared average so it falls back to the starting 300s.
const modelled = (model: GameModel = MODEL) =>
  createInitialGameSessionState({
    initialAverageSeconds: 300,
    expectedTurns: 90,
    players: seats(3),
    turnOrder: { ...VALUED, model } satisfies TurnOrder,
  });

const START = { type: "START", at: 0 } as const;

describe("selectPrediction with a game model", () => {
  it("charges every round the model expects at each phase's declared average", () => {
    // open: 1 more round of 3 x 2 turns, plus the 6 of the running round
    // valued: 4 rounds, at least one turn per player while nothing is in play
    // select: nothing in play yet, so no turns
    expect(selectPrediction(modelled())).toEqual({
      turns: 6 + 12 + 6,
      seconds: 6 * 30 + 12 * 100 + 6 * 30,
      modelled: true,
    });
  });

  it("counts progress from the phases started so far", () => {
    const state = run(
      modelled(),
      START,
      add("a", 80, 0),
      add("b", 70, 1),
      add("c", 60, 2),
      phase("valued"),
    );
    // open: 1 round left; valued: 3 after the running one; select: 2
    // rounds of the three entries that act in it; plus 3 still to play now.
    expect(selectPrediction(state)).toEqual({
      turns: 6 + 9 + 6 + 3,
      seconds: 6 * 30 + 9 * 100 + 6 * 300 + 3 * 100,
      modelled: true,
    });
  });

  it("switches a phase to its running average once it has turns", () => {
    const state = run(
      modelled(),
      START,
      add("a", 80, 0),
      add("b", 70, 1),
      add("c", 60, 2),
      phase("valued"),
      end("same", 40),
    );
    expect(selectPrediction(state)).toEqual({
      turns: 6 + 9 + 6 + 2,
      seconds: 6 * 30 + 9 * 40 + 6 * 300 + 2 * 40,
      modelled: true,
    });
  });

  it("past the end of the model, still predicts the rest of the running round", () => {
    const oneCycle: GameModel = {
      ...MODEL,
      length: { type: "typical", cycles: 1 },
    };
    const state = run(
      modelled(oneCycle),
      START,
      add("a", 80, 0),
      add("b", 70, 1),
      phase("valued"),
      phase("valued"),
      phase("select"),
      phase("open"),
      phase("valued"),
    );
    expect(selectPrediction(state)).toEqual({
      turns: 2,
      seconds: 2 * 100,
      modelled: true,
    });
  });

  it("never predicts negative time once the last round has been played", () => {
    const oneCycle: GameModel = {
      ...MODEL,
      length: { type: "typical", cycles: 1 },
    };
    const state = run(
      modelled(oneCycle),
      START,
      add("a", 80, 0),
      phase("valued"),
      phase("valued"),
      phase("select"),
      end(undefined, 50),
    );
    const prediction = selectPrediction(state);
    expect(prediction.turns).toBe(0);
    expect(prediction.seconds).toBe(0);
  });

  it("undoing a phase change takes back its progress", () => {
    const before = run(modelled(), START, add("a", 80, 0));
    const after = run(before, phase("valued"), { type: "UNDO" });
    expect(selectPrediction(after)).toEqual(selectPrediction(before));
  });
});

describe("selectPrediction with a labelled countdown", () => {
  const labelled: GameModel = {
    ...MODEL,
    remainingLabel: { one: "lap left", other: "laps left" },
  };

  it("counts the whole game before any turn", () => {
    expect(selectPrediction(modelled(labelled)).remaining).toEqual({
      count: 2,
      label: "laps left",
    });
  });

  it("counts rounds played and the running round's share, to the nearest half", () => {
    const state = run(
      modelled(labelled),
      START,
      add("a", 80, 0),
      add("b", 70, 1),
      add("c", 60, 2),
      phase("valued"),
      end("same", 40),
    );
    // One of four rounds a lap is done, and a third of the running one:
    // 2 - (1 + 1/3) / 4 is about 1.67, which reads as one and a half.
    expect(selectPrediction(state).remaining).toEqual({
      count: 1.5,
      label: "laps left",
    });
  });

  it("is absent when the model names no countdown", () => {
    expect(selectPrediction(modelled()).remaining).toBeUndefined();
  });
});

describe("selectPrediction without a game model", () => {
  it("uses the starting average before any turn is played", () => {
    expect(selectPrediction(init())).toEqual({
      turns: 90,
      seconds: 90 * 300,
      modelled: false,
    });
  });

  it("uses one plain average across all turns, whatever their phase", () => {
    const state = run(
      init(),
      START,
      end(undefined, 30),
      end(undefined, 30),
      add("a", 80, 0),
      phase("valued"),
      end("same", 120),
    );
    // (30 + 30 + 120) / 3 = 60s, over the 87 turns left of 90
    expect(selectPrediction(state)).toEqual({
      turns: 87,
      seconds: 87 * 60,
      modelled: false,
    });
  });

  it("predicts no time once the turn budget is spent", () => {
    const state = run(
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 1,
      }),
      START,
      { type: "NEXT_TURN", elapsedSeconds: 10, at: 0 },
      { type: "NEXT_TURN", elapsedSeconds: 10, at: 0 },
    );
    expect(selectPrediction(state)).toEqual({
      turns: -1,
      seconds: 0,
      modelled: false,
    });
  });
});
