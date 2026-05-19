import { parseGameDefinition } from "../gameDefinition";
import data from "./generic.json";

// Parsed (and validated) at module load. A typo in the JSON throws a
// ZodError with the offending path before the rest of the app runs.
export const genericDefinition = parseGameDefinition(data);
