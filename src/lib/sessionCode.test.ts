import { describe, expect, it } from "vitest";
import {
  fromPeerId,
  generateSessionCode,
  normaliseSessionCode,
  SESSION_CODE_LENGTH,
  toPeerId,
  buildCompanionUrl,
} from "./sessionCode";

const ALPHABET_RX = /^[ACEFHJKMNPRTUVWXY3479]+$/;

describe("sessionCode", () => {
  it("generates 4-character codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSessionCode();
      expect(code).toHaveLength(SESSION_CODE_LENGTH);
      expect(code).toMatch(ALPHABET_RX);
    }
  });

  it("never emits a known look-alike character", () => {
    // Sanity-check: sample 200 codes, confirm none contain any of
    // the excluded confusables. Caught a regression where the
    // alphabet drift-included e.g. O.
    const forbidden = new Set("01258 6 BDGILOQSZ".replace(/\s/g, ""));
    for (let i = 0; i < 200; i++) {
      for (const ch of generateSessionCode()) {
        expect(forbidden.has(ch)).toBe(false);
      }
    }
  });

  it("round-trips through toPeerId / fromPeerId", () => {
    const code = "K3WP";
    const peerId = toPeerId(code);
    expect(peerId).toBe("gtmr-K3WP");
    expect(fromPeerId(peerId)).toBe("K3WP");
  });

  it("normaliseSessionCode upper-cases + strips whitespace and punctuation", () => {
    expect(normaliseSessionCode(" k3wp ")).toBe("K3WP");
    expect(normaliseSessionCode("k3-wp")).toBe("K3WP");
    expect(normaliseSessionCode("K3.W.P")).toBe("K3WP");
  });

  it("toPeerId normalises before prefixing so user-typed codes work", () => {
    expect(toPeerId(" k3wp ")).toBe("gtmr-K3WP");
  });

  it("fromPeerId is a no-op for non-prefixed ids (uuid fallback)", () => {
    expect(fromPeerId("abcdef-1234")).toBe("abcdef-1234");
  });

  it("buildCompanionUrl encodes the code into the companion path", () => {
    const url = buildCompanionUrl("K3WP");
    expect(url).toContain("/game-timer/companion?code=K3WP");
  });
});
