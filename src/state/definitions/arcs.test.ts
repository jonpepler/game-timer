import { describe, expect, it } from "vitest";
import { effectiveScoreMax } from "../gameDefinition";
import { arcsDefinition } from "./arcs";

describe("arcs definition", () => {
  it("loads with lead-relative initiative + seize interrupt", () => {
    expect(arcsDefinition.id).toBe("arcs");
    expect(arcsDefinition.turnOrder?.mode).toBe("lead-relative");
    expect(arcsDefinition.turnOrder?.interrupt?.effect).toBe("claim-next-lead");
    expect(arcsDefinition.turnOrder?.roundEnd?.type).toBe("prompt-lead");
    expect(arcsDefinition.playerVisualFrom).toBe("leader");
  });

  it("resolves 16 leaders, each with a portrait head icon", () => {
    const step = arcsDefinition.setupSteps?.find((s) => s.id === "leader");
    expect(step?.kind.type).toBe("player-pick");
    if (step?.kind.type !== "player-pick") return;
    expect(step.kind.options).toHaveLength(16);
    for (const opt of step.kind.options) {
      const head = (
        opt as { assets?: { headIcon?: Array<{ appPath?: string }> } }
      ).assets?.headIcon?.[0]?.appPath;
      expect(head).toMatch(/^games\/arcs\/leaders\/.+\.png$/);
    }
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
