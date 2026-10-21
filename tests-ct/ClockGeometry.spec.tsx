import { expect, test } from "@playwright/experimental-ct-react";
import { TimerRing } from "@/components/timer/TimerRing";
import { type ClockFace, ClockFaceSchema } from "@/state/clockFace";
import arcsTheme from "@/state/definitions/arcs/theme.json";
import railwaysTheme from "@/state/definitions/railways/theme.json";

/*
 * Every face draws inside the framework's geometry: the same box, the
 * ring marks between r 42.5 and 50, the seat marks between r 37.5 and
 * 42.5, and an ornament inside one slot. Checked on the rendered SVG, in
 * a real browser, for the bundled faces and a spread of the options.
 */

const face = (spec: unknown): ClockFace => ClockFaceSchema.parse(spec);

const FACES: Array<[string, ClockFace]> = [
  [
    "default",
    face({ track: { style: "hairline" }, progress: { style: "sweep" } }),
  ],
  ["railways theme", face(railwaysTheme.clock)],
  ["arcs theme", face(arcsTheme.clock)],
  ["survey plate", face({ preset: "survey-plate" })],
  ["theodolite", face({ preset: "theodolite" })],
  [
    "theodolite, rule-diamond turning to a star in overtime",
    face({
      preset: "theodolite",
      ornament: {
        slot: "above",
        kind: "rule-diamond",
        overtime: { kind: "rule-star" },
      },
    }),
  ],
  [
    "ticks filled, square-run below",
    face({
      track: { style: "ticks", divisions: 40 },
      progress: { style: "fill" },
      ornament: { slot: "below", kind: "square-run" },
    }),
  ],
  [
    "band, heavy sweep, chevrons below",
    face({
      track: { style: "band" },
      progress: { style: "sweep", weight: "heavy", cap: "butt" },
      ornament: { slot: "below", kind: "chevron-band" },
      numerals: { face: "big-shoulders-800" },
    }),
  ],
  [
    "ticks, light sweep, pointer, sunburst",
    face({
      track: { style: "ticks", divisions: 40 },
      progress: { style: "sweep", weight: "light", marker: "pointer" },
      ornament: { slot: "above", kind: "sunburst" },
    }),
  ],
  [
    "ticks filled, diamond below, hatch",
    face({
      track: { style: "ticks", divisions: 20 },
      progress: { style: "fill" },
      ornament: { slot: "below", kind: "diamond" },
      overtime: { style: "hatch" },
    }),
  ],
  [
    "ten cells, hollow when paused",
    face({
      track: { style: "cells", count: 10 },
      progress: { style: "fill" },
      paused: { cue: "tone-hollow" },
    }),
  ],
];

const PLAYERS = [
  { name: "One", color: "#A8322D" },
  { name: "Two", color: "#4E7A3A" },
  { name: "Three", color: "#7A5A8C" },
  { name: "Four", color: "#D6A43C" },
];

const STATES = [
  { id: "running", value: 62, text: "03:05", paused: false, overtime: 0 },
  { id: "paused", value: 40, text: "02:00", paused: true, overtime: 0 },
  { id: "overtime", value: 0, text: "+01:40", paused: false, overtime: 0.5 },
];

interface Measured {
  box: { width: number; height: number };
  paint: { x0: number; y0: number; x1: number; y1: number };
  bands: Record<string, [number, number] | null>;
  ornament: { x: number; y: number; width: number; height: number } | null;
}

/** Radii every mark in each layer reaches, stroke included, in viewBox units. */
const measure = (svg: SVGSVGElement): Measured => {
  const scale = 100 / svg.getBoundingClientRect().width;
  const bands: Measured["bands"] = {};
  for (const slot of ["track", "progress", "players"]) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    const shapes = svg.querySelectorAll<SVGGeometryElement>(
      `[data-slot="${slot}"] path, [data-slot="${slot}"] circle`,
    );
    for (const el of shapes) {
      const style = getComputedStyle(el);
      const stroked = style.stroke !== "none";
      const width = stroked ? Number.parseFloat(style.strokeWidth) : 0;
      const nonScaling =
        el.getAttribute("vector-effect") === "non-scaling-stroke";
      const half = (nonScaling ? width * scale : width) / 2;
      const length = el.getTotalLength();
      const matrix = el.getCTM();
      const root = svg.getCTM();
      for (let i = 0; i <= 240; i++) {
        let p = el.getPointAtLength((length * i) / 240);
        if (matrix && root)
          p = p.matrixTransform(root.inverse().multiply(matrix));
        const r = Math.hypot(p.x - 50, p.y - 50);
        // The default ring's path opens with a bare move to the centre, as
        // react-circular-progressbar's did; it draws nothing there.
        if (r < 1e-6) continue;
        lo = Math.min(lo, r - half);
        hi = Math.max(hi, r + half);
      }
    }
    bands[slot] = Number.isFinite(lo) ? [lo, hi] : null;
  }
  // The painted extent of every mark, its stroke included, in viewBox units.
  const paint = { x0: 50, y0: 50, x1: 50, y1: 50 };
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(
    "path, circle, rect, text",
  )) {
    if (el.closest("defs")) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || el.closest('[data-slot="field"]')) continue;
    const b = el.getBBox();
    const stroked = style.stroke !== "none";
    const nonScaling =
      el.getAttribute("vector-effect") === "non-scaling-stroke";
    const width = stroked ? Number.parseFloat(style.strokeWidth) : 0;
    const half = (nonScaling ? width * scale : width) / 2;
    const m = el.getCTM();
    const root = svg.getCTM();
    const toRoot = m && root ? root.inverse().multiply(m) : null;
    for (const [x, y] of [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ]) {
      let p = new DOMPoint(x, y);
      if (toRoot) p = p.matrixTransform(toRoot);
      paint.x0 = Math.min(paint.x0, p.x - half);
      paint.y0 = Math.min(paint.y0, p.y - half);
      paint.x1 = Math.max(paint.x1, p.x + half);
      paint.y1 = Math.max(paint.y1, p.y + half);
    }
  }
  const orn = svg.querySelector<SVGGElement>('[data-slot="ornament"]');
  const bb = orn && orn.childElementCount > 0 ? orn.getBBox() : null;
  const rect = svg.getBoundingClientRect();
  return {
    box: { width: rect.width, height: rect.height },
    paint,
    bands,
    ornament: bb && { x: bb.x, y: bb.y, width: bb.width, height: bb.height },
  };
};

