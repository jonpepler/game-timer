import { describe, expect, it } from "vitest";
import { combinesFromHistory } from "./combineHistory";
import type { GameSessionAction } from "./gameSession";
import type { TurnEntry, ValuePoint } from "./turnLists";
import { end, run, threeEntries } from "./valuedFixture";

const entry = (id: string, label: string, lineage?: string[]): TurnEntry => ({
  id,
  label,
  playerIndex: null,
  ...(lineage ? { nameParts: { title: label, lineage } } : {}),
});

const point = (entryId: string, turn: number, value = 50): ValuePoint => ({
  entryId,
  turn,
  value,
});

describe("combinesFromHistory", () => {
  it("links each source named in a lineage to the target at its first value", () => {
    const links = combinesFromHistory(
      [
        entry("a", "Alpha"),
        entry("b", "Bravo"),
        entry("t", "Target", ["Alpha", "Bravo"]),
      ],
      [
        point("a", 0),
        point("b", 1),
        point("a", 4),
        point("t", 6),
        point("t", 9),
      ],
    );
    expect(Object.fromEntries(links)).toEqual({
      a: { entryId: "t", turn: 6 },
      b: { entryId: "t", turn: 6 },
    });
  });

  it("skips a name with no value history, such as a stand-in", () => {
    const links = combinesFromHistory(
      [
        entry("a", "Alpha"),
        entry("x", "Extra"),
        entry("t", "Target", ["Alpha", "Extra", "Ghost"]),
      ],
      [point("a", 0), point("t", 3)],
    );
    expect([...links.keys()]).toEqual(["a"]);
  });

  it("skips a name shared by more than one charted entry", () => {
    const links = combinesFromHistory(
      [
        entry("a", "Alpha"),
        entry("a2", "Alpha"),
        entry("b", "Bravo"),
        entry("t", "Target", ["Alpha", "Bravo"]),
      ],
      [point("a", 0), point("a2", 0), point("b", 0), point("t", 3)],
    );
    expect([...links.keys()]).toEqual(["b"]);
  });

  it("takes the target's first value after its sources stopped, not an earlier one", () => {
    const links = combinesFromHistory(
      [entry("a", "Alpha"), entry("t", "Target", ["Alpha"])],
      [point("t", 1), point("a", 2), point("a", 5), point("t", 7)],
    );
    expect(links.get("a")).toEqual({ entryId: "t", turn: 7 });
  });

  it("links nothing when the target has no value since its sources stopped", () => {
    const links = combinesFromHistory(
      [entry("a", "Alpha"), entry("t", "Target", ["Alpha"])],
      [point("t", 1), point("a", 2)],
    );
    expect(links.size).toBe(0);
  });

  it("reads back a combine made through the session", () => {
    const combine: GameSessionAction = {
      type: "COMBINE_TURN_ENTRIES",
      sourceIds: ["s1", "b", "c"],
      targetId: "t",
      playerIndex: 2,
      value: 70,
      at: 0,
    };
    const s = run(threeEntries(), end("up"), end("up"), combine);
    const links = combinesFromHistory(
      s.turnEntries ?? [],
      s.valueHistory ?? [],
    );
    expect(Object.fromEntries(links)).toEqual({
      b: { entryId: "t", turn: 2 },
      c: { entryId: "t", turn: 2 },
    });
  });
});
