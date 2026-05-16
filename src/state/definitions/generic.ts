import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type GameDefinition,
} from "../gameDefinition";

export const genericDefinition: GameDefinition = {
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "generic",
  name: "Generic",
  description:
    "A neutral game timer with no factions or score tracking. Suits any board game.",
  defaultExpectedTurns: 90,
  defaultAverageSeconds: 300,
};
