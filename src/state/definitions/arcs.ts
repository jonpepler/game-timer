import { loadGameDefinitionWithModules } from "../gameDefinition";
import { parseGameTheme } from "../gameTheme";
import structure from "./arcs/definition.json";
import modules from "./arcs/modules.json";
import theme from "./arcs/theme.json";

export const arcsDefinition = loadGameDefinitionWithModules(structure, modules);

export const arcsTheme = parseGameTheme(theme);
