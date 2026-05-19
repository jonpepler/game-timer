import { parseGameDefinition } from "../gameDefinition";
import data from "./root.json";

// TODO: confirm faction colours when art for the Marauders and Homeland
// expansions is publicly available — the Marauders pair (Keepers, Lord
// of the Hundreds) and the Homeland three (Lilypad, Twilight, Knaves)
// are best-guess values. The base + Riverfolk + Underworld eight are
// cross-checked against community sources.
export const rootDefinition = parseGameDefinition(data);
