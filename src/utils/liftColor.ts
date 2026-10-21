const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

const parseHex = (hex: string): [number, number, number] | null => {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((d) => d + d)
          .join("")
      : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
};

const toHex = (channels: number[]) =>
  `#${channels
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const toOklab = (rgb: [number, number, number]) => {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363371544 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995764 * g + 0.1073969256 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

/** OKLab lightness (0 to 1) of a hex colour, or null when it is not hex. */
export const oklabLightness = (color: string): number | null => {
  const rgb = parseHex(color);
  return rgb ? toOklab(rgb).L : null;
};

/**
 * Raise a colour's OKLab lightness to at least `minLightness`, keeping
 * its hue and chroma, so a dark data colour still reads against a dark
 * surface. Only for display: the stored colour is never changed. Colours
 * that are not hex, or already light enough, come back unchanged.
 */
export const liftColor = (color: string, minLightness = 0.66): string => {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const { L, A, B } = toOklab(rgb);
  if (L >= minLightness) return color;

  const L2 = minLightness;
  const l2 = (L2 + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m2 = (L2 - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s2 = (L2 - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return toHex(
    [
      4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
      -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
      -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2,
    ].map(fromLinear),
  );
};
