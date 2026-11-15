import { describe, expect, it } from "vitest";
import { visibleSetupSteps } from "../gameDefinition";
import { builtInDefinitions } from "./index";

/*
 * Oath: New Foundations rules held in config. Cites are to the Buried
 * Giant online rules (OR, section) and the June 2026 combined rulebook
 * (RB, printed page).
 */

const oath = () => {
  const def = builtInDefinitions.find((d) => d.id === "oath");
  if (!def) throw new Error("oath is not a built-in definition");
  return def;
};

const step = (id: string) => oath().setupSteps?.find((s) => s.id === id)?.kind;

describe("Oath rules held in config", () => {
  it("RB p2: seats two to seven players, one per player board", () => {
    expect(step("seating")).toMatchObject({
      type: "seat-players",
      minPlayers: 2,
      maxPlayers: 7,
    });
    expect(oath().maxPlayers).toBe(7);
  });

  it("RB p2 (WNF p6): offers the seven player colours, pink and brown included", () => {
    const seating = step("seating");
    if (seating?.type !== "seat-players") throw new Error("no seating step");
    expect(seating.colorOptions?.map((o) => o.label)).toEqual([
      "White",
      "Red",
      "Blue",
      "Yellow",
      "Black",
      "Pink",
      "Brown",
    ]);
  });

  it("OR §4 (RB p9): with no Empire, the first player is chosen at random", () => {
    expect(step("first-player")).toMatchObject({
      type: "select-lead",
      defaultLead: "random",
    });
  });

  it("OR §4 (RB p9): the first player step only shows when there is no Chancellor", () => {
    const ids = (seatIndices: number[]) =>
      visibleSetupSteps(oath(), {
        chancellor: { kind: "assign-role", seatIndices },
      }).map((s) => s.id);
    expect(ids([])).toContain("first-player");
    expect(ids([1])).not.toContain("first-player");
  });

  it("OR §6 (RB p17): play passes clockwise, in seat order", () => {
    expect(oath().turnOrder?.mode).toBe("lead-relative");
    expect(oath().turnOrder?.direction ?? "seat-order").toBe("seat-order");
  });
});
