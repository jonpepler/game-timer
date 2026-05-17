import { afterEach, describe, expect, it } from "vitest";
import {
  deleteCustomDefinition,
  findCustomDefinition,
  generateDefinitionId,
  listCustomDefinitions,
  saveCustomDefinition,
} from "./customDefinitions";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type GameDefinition,
} from "./gameDefinition";

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

const make = (overrides: Partial<GameDefinition> = {}): GameDefinition => ({
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "wing-1234",
  name: "Wingspan",
  defaultExpectedTurns: 120,
  defaultAverageSeconds: 180,
  ...overrides,
});

describe("custom definitions", () => {
  it("returns an empty list when nothing saved", () => {
    expect(listCustomDefinitions()).toEqual([]);
  });

  it("round-trips through localStorage", () => {
    saveCustomDefinition(make());
    expect(listCustomDefinitions()).toEqual([make()]);
  });

  it("saveCustomDefinition replaces an existing entry with the same id", () => {
    saveCustomDefinition(make({ name: "Wingspan v1" }));
    saveCustomDefinition(make({ name: "Wingspan v2" }));
    const all = listCustomDefinitions();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Wingspan v2");
  });

  it("findCustomDefinition returns the matching entry or undefined", () => {
    saveCustomDefinition(make());
    expect(findCustomDefinition("wing-1234")?.name).toBe("Wingspan");
    expect(findCustomDefinition("nope")).toBeUndefined();
  });

  it("deleteCustomDefinition removes the entry and clears the key when empty", () => {
    saveCustomDefinition(make());
    saveCustomDefinition(make({ id: "other-5678", name: "Catan" }));
    deleteCustomDefinition("wing-1234");
    expect(listCustomDefinitions().map((d) => d.id)).toEqual(["other-5678"]);
    deleteCustomDefinition("other-5678");
    expect(listCustomDefinitions()).toEqual([]);
    expect(window.localStorage.getItem("game-timer:v1:definitions")).toBeNull();
  });

  it("drops definitions persisted under a different definition-schemaVersion", () => {
    window.localStorage.setItem(
      "game-timer:v1:definitions",
      JSON.stringify({
        schemaVersion: 1,
        definitions: [{ ...make(), schemaVersion: 999 }],
      }),
    );
    expect(listCustomDefinitions()).toEqual([]);
  });

  it("returns empty when the outer envelope is at a different version", () => {
    window.localStorage.setItem(
      "game-timer:v1:definitions",
      JSON.stringify({ schemaVersion: 999, definitions: [make()] }),
    );
    expect(listCustomDefinitions()).toEqual([]);
  });

  it("generateDefinitionId slugifies the name and appends a short suffix", () => {
    const id = generateDefinitionId("Wingspan: European Expansion");
    expect(id).toMatch(/^wingspan-european-expansion-[a-z0-9]{4}$/);
  });

  it("generateDefinitionId falls back to 'custom' for empty names", () => {
    expect(generateDefinitionId("")).toMatch(/^custom-[a-z0-9]{4}$/);
    expect(generateDefinitionId("!!!")).toMatch(/^custom-[a-z0-9]{4}$/);
  });
});
