import { describe, expect, it } from "vitest";
import type { TurnOrder } from "./gameDefinition";
import { defaultNextPhaseId, phaseVisitsAfter } from "./turnLists";

const turnOrder: TurnOrder = {
  mode: "variable",
  lists: [{ id: "main", label: "Main", includePlayers: true }],
  phases: [
    { id: "open", label: "Open", list: "main" },
    { id: "work", label: "Work", list: "main", repeat: 2 },
    { id: "close", label: "Close", list: "main", next: "open" },
  ],
};

const walk = (path: string[]) => {
  let visits: Record<string, number> = { [path[0]]: 1 };
  for (let i = 1; i < path.length; i++) {
    visits = phaseVisitsAfter(turnOrder, visits, path[i - 1], path[i]);
  }
  const current = path[path.length - 1];
  return defaultNextPhaseId(turnOrder, current, visits[current]);
};

describe("default successor across a cycle", () => {
  it("repeats a phase until its repeat count, then moves on", () => {
    expect(walk(["open", "work"])).toBe("work");
    expect(walk(["open", "work", "work"])).toBe("close");
  });

  it("keeps counting a repeated phase when another phase is inserted between its visits", () => {
    expect(walk(["open", "work", "close", "work"])).toBe("close");
  });

  it("starts counting again when the cycle returns to its first phase", () => {
    expect(walk(["open", "work", "work", "close", "open", "work"])).toBe(
      "work",
    );
  });

  it("counts consecutive visits to the first phase too", () => {
    const visits = phaseVisitsAfter(turnOrder, { open: 1 }, "open", "open");
    expect(visits.open).toBe(2);
  });
});
