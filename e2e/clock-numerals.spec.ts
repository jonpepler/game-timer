import { expect, test } from "@playwright/test";
import { NUMERAL_METRICS } from "../src/state/clockFace";

/*
 * The clock's numeral faces, measured in the real bundled fonts: a face
 * the clock sets as running text must have tabular figures (every digit
 * within 2% of the widest), and a face without them must be marked for
 * fixed-pitch cells. The stored digit advance must match the font.
 */

const FACES = [
  ["inter-600", "--font-inter", 600],
  ["old-standard-700", "--font-type-serif", 700],
  ["big-shoulders-800", "--font-type-condensed", 800],
] as const;

for (const [face, variable, weight] of FACES) {
  test(`${face} figures keep the clock steady`, async ({ page }) => {
    await page.goto("/game-timer/timer");
    const measured = await page.evaluate(
      async ({ variable, weight }) => {
        const family = getComputedStyle(document.documentElement)
          .getPropertyValue(variable)
          .trim();
        await document.fonts.load(`${weight} 40px ${family}`, "0123456789:+");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.style.cssText = "position:absolute;width:500px;height:500px";
        document.body.appendChild(svg);
        const width = (glyph: string) => {
          const t = document.createElementNS(ns, "text");
          t.setAttribute("font-size", "20");
          t.style.cssText = `font-family:${family};font-weight:${weight};font-variant-numeric:tabular-nums`;
          t.textContent = glyph;
          svg.appendChild(t);
          return t.getComputedTextLength() / 20;
        };
        const digits = "0123456789".split("").map(width);
        svg.remove();
        return {
          digits,
          loaded: document.fonts.check(`${weight} 20px ${family}`),
        };
      },
      { variable, weight },
    );
    expect(measured.loaded).toBe(true);
    const widest = Math.max(...measured.digits);
    const spread = (widest - Math.min(...measured.digits)) / widest;
    const metrics = NUMERAL_METRICS[face];
    if (metrics.cellMode) expect(spread).toBeGreaterThan(0.02);
    else expect(spread).toBeLessThanOrEqual(0.02);
    expect(
      Math.abs(widest - metrics.cell.digit) / metrics.cell.digit,
    ).toBeLessThan(0.03);
  });
}
