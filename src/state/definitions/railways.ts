import { loadGameDefinitionWithModules } from "../gameDefinition";
import { parseGameTheme } from "../gameTheme";
import structure from "./railways/definition.json";
import modules from "./railways/modules.json";
import sounds from "./railways/sounds.json";
import theme from "./railways/theme.json";

export const railwaysDefinition = loadGameDefinitionWithModules(
  { ...structure, sounds },
  modules,
);

export const railwaysTheme = parseGameTheme(theme);
