import { CLOCK_GEOMETRY, type OrnamentKind } from "@/state/clockFace";

/*
 * Path data for the clock, in the 100-unit viewBox. Angles are degrees
 * clockwise from 12 o'clock unless a function says otherwise.
 */

const C = CLOCK_GEOMETRY.centre;
const round3 = (n: number) => +n.toFixed(3);

export const polar = (r: number, deg: number): [number, number] => [
  round3(C + r * Math.sin((deg * Math.PI) / 180)),
  round3(C - r * Math.cos((deg * Math.PI) / 180)),
];

/** The full circle the default sweep and hairline are drawn on, as react-circular-progressbar drew it. */
export const RING_PATH = `
      M 50,50
      m 0,-46
      a 46,46 0 1 1 0,92
      a 46,46 0 1 1 0,-92
    `;

export const RING_LENGTH = 2 * Math.PI * CLOCK_GEOMETRY.ring.r;

/** An open arc at radius `r` from `a0` to `a1`. */
export const arc = (r: number, a0: number, a1: number): string => {
  if (a1 - a0 >= 359.99) {
    return `M${C} ${C - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  }
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

/** A closed annular sector between radii `r0` and `r1`. */
export const sector = (r0: number, r1: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
};

/**
 * A player arc as PlayerRing drew it: angles from 3 o'clock, measured in
 * the SVG's own direction, starting at `startDeg` and running `sweepDeg`.
 */
export const playerArc = (startDeg: number, sweepDeg: number): string => {
  const r = CLOCK_GEOMETRY.players.r;
  const point = (deg: number) => ({
    x: C + r * Math.cos((deg * Math.PI) / 180),
    y: C + r * Math.sin((deg * Math.PI) / 180),
  });
  const start = point(startDeg);
  const end = point(startDeg + sweepDeg);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
};

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Strokes and fills of one ornament inside its slot. */
export interface OrnamentPaths {
  strokes: Array<{ d: string; width: number }>;
  fills: string[];
}

const diamondPath = (cx: number, cy: number, d: number) =>
  `M${round3(cx)} ${round3(cy - d)}L${round3(cx + d)} ${round3(cy)}L${round3(cx)} ${round3(cy + d)}L${round3(cx - d)} ${round3(cy)}Z`;

/** A square of side `side` centred on (cx, cy), turned `deg` off true. */
const squarePath = (cx: number, cy: number, side: number, deg: number) => {
  const h = side / 2;
  const t = (deg * Math.PI) / 180;
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ].map(
    ([x, y]) =>
      `${round3(cx + x * Math.cos(t) - y * Math.sin(t))} ${round3(cy + x * Math.sin(t) + y * Math.cos(t))}`,
  );
  return `M${corners.join("L")}Z`;
};

/** Two hairlines either side of a centre mark `gap` wide. */
const doubleRule = (s: Slot, cy: number, gap: number) => {
  const cx = s.x + s.w / 2;
  const left = round3(cx - gap);
  const right = round3(cx + gap);
  return [cy - 0.6, cy + 0.6]
    .map(
      (y) => `M${s.x} ${round3(y)}H${left}M${right} ${round3(y)}H${s.x + s.w}`,
    )
    .join("");
};

export const ornamentPaths = (
  kind: OrnamentKind,
  s: Slot,
  below: boolean,
): OrnamentPaths => {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  switch (kind) {
    case "rule-diamond": {
      const d = 2.4;
      return {
        strokes: [
          { d: doubleRule(s, cy, d + 1.2), width: 0.32 },
          { d: diamondPath(cx, cy, d), width: 0.4 },
        ],
        fills: [diamondPath(cx, cy, 0.9)],
      };
    }
    case "rule-star": {
      // A four-point star: long points on the axes, short in the diagonals.
      const long = 3.6;
      const short = 1;
      let star = "";
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = i % 2 === 0 ? long : short;
        star += `${i === 0 ? "M" : "L"}${round3(cx + r * Math.sin(a))} ${round3(cy - r * Math.cos(a))}`;
      }
      star += "Z";
      return {
        strokes: [
          { d: doubleRule(s, cy, long + 1), width: 0.32 },
          { d: star, width: 0.3 },
        ],
        fills: [star],
      };
    }
    case "square-run": {
      /*
       * Thin rules that wander a little off level, broken by three squares
       * each turned slightly off true: square, but drawn by hand. The
       * offsets are fixed, so every clock draws the same marks.
       */
      const big = 2.6;
      const small = 1.3;
      const run = (x0: number, x1: number, wobble: number[]) => {
        const step = (x1 - x0) / (wobble.length - 1);
        return wobble
          .map(
            (dy, i) =>
              `${i === 0 ? "M" : "L"}${round3(x0 + i * step)} ${round3(cy + dy)}`,
          )
          .join("");
      };
      const gap = big / 2 + 1.1;
      const smallAt = 6.2;
      const rules =
        run(s.x + 1.5, cx - smallAt - small / 2 - 0.9, [0.18, -0.05, 0.1]) +
        run(cx - smallAt + small / 2 + 0.9, cx - gap, [0.05, -0.12]) +
        run(cx + gap, cx + smallAt - small / 2 - 0.9, [-0.1, 0.06]) +
        run(
          cx + smallAt + small / 2 + 0.9,
          s.x + s.w - 1.5,
          [0.04, 0.16, -0.08],
        );
      const ends = `M${s.x + 0.4} ${round3(cy - 1.2)}V${round3(cy + 1.3)}M${s.x + s.w - 0.4} ${round3(cy - 1.3)}V${round3(cy + 1.1)}`;
      return {
        strokes: [
          { d: rules, width: 0.26 },
          { d: ends, width: 0.26 },
          { d: squarePath(cx, cy, big, 4), width: 0.34 },
          { d: squarePath(cx + smallAt, cy + 0.1, small, -6), width: 0.3 },
        ],
        fills: [
          squarePath(cx, cy, 0.8, -3),
          squarePath(cx - smallAt, cy - 0.05, small, 5),
        ],
      };
    }
    case "diamond": {
      const d = 1.6;
      return {
        strokes: [
          {
            d: `M${cx - 9} ${cy}H${round3(cx - d - 1)}M${round3(cx + d + 1)} ${cy}H${cx + 9}`,
            width: 0.32,
          },
        ],
        fills: [diamondPath(cx, cy, d)],
      };
    }
    case "sunburst": {
      const oy = below ? s.y : s.y + s.h;
      const dir = below ? 1 : -1;
      let d = "";
      for (let a = -70; a <= 70; a += 10) {
        const long = Math.round(a / 10) % 2 === 0;
        const r0 = 1.8;
        const r1 = long ? s.h * 0.95 : s.h * 0.62;
        const sx = Math.sin((a * Math.PI) / 180);
        const sy = Math.cos((a * Math.PI) / 180);
        d += `M${round3(cx + r0 * sx)} ${round3(oy + dir * r0 * sy)}L${round3(cx + r1 * sx)} ${round3(oy + dir * r1 * sy)}`;
      }
      return {
        strokes: [
          { d, width: 0.3 },
          { d: `M${cx - 12} ${oy}H${cx + 12}`, width: 0.3 },
        ],
        fills: [],
      };
    }
    case "chevron-band": {
      const n = 9;
      const step = s.w / n;
      const a = s.h * 0.2;
      let zig = `M${s.x} ${round3(cy + a)}`;
      for (let i = 0; i < n; i++) {
        const x = s.x + i * step;
        zig += `L${round3(x + step / 2)} ${round3(cy - a)}L${round3(x + step)} ${round3(cy + a)}`;
      }
      return {
        strokes: [
          { d: zig, width: 0.34 },
          {
            d: `M${s.x} ${round3(cy - a - 1.5)}H${s.x + s.w}M${s.x} ${round3(cy + a + 1.5)}H${s.x + s.w}`,
            width: 0.22,
          },
        ],
        fills: [],
      };
    }
  }
};
