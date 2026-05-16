import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type GameDefinition,
} from "../gameDefinition";

export const rootDefinition: GameDefinition = {
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "root",
  name: "Root",
  description:
    "Asymmetric woodland strategy by Leder Games. First faction to 30 wins.",
  defaultExpectedTurns: 80,
  defaultAverageSeconds: 240,
  factions: [
    { id: "marquise", name: "Marquise de Cat", color: "#E8C547" },
    { id: "eyrie", name: "Eyrie Dynasties", color: "#47B8E8" },
    { id: "alliance", name: "Woodland Alliance", color: "#7BE847" },
    { id: "vagabond", name: "Vagabond", color: "#D9D9D9" },
    { id: "lizard", name: "Lizard Cult", color: "#E847B8" },
    { id: "riverfolk", name: "Riverfolk Company", color: "#9E47E8" },
    { id: "underground", name: "Underground Duchy", color: "#B0651E" },
    { id: "corvids", name: "Corvid Conspiracy", color: "#6E6E6E" },
  ],
  score: {
    displayStyle: "linearTrack",
    min: 0,
    max: 30,
    increment: 1,
    victory: { type: "firstToMax" },
  },
};
