import type { GameDefinition } from "./gameDefinition";
import { builtInDefinitions } from "./definitions";
import { genericDefinition } from "./definitions/generic";
import { listCustomDefinitions } from "./customDefinitions";

const BUILT_INS: readonly GameDefinition[] = builtInDefinitions;

export const DEFAULT_DEFINITION_ID = BUILT_INS[0].id;

// Built-ins first (Generic by convention is the default), then custom
// in storage order. Custom definitions can't override built-ins:
// duplicate ids are skipped.
export const listDefinitions = (): GameDefinition[] => {
  const builtInIds = new Set(BUILT_INS.map((d) => d.id));
  const custom = listCustomDefinitions().filter((d) => !builtInIds.has(d.id));
  return [...BUILT_INS, ...custom];
};

export const isBuiltIn = (id: string): boolean =>
  BUILT_INS.some((d) => d.id === id);

export const findDefinition = (id: string): GameDefinition | undefined =>
  listDefinitions().find((d) => d.id === id);

export const requireDefinition = (id: string): GameDefinition => {
  const found = findDefinition(id);
  if (!found) {
    throw new Error(`Unknown game definition: ${id}`);
  }
  return found;
};
