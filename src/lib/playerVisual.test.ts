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

const withPick = (
  name: string,
  optionId: string,
  label: string,
  color: string,
): Player =>
  make(name, {
    pick: { type: "selected-option", optionId, label, color },
  });

describe("playerColor", () => {
  it("returns the metadata colour when the visualKey resolves", () => {
    const p = withPick("Jon", "red", "Red Team", "#F39C2A");
    expect(playerColor(p, 0, "pick")).toBe("#F39C2A");
  });

  it("falls back to the positional palette when no metadata", () => {
    expect(playerColor(make("Player 1"), 0, undefined)).toBe(fallbackColor(0));
    expect(playerColor(make("Player 2"), 1, "pick")).toBe(fallbackColor(1));
  });

  it("ignores metadata of the wrong type", () => {
    const p = make("Player 1", {
      pick: { type: "scalar", value: "red" },
    });
    expect(playerColor(p, 0, "pick")).toBe(fallbackColor(0));
  });
});

describe("playerOptionLabel", () => {
  it("returns the metadata label", () => {
    const p = withPick("Jon", "red", "Red Team", "#F39C2A");
    expect(playerOptionLabel(p, "pick")).toBe("Red Team");
  });

  it("returns undefined when nothing is attached", () => {
    expect(playerOptionLabel(make("Jon"), "pick")).toBeUndefined();
  });
});

describe("playerSubheading", () => {
  it("returns the option label as the subheading", () => {
    const p = withPick("Jon", "red", "Red Team", "#F39C2A");
    expect(playerSubheading(p, "pick")).toBe("Red Team");
  });

  it("suppresses the subheading when it would duplicate the player's name", () => {
    const p = withPick("Red Team", "red", "Red Team", "#F39C2A");
    expect(playerSubheading(p, "pick")).toBeUndefined();
  });

  it("returns undefined when the definition doesn't declare a subheading source", () => {
    const p = withPick("Jon", "red", "Red Team", "#F39C2A");
    expect(playerSubheading(p, undefined)).toBeUndefined();
  });
});
