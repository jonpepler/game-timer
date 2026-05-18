import { describe, expect, it } from "vitest";
import {
  fromPeerId,
  generateSessionCode,
  toPeerId,
  buildCompanionUrl,
} from "./sessionCode";

describe("sessionCode", () => {
  it("generates codes of the shape word-word-NNN", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSessionCode()).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    }
  });

  it("round-trips through toPeerId / fromPeerId", () => {
    const code = "fox-river-042";
    const peerId = toPeerId(code);
    expect(peerId).toBe("gtmr-fox-river-042");
    expect(fromPeerId(peerId)).toBe(code);
  });

  it("fromPeerId is a no-op for non-prefixed ids (uuid fallback)", () => {
    expect(fromPeerId("abcdef-1234")).toBe("abcdef-1234");
  });

  it("buildCompanionUrl encodes the code into the companion path", () => {
    const url = buildCompanionUrl("fox-river-042");
    expect(url).toContain("/game-timer/companion?code=fox-river-042");
  });
});
