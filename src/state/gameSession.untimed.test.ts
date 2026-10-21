import { describe, expect, it } from "vitest";
import { getPlayerStats } from "@/utils/getPlayerStats";
import type { TurnOrder } from "./gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  selectUntimedTurnLabel,
} from "./gameSession";
import {
  active,
  add,
  end,
  order,
  phase,
  run,
  seats,
  VALUED,
} from "./valuedFixture";

// Kind "y" (entry "t") plays untimed shared turns; kind "x" is timed.
const UNTIMED: TurnOrder = {
  ...VALUED,
  entryKinds: [
    { id: "x", label: "Kind X" },
    {
      id: "y",
      label: "Kind Y",
      turnTiming: "untimed",
      untimedLabel: "Everyone acts",
    },
  ],
};

// A at 80 (seat 0) acts first, then T at 70 (seat 1), in the valued phase.
const started = (turnOrder: TurnOrder = UNTIMED) =>
  run(
    createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 90,
      players: seats(3),
      turnOrder,
    }),
    { type: "START", at: 0 },
    add("a", 80, 0),
    add("t", 70, 1),
    phase("valued"),
  );

const statsOf = (state: GameSessionState) =>
  getPlayerStats(
    state.turns
      .filter((t) => t.playerIndex !== null)
      .map((t) => ({
        playerIndex: t.playerIndex as number,
        elapsedSeconds: t.elapsedSeconds,
        untimed: t.untimed,
      })),
  );

describe("untimed turns", () => {
  it("labels only the turns of an untimed kind", () => {
    const first = started();
    expect(active(first)).toBe("a");
    expect(selectUntimedTurnLabel(first)).toBeNull();

    const second = run(first, end("same", 40));
    expect(active(second)).toBe("t");
    expect(selectUntimedTurnLabel(second)).toBe("Everyone acts");
  });

  it("records the turn with no time, leaving the phase average and stats alone", () => {
    const afterTimed = run(started(), end("same", 40));
    const afterUntimed = run(afterTimed, end("same", 500));

    expect(afterUntimed.turns.at(-1)).toMatchObject({
      entryId: "t",
      playerIndex: 1,
      elapsedSeconds: 0,
      untimed: true,
    });
    expect(afterUntimed.averageSeconds).toBe(afterTimed.averageSeconds);
    expect(statsOf(afterUntimed)).toEqual(statsOf(afterTimed));
  });

  it("still applies the value step that ends the turn", () => {
    const afterUntimed = run(started(), end("same", 40), end("up", 500));
    expect(order(afterUntimed)).toContain("t80");
  });

  it("keeps the declared phase average when only untimed turns were played", () => {
    const state = run(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 90,
        players: seats(3),
        turnOrder: UNTIMED,
      }),
      { type: "START", at: 0 },
      add("t", 70, 1),
      phase("valued"),
      end("same", 500),
    );
    expect(state.averageSeconds).toBe(100);
  });

  it("undoing the untimed turn hands it back, still untimed", () => {
    const beforeEnd = run(started(), end("same", 40));
    const undone = run(beforeEnd, end("up", 500), { type: "UNDO" });

    expect(active(undone)).toBe("t");
    expect(selectUntimedTurnLabel(undone)).toBe("Everyone acts");
    expect(undone.turns).toEqual(beforeEnd.turns);
    expect(order(undone)).toEqual(order(beforeEnd));
    expect(undone.averageSeconds).toBe(beforeEnd.averageSeconds);
  });

  it("falls back to a generic label when the kind declares none", () => {
    const unlabelled: TurnOrder = {
      ...VALUED,
      entryKinds: [
        { id: "x", label: "Kind X" },
        { id: "y", label: "Kind Y", turnTiming: "untimed" },
      ],
    };
    expect(
      selectUntimedTurnLabel(run(started(unlabelled), end("same", 40))),
    ).toBe("Untimed");
  });
});
