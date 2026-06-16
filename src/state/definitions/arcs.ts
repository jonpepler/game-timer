import { loadGameDefinitionWithModules } from "../gameDefinition";
import structure from "./arcs/definition.json";
import modules from "./arcs/modules.json";

export const arcsDefinition = loadGameDefinitionWithModules(structure, modules);
