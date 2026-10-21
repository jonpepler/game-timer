import { describe, expect, it } from "vitest";
import { liftColor, oklabLightness } from "./liftColor";

describe("liftColor", () => {
  it("leaves light colours and non-hex colours alone", () => {
    expect(liftColor("#F2E6C4")).toBe("#F2E6C4");
    expect(liftColor("var(--color-text)")).toBe("var(--color-text)");
  });

  it("raises dark colours to the minimum lightness", () => {
    for (const dark of ["#3F5064", "#1a1a1a", "#000", "#2b1d3a"]) {
      const lifted = liftColor(dark);
      expect(lifted).not.toBe(dark);
      expect(oklabLightness(lifted)).toBeGreaterThanOrEqual(0.64);
    }
  });

  it("keeps the hue: a dark blue stays blue", () => {
    const lifted = liftColor("#1f2f6f");
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(lifted.slice(i, i + 2), 16),
    );
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
