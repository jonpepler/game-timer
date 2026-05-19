import { describe, expect, it } from "vitest";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  parseGameDefinition,
  safeParseGameDefinition,
} from "./gameDefinition";

const minimalValid = {
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "generic",
  name: "Generic",
  defaultExpectedTurns: 90,
  defaultAverageSeconds: 300,
};

describe("GameDefinitionSchema", () => {
  it("parses a minimal definition", () => {
    const parsed = parseGameDefinition(minimalValid);
    expect(parsed.id).toBe("generic");
  });

  it("rejects a wrong schemaVersion literal", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      schemaVersion: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field with a useful path", () => {
    const { name: _name, ...withoutName } = minimalValid;
    const result = safeParseGameDefinition(withoutName);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name");
    }
  });

  it("validates a player-pick step's option array", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "side",
          label: "Side",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [
              { id: "a", label: "Alpha", color: "#fff" },
              { id: "b", label: "Beta", color: "#000", description: "Second." },
            ],
          },
        },
      ],
    });
    expect(parsed.setupSteps?.[0].kind.type).toBe("player-pick");
  });

  it("rejects a player-pick option missing its id", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "side",
          label: "Side",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [{ label: "Alpha" }],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("setupSteps"))).toBe(true);
    }
  });

  it("rejects an unknown score displayStyle", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      score: {
        displayStyle: "spiral",
        min: 0,
        increment: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it("parses a Root-shaped setupSteps array (every step kind)", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      id: "root",
      name: "Root",
      maxPlayers: 6,
      setupSteps: [
        {
          id: "map",
          label: "Map",
          kind: {
            type: "select-one",
            options: [{ id: "autumn", label: "Autumn" }],
          },
        },
        {
          id: "landmarks",
          label: "Landmarks",
          kind: { type: "select-count", min: 0, max: 2 },
        },
        {
          id: "draft",
          label: "Draft factions",
          kind: { type: "toggle", defaultValue: false },
        },
        {
          id: "faction",
          label: "Faction",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [
              { id: "vagabond", label: "Vagabond", color: "#aaa" },
              { id: "knaves", label: "Knaves", color: "#bbb" },
            ],
            constraints: [
              { type: "mutually-exclusive", optionIds: ["vagabond", "knaves"] },
            ],
          },
        },
      ],
    });
    expect(parsed.setupSteps).toHaveLength(4);
    expect(parsed.setupSteps?.[0].kind.type).toBe("select-one");
    expect(parsed.setupSteps?.[3].kind.type).toBe("player-pick");
    if (parsed.setupSteps?.[3].kind.type === "player-pick") {
      expect(parsed.setupSteps[3].kind.constraints).toEqual([
        { type: "mutually-exclusive", optionIds: ["vagabond", "knaves"] },
      ]);
    }
  });

  it("rejects an unknown setup-step kind", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "weird",
          label: "Weird",
          kind: { type: "summon-demon" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
