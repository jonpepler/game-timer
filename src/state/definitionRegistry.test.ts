import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  isBuiltIn,
  listDefinitions,
  requireDefinition,
} from "./definitionRegistry";
import { GAME_DEFINITION_SCHEMA_VERSION } from "./gameDefinition";
import { saveCustomDefinition } from "./customDefinitions";

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

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

  it("merges custom definitions from localStorage after the built-ins", () => {
    saveCustomDefinition({
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: "wingspan-abcd",
      name: "Wingspan",
      defaultExpectedTurns: 120,
      defaultAverageSeconds: 180,
    });
    const ids = listDefinitions().map((d) => d.id);
    expect(ids[0]).toBe(DEFAULT_DEFINITION_ID);
    expect(ids).toContain("root");
    expect(ids).toContain("wingspan-abcd");
    expect(findDefinition("wingspan-abcd")?.name).toBe("Wingspan");
  });

  it("custom definitions cannot shadow a built-in id", () => {
    saveCustomDefinition({
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: "root",
      name: "Pirate Root",
      defaultExpectedTurns: 50,
      defaultAverageSeconds: 100,
    });
    expect(findDefinition("root")?.name).toBe("Root");
  });

  it("isBuiltIn flags only the bundled definitions", () => {
    saveCustomDefinition({
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: "custom-abcd",
      name: "Custom",
      defaultExpectedTurns: 50,
      defaultAverageSeconds: 100,
    });
    expect(isBuiltIn("generic")).toBe(true);
    expect(isBuiltIn("root")).toBe(true);
    expect(isBuiltIn("custom-abcd")).toBe(false);
  });
});
