import { loadGameDefinitionWithModules } from "../gameDefinition";
import structure from "./root/definition.json";
import modules from "./root/modules.json";

export const rootDefinition = loadGameDefinitionWithModules(structure, modules);
