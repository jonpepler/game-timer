/**
 * WCAG colour maths over hex colours (#rgb, #rrggbb or #rrggbbaa). Used to
 * check theme palettes and to cap the overtime wash so the value on top of
 * it stays legible.
 */

export type Rgba = [number, number, number, number];

export const parseHex = (hex: string): Rgba => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const digits =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((d) => d + d)
          .join("")
      : m[1];
  const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16);
  return [
    channel(0),
    channel(2),
    channel(4),
    digits.length === 8 ? channel(6) / 255 : 1,
  ];
};

const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: Rgba): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** `fg` painted at `alpha` (times its own alpha) over an opaque `bg`. */
export const over = (fg: Rgba, bg: Rgba, alpha = 1): Rgba => {
  const a = fg[3] * alpha;
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
};

export const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Contrast of two hex colours, the second taken as the opaque ground. */
export const contrastHex = (fg: string, bg: string): number => {
  const ground = parseHex(bg);
  return contrast(over(parseHex(fg), ground), ground);
};

/** CIE L* lightness, 0 to 100. */
export const lightness = (c: Rgba): number => {
  const y = luminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};

/**
 * The strongest wash of `wash` over `surface` (0 to 1, in hundredths) that
 * keeps `ink` at 3:1 or better on the result.
 */
export const washCap = (ink: string, wash: string, surface: string): number => {
  const i = parseHex(ink);
  const w = parseHex(wash);
  const s = parseHex(surface);
  for (let step = 100; step >= 0; step--) {
    if (contrast(i, over(w, s, step / 100)) >= 3) return step / 100;
  }
  return 0;
};
