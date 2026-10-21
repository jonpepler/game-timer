import type { GameDefinition } from "../gameDefinition";
import type { BundledTheme } from "../gameTheme";
import { arcsDefinition, arcsTheme } from "./arcs";
import { genericDefinition } from "./generic";
import { railwaysDefinition, railwaysTheme } from "./railways";
import { rootDefinition } from "./root";

/**
 * Every definition bundled with the app, in picker order. Generic comes
 * first and is the default. Adding a built-in game means adding it here;
 * nothing outside this folder names a game.
 */
export const builtInDefinitions: readonly GameDefinition[] = Object.freeze([
  genericDefinition,
  rootDefinition,
  arcsDefinition,
  railwaysDefinition,
]);

/** Themes bundled with built-in definitions. A game without one keeps the default look. */
export const builtInThemes: readonly BundledTheme[] = Object.freeze([
  { definitionId: arcsDefinition.id, theme: arcsTheme },
  { definitionId: railwaysDefinition.id, theme: railwaysTheme },
]);
