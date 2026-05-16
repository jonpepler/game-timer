import type { GameDefinition } from "./gameDefinition";
import { genericDefinition } from "./definitions/generic";
import { rootDefinition } from "./definitions/root";

// Built-in definitions bundled with the app. User-imported definitions
// will be merged in here later via localStorage and file import.
const BUILT_INS: readonly GameDefinition[] = Object.freeze([
  genericDefinition,
  rootDefinition,
]);

export const DEFAULT_DEFINITION_ID = genericDefinition.id;

export const listDefinitions = (): GameDefinition[] => [...BUILT_INS];

export const findDefinition = (id: string): GameDefinition | undefined =>
  BUILT_INS.find((d) => d.id === id);

export const requireDefinition = (id: string): GameDefinition => {
  const found = findDefinition(id);
  if (!found) {
    throw new Error(`Unknown game definition: ${id}`);
  }
  return found;
};
