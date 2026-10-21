import { describe, expect, it } from "vitest";
import {
  effectiveScoreMax,
  optionVisibleUnderContext,
  visibleSetupSteps,
} from "../gameDefinition";
import { arcsDefinition } from "./arcs";

describe("arcs definition", () => {
  it("loads with lead-relative initiative and the seize control", () => {
    expect(arcsDefinition.id).toBe("arcs");
    expect(arcsDefinition.turnOrder?.mode).toBe("lead-relative");
    expect(arcsDefinition.controls).toEqual([
      expect.objectContaining({
        id: "seize",
        label: "Seize the initiative",
        effect: { type: "claim-next-lead" },
      }),
    ]);
    expect(arcsDefinition.turnOrder?.roundEnd?.type).toBe("prompt-lead");
    expect(arcsDefinition.playerVisualFrom).toBe("leader");
  });

  it("resolves 16 leaders, each with a portrait head icon", () => {
    const step = arcsDefinition.setupSteps?.find((s) => s.id === "leader");
    expect(step?.kind.type).toBe("player-pick");
    if (step?.kind.type !== "player-pick") return;
    expect(step.kind.options).toHaveLength(16);
    expect(step.kind.pickOrder).toBe("reverse-seat");
    expect(step.kind.draft).toEqual({ dealExtra: 1 });
    for (const opt of step.kind.options) {
      const head = (
        opt as { assets?: { headIcon?: Array<{ appPath?: string }> } }
      ).assets?.headIcon?.[0]?.appPath;
      expect(head).toMatch(/^games\/arcs\/leaders\/.+\.png$/);
    }
  });

  it("swaps the core placement step for the Leaders & Lore steps on the toggle", () => {
    const stepIds = (leadersLore: boolean, selectedIds: string[]) =>
      visibleSetupSteps(arcsDefinition, {
        modules: { kind: "multi-toggle", selectedIds },
        "leaders-lore": { kind: "toggle", value: leadersLore },
      }).map((s) => s.id);
    const leaderSteps = ["draft-leaders", "leader", "place-leader"];

    // The base box has its own 8 Leaders, so the mode does not need the Pack.
    for (const modules of [["base"], ["base", "leadersLorePack"]]) {
      const withLore = stepIds(true, modules);
      expect(withLore).toEqual(expect.arrayContaining(leaderSteps));
      expect(withLore).not.toContain("starting-pieces");

      // The Pack with the toggle off changes nothing: its only content is
      // Leaders, and the Leader step is hidden.
      const core = stepIds(false, modules);
      expect(core).toContain("starting-pieces");
      for (const id of leaderSteps) expect(core).not.toContain(id);
    }
  });

  it("offers the 8 base Leaders, plus 8 more with the Pack", () => {
    const step = arcsDefinition.setupSteps?.find((s) => s.id === "leader");
    if (step?.kind.type !== "player-pick") throw new Error("no leader step");
    const options = step.kind.options;
    const pool = (selectedIds: string[]) =>
      options
        .filter((o) =>
          optionVisibleUnderContext(o, {
            modules: { kind: "multi-toggle", selectedIds },
          }),
        )
        .map((o) => o.label);
    expect(pool(["base"])).toEqual([
      "Elder",
      "Mystic",
      "Fuel-Drinker",
      "Upstart",
      "Rebel",
      "Warrior",
      "Feastbringer",
      "Demagogue",
    ]);
    expect(pool(["base", "leadersLorePack"])).toHaveLength(16);
  });

  it("offers five seat colours and reads player colour from seating", () => {
    const step = arcsDefinition.setupSteps?.find((s) => s.id === "seating");
    expect(step?.kind.type).toBe("seat-players");
    if (step?.kind.type !== "seat-players") return;
    expect(step.kind.colorOptions?.map((o) => o.label)).toEqual([
      "Red",
      "Blue",
      "Yellow",
      "White",
      "Pink",
    ]);
    expect(arcsDefinition.playerColorFrom).toBe("seating");
  });

  it("declares a select-lead initiative step", () => {
    const step = arcsDefinition.setupSteps?.find((s) => s.id === "initiative");
    expect(step?.kind.type).toBe("select-lead");
  });

  it("scales the victory threshold with player count", () => {
    expect(effectiveScoreMax(arcsDefinition.score, 2)).toBe(33);
    expect(effectiveScoreMax(arcsDefinition.score, 3)).toBe(30);
    expect(effectiveScoreMax(arcsDefinition.score, 4)).toBe(27);
    // Unknown counts fall back to the flat max.
    expect(effectiveScoreMax(arcsDefinition.score, 5)).toBe(30);
  });
});

describe("Arcs rules held in config", () => {
  const step = (id: string) =>
    arcsDefinition.setupSteps?.find((s) => s.id === id)?.kind;

  it("p.4 Setup 1.B: the initiative marker goes to a random player", () => {
    expect(step("initiative")).toMatchObject({
      type: "select-lead",
      defaultLead: "random",
    });
  });

  it("p.21 Leaders & Lore: the draft starts to the right of the initiative player and goes counterclockwise", () => {
    expect(step("leader")).toMatchObject({
      pickOrder: "reverse-seat",
      pickFrom: "lead",
    });
  });
});
