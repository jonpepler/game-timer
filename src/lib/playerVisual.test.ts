import { describe, expect, it } from "vitest";
import {
  fallbackColor,
  playerColor,
  playerOptionLabel,
  playerSubheading,
} from "./playerVisual";
import type { Player } from "@/state/gameSession";

const make = (name: string, metadata: Player["metadata"] = {}): Player => ({
  name,
  metadata,
});

const withFaction = (
  name: string,
  optionId: string,
  label: string,
  color: string,
): Player =>
  make(name, {
    faction: { type: "selected-option", optionId, label, color },
  });

describe("playerColor", () => {
  it("returns the metadata colour when the visualKey resolves", () => {
    const p = withFaction("Jon", "marquise", "Marquise de Cat", "#F39C2A");
    expect(playerColor(p, 0, "faction")).toBe("#F39C2A");
  });

  it("falls back to the positional palette when no metadata", () => {
    expect(playerColor(make("Player 1"), 0, undefined)).toBe(fallbackColor(0));
    expect(playerColor(make("Player 2"), 1, "faction")).toBe(fallbackColor(1));
  });

  it("ignores metadata of the wrong type", () => {
    const p = make("Player 1", {
      faction: { type: "scalar", value: "marquise" },
    });
    expect(playerColor(p, 0, "faction")).toBe(fallbackColor(0));
  });
});

describe("playerOptionLabel", () => {
  it("returns the metadata label", () => {
    const p = withFaction("Jon", "marquise", "Marquise de Cat", "#F39C2A");
    expect(playerOptionLabel(p, "faction")).toBe("Marquise de Cat");
  });

  it("returns undefined when nothing is attached", () => {
    expect(playerOptionLabel(make("Jon"), "faction")).toBeUndefined();
  });
});

describe("playerSubheading", () => {
  it("returns the option label as the subheading", () => {
    const p = withFaction("Jon", "marquise", "Marquise de Cat", "#F39C2A");
    expect(playerSubheading(p, "faction")).toBe("Marquise de Cat");
  });

  it("suppresses the subheading when it would duplicate the player's name", () => {
    const p = withFaction(
      "Marquise de Cat",
      "marquise",
      "Marquise de Cat",
      "#F39C2A",
    );
    expect(playerSubheading(p, "faction")).toBeUndefined();
  });

  it("returns undefined when the definition doesn't declare a subheading source", () => {
    const p = withFaction("Jon", "marquise", "Marquise de Cat", "#F39C2A");
    expect(playerSubheading(p, undefined)).toBeUndefined();
  });
});
