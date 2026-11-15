import { loadGameDefinitionWithModules } from "../gameDefinition";
import { parseGameTheme } from "../gameTheme";
import structure from "./oath/definition.json";
import modules from "./oath/modules.json";
import theme from "./oath/theme.json";

export const oathDefinition = loadGameDefinitionWithModules(structure, modules);

export const oathTheme = parseGameTheme(theme);
