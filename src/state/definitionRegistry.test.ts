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

  it("Root pressure-tests the schema: full player-pick roster + score subsystem", () => {
    const root = requireDefinition("root");
    const pickStep = root.setupSteps?.find(
      (s) => s.kind.type === "player-pick",
    );
    expect(pickStep).toBeDefined();
    if (pickStep && pickStep.kind.type === "player-pick") {
      // All 13 official factions across base + four expansions
      // (Riverfolk, Underworld, Marauders, Homeland). Update if Leder
      // publishes more.
      expect(pickStep.kind.options).toHaveLength(13);
      // Option ids must be unique — they're foreign keys for player
      // metadata + the mutex constraint references.
      const ids = pickStep.kind.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Mutex pair (Vagabond ↔ Knaves) declared on the step.
      expect(pickStep.kind.constraints).toContainEqual({
        type: "mutually-exclusive",
        optionIds: ["vagabond", "knaves"],
      });
    }
    // maxPlayers caps the table even though there are 13 options to
    // pick from.
    expect(root.maxPlayers).toBe(6);
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
