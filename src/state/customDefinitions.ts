import { clearKey, loadJson, saveJson } from "@/lib/storage";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type GameDefinition,
} from "./gameDefinition";

const STORAGE_KEY = "definitions";
const SCHEMA_VERSION = 1;

interface PersistedDefinitions {
  schemaVersion: typeof SCHEMA_VERSION;
  definitions: GameDefinition[];
}

const loadAll = (): GameDefinition[] => {
  const persisted = loadJson<PersistedDefinitions>(STORAGE_KEY);
  if (!persisted) return [];
  if (persisted.schemaVersion !== SCHEMA_VERSION) return [];
  // Drop entries whose own definition-schemaVersion is newer than what
  // we know how to render.
  return persisted.definitions.filter(
    (d) => d.schemaVersion === GAME_DEFINITION_SCHEMA_VERSION,
  );
};

const saveAll = (definitions: GameDefinition[]): void => {
  saveJson(STORAGE_KEY, {
    schemaVersion: SCHEMA_VERSION,
    definitions,
  } satisfies PersistedDefinitions);
};

export const listCustomDefinitions = (): GameDefinition[] => loadAll();

export const findCustomDefinition = (
  id: string,
): GameDefinition | undefined => loadAll().find((d) => d.id === id);

export const saveCustomDefinition = (def: GameDefinition): void => {
  const all = loadAll();
  const next = [...all.filter((d) => d.id !== def.id), def];
  saveAll(next);
};

export const deleteCustomDefinition = (id: string): void => {
  const all = loadAll().filter((d) => d.id !== id);
  if (all.length === 0) {
    clearKey(STORAGE_KEY);
    return;
  }
  saveAll(all);
};

// id helper — slug + short random suffix so concurrent edits don't
// collide if a user opens two tabs.
export const generateDefinitionId = (name: string): string => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "custom";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
};
