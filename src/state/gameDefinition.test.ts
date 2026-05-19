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

  it("validates a factions array with shape", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      factions: [
        { id: "a", name: "Alpha", color: "#fff" },
        { id: "b", name: "Beta", color: "#000", description: "Second." },
      ],
    });
    expect(parsed.factions).toHaveLength(2);
  });

  it("rejects a faction missing colour", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      factions: [{ id: "a", name: "Alpha" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("factions"))).toBe(true);
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

  it("parses Root-shaped setupSchema with mutex tuples", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      id: "root",
      name: "Root",
      maxPlayers: 6,
      factions: [
        { id: "vagabond", name: "Vagabond", color: "#aaa" },
        { id: "knaves", name: "Knaves", color: "#bbb" },
      ],
      setupSchema: {
        maps: [{ id: "autumn", name: "Autumn" }],
        decks: [{ id: "base", name: "Base" }],
        landmarks: { maxAllowed: 2 },
        hirelings: { maxAllowed: 3 },
        factionConstraints: {
          mutuallyExclusive: [["vagabond", "knaves"]],
        },
        allowDraft: true,
      },
    });
    expect(parsed.setupSchema?.factionConstraints?.mutuallyExclusive).toEqual([
      ["vagabond", "knaves"],
    ]);
  });
});
