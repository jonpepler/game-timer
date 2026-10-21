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

// A bundled game other than the default, whichever the registry lists.
const bundled = listDefinitions().find((d) => d.id !== DEFAULT_DEFINITION_ID);
if (!bundled) throw new Error("expected a bundled game besides the default");

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("definition registry", () => {
  it("lists the built-in definitions in a predictable order, starting with Generic", () => {
    const ids = listDefinitions().map((d) => d.id);
    expect(ids[0]).toBe(DEFAULT_DEFINITION_ID);
    expect(ids).toContain(bundled.id);
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
    expect(ids).toContain(bundled.id);
    expect(ids).toContain("wingspan-abcd");
    expect(findDefinition("wingspan-abcd")?.name).toBe("Wingspan");
  });

  it("custom definitions cannot shadow a built-in id", () => {
    saveCustomDefinition({
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: bundled.id,
      name: `Pirate ${bundled.name}`,
      defaultExpectedTurns: 50,
      defaultAverageSeconds: 100,
    });
    expect(findDefinition(bundled.id)?.name).toBe(bundled.name);
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
    expect(isBuiltIn(bundled.id)).toBe(true);
    expect(isBuiltIn("custom-abcd")).toBe(false);
  });
});
