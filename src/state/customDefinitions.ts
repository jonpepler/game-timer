import { clearKey, loadJson, saveJson } from "@/lib/storage";
import { safeParseGameDefinition, type GameDefinition } from "./gameDefinition";
import { createLogger } from "@/lib/logger";

const log = createLogger("custom-definitions");

const STORAGE_KEY = "definitions";
const SCHEMA_VERSION = 1;

interface PersistedDefinitions {
  schemaVersion: typeof SCHEMA_VERSION;
  // Raw JSON; we re-parse on load so a stored definition that no
  // longer conforms is dropped rather than crashing the app.
  definitions: unknown[];
}

const loadAll = (): GameDefinition[] => {
  const persisted = loadJson<PersistedDefinitions>(STORAGE_KEY);
  if (!persisted) return [];
  if (persisted.schemaVersion !== SCHEMA_VERSION) return [];
  const out: GameDefinition[] = [];
  for (const raw of persisted.definitions) {
    const result = safeParseGameDefinition(raw);
    if (result.success) {
      out.push(result.data);
    } else {
      log.warn("dropping persisted definition that failed validation", {
        issues: result.error.issues,
      });
    }
  }
  return out;
};

const saveAll = (definitions: GameDefinition[]): void => {
  saveJson(STORAGE_KEY, {
    schemaVersion: SCHEMA_VERSION,
    definitions,
  } satisfies PersistedDefinitions);
};

export const listCustomDefinitions = (): GameDefinition[] => loadAll();

export const findCustomDefinition = (id: string): GameDefinition | undefined =>
  loadAll().find((d) => d.id === id);

export const saveCustomDefinition = (def: GameDefinition): void => {
  // Parse-validate again at the save boundary as belt-and-braces. If
  // the in-memory object is malformed (e.g. dynamic editor state),
  // throw before persisting.
  const result = safeParseGameDefinition(def);
  if (!result.success) {
    throw new Error(
      `Refusing to save invalid GameDefinition: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const all = loadAll();
  const next = [...all.filter((d) => d.id !== result.data.id), result.data];
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