const SLOTS = [
  { x: 32, y: 27.18, w: 36, h: 9 },
  { x: 32, y: 60.169, w: 36, h: 9 },
];

for (const [name, spec] of FACES) {
  for (const state of STATES) {
    test(`${name}, ${state.id}: every mark stays in its band`, async ({
      mount,
      page,
    }) => {
      await mount(
        <div style={{ position: "relative", width: 300, height: 300 }}>
          <TimerRing
            face={spec}
            value={state.value}
            text={state.text}
            paused={state.paused}
            overtimeOpacity={state.overtime}
            players={PLAYERS}
            activeIndex={1}
          />
        </div>,
      );
      const m = await page
        .locator("svg")
        .first()
        .evaluate(measure as (svg: SVGSVGElement) => Measured);
      expect(m.box).toEqual({ width: 300, height: 300 });
      const eps = 0.06;
      for (const slot of ["track", "progress"] as const) {
        const band = m.bands[slot];
        if (!band) continue;
        expect(band[0], `${slot} inner edge`).toBeGreaterThanOrEqual(
          42.5 - eps,
        );
        expect(band[1], `${slot} outer edge`).toBeLessThanOrEqual(50 + eps);
      }
      const seats = m.bands.players;
      expect(seats).not.toBeNull();
      expect(seats![0]).toBeGreaterThanOrEqual(37.5 - eps);
      expect(seats![1]).toBeLessThanOrEqual(42.5 + eps);
      // Nothing paints outside the clock's own square, the figures included.
      const v = m.paint;
      expect(v.x0, JSON.stringify(v)).toBeGreaterThanOrEqual(-eps);
      expect(v.y0, JSON.stringify(v)).toBeGreaterThanOrEqual(-eps);
      expect(v.x1, JSON.stringify(v)).toBeLessThanOrEqual(100 + eps);
      expect(v.y1, JSON.stringify(v)).toBeLessThanOrEqual(100 + eps);
      if (m.ornament) {
        const o = m.ornament;
        const fits = SLOTS.some(
          (s) =>
            o.x >= s.x - 0.3 &&
            o.y >= s.y - 0.3 &&
            o.x + o.width <= s.x + s.w + 0.3 &&
            o.y + o.height <= s.y + s.h + 0.3,
        );
        expect(fits, JSON.stringify(o)).toBe(true);
      }
    });
  }
}

test("a small clock drops its ornament, a large one keeps it", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      <div style={{ position: "relative", width: 140 }}>
        <TimerRing
          face={FACES[1][1]}
          value={50}
          text="02:30"
          paused={false}
          overtimeOpacity={0}
        />
      </div>
      <div style={{ position: "relative", width: 320 }}>
        <TimerRing
          face={FACES[1][1]}
          value={50}
          text="02:30"
          paused={false}
          overtimeOpacity={0}
        />
      </div>
    </div>,
  );
  const ornaments = page.locator('[data-slot="ornament"]');
  await expect(ornaments.nth(0)).toBeHidden();
  await expect(ornaments.nth(1)).toBeVisible();
});

test("the clock keeps to its own box and clips anything past it", async ({
  mount,
  page,
}) => {
  await mount(
    <div style={{ width: 480, padding: 40 }}>
      <p>Player name</p>
      <div style={{ position: "relative", width: 480 }}>
        <TimerRing
          face={face({ preset: "theodolite" })}
          value={0}
          text="+05:20"
          paused={false}
          overtimeOpacity={1}
          players={PLAYERS}
          activeIndex={0}
        />
      </div>
    </div>,
  );
  const clock = page.locator("svg").first();
  const box = await clock.boundingBox();
  const name = await page.getByText("Player name").boundingBox();
  expect(box && name && box.y >= name.y + name.height).toBe(true);
  expect(box?.width).toBe(480);
  expect(box?.height).toBe(480);
  await expect(clock).toHaveCSS("overflow", "hidden");
});

test("the drawn sign keeps the overtime text whole for assistive tech", async ({
  mount,
  page,
}) => {
  await mount(
    <div style={{ position: "relative", width: 300 }}>
      <TimerRing
        face={face({ preset: "theodolite" })}
        numerals="old-standard-700"
        value={0}
        text="+01:40"
        paused={false}
        overtimeOpacity={0.5}
      />
    </div>,
  );
  await expect(page.getByText("+01:40")).toBeAttached();
  await expect(page.locator('[data-part="sign"]')).toHaveCount(1);
});
