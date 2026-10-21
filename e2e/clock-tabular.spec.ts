import { expect, test } from "@playwright/test";

/*
 * The clock's figures never shift as they tick, in every bundled theme and
 * its real font: the readout is set in turn to every time from 00:00 to
 * 59:59, and to the same in overtime, and each character's centre must
 * stay put. A face with proportional figures moves them by a tenth of a
 * figure or more; the tolerance is a fiftieth. The bundled faces are
 * tabular by default, so each run also measures a face with proportional
 * figures as a control, proving the measure would catch one.
 */

const GAMES = [
  ["the default theme", "generic"],
  ["the railways theme", "railways"],
  ["the arcs theme", "arcs"],
] as const;

for (const [name, game] of GAMES) {
  test(`${name}: the readout keeps its width from 00:00 to 59:59`, async ({
    page,
  }) => {
    await page.goto("/game-timer/timer");
    await page.getByLabel(/^Game$/).selectOption(game);
    const value = page.locator('[data-slot="value"] text').first();
    await expect(value).toBeVisible();
    const drift = await value.evaluate(async (el: SVGTextElement) => {
      await document.fonts.ready;
      const times: string[] = [];
      for (let m = 0; m < 60; m++)
        for (let s = 0; s < 60; s++)
          times.push(
            `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
          );
      const original = el.textContent;
      const worst = (texts: string[]) => {
        let base: number[] | null = null;
        let most = 0;
        for (const t of texts) {
          el.textContent = t;
          const centres = t.split("").map((_, i) => {
            const box = el.getExtentOfChar(i);
            return box.x + box.width / 2;
          });
          if (!base) base = centres;
          else
            for (let i = 0; i < centres.length; i++)
              most = Math.max(most, Math.abs(centres[i] - base[i]));
        }
        return most;
      };
      el.textContent = "0";
      const figure = el.getExtentOfChar(0).width;
      const running = worst(times);
      const over = worst(times.map((t) => `+${t}`));
      // A control: the same measure on a face with proportional figures.
      el.style.fontFamily = "var(--font-face-big-shoulders)";
      el.style.fontWeight = "800";
      await document.fonts.load(
        `800 20px ${getComputedStyle(el).fontFamily}`,
        "0123456789",
      );
      const proportional = worst(times);
      el.removeAttribute("style");
      el.textContent = original;
      return {
        running: running / figure,
        over: over / figure,
        control: proportional / figure,
      };
    });
    expect(drift.control).toBeGreaterThan(0.05);
    expect(drift.running).toBeLessThan(0.02);
    expect(drift.over).toBeLessThan(0.02);
  });
}
