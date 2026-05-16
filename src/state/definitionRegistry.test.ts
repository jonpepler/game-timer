import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
  requireDefinition,
} from "./definitionRegistry";
import { GAME_DEFINITION_SCHEMA_VERSION } from "./gameDefinition";

describe("definition registry", () => {
  it("lists the built-in definitions in a predictable order, starting with Generic", () => {
    const ids = listDefinitions().map((d) => d.id);
    expect(ids[0]).toBe(DEFAULT_DEFINITION_ID);
    expect(ids).toContain("root");
  });

  it("returns a fresh array so callers cannot mutate the built-in list", () => {
    const first = listDefinitions();
    first.pop();
    const second = listDefinitions();
    expect(second.length).toBe(first.length + 1);
  });

  it("findDefinition returns the matching definition or undefined", () => {
    expect(findDefinition("generic")?.id).toBe("generic");
    expect(findDefinition("nope")).toBeUndefined();
  });

  it("requireDefinition throws on unknown ids", () => {
    expect(() => requireDefinition("nope")).toThrow(/Unknown game definition/);
  });

  it("every built-in declares the current schema version", () => {
    for (const def of listDefinitions()) {
      expect(def.schemaVersion).toBe(GAME_DEFINITION_SCHEMA_VERSION);
    }
  });

  it("Root pressure-tests the schema: factions + score subsystem populated", () => {
    const root = requireDefinition("root");
    expect(root.factions?.length).toBeGreaterThanOrEqual(4);
    // Faction ids must be unique — they're used as foreign keys from
    // PlayerSlot and need to round-trip through JSON.
    const factionIds = root.factions!.map((f) => f.id);
    expect(new Set(factionIds).size).toBe(factionIds.length);
    expect(root.score?.max).toBe(30);
    expect(root.score?.victory?.type).toBe("firstToMax");
  });
});
