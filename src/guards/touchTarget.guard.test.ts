import fs from "node:fs";
import path from "node:path";

/**
 * Every control is at least 44px, the touch target floor. The kit sizes
 * its controls from the `--control-height-*` scale, so the guard holds the
 * scale at or above the floor and holds each kit control's box to that
 * scale: a literal height, or a token from another scale, fails here.
 */

const FLOOR_PX = 44;
const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const CONTROL_STYLES = [
  "src/components/ui/Button.module.css",
  "src/components/ui/Chip.module.css",
  "src/components/ui/IconButton.module.css",
  "src/components/ui/Toggle.module.css",
];

/** Box sizes set on a control itself, not on the icon drawn inside it. */
const controlBoxSizes = (css: string) => {
  const sizes: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (/\b(svg|input|label|tooltip\w*|text)\b/.test(selector)) continue;
    for (const decl of rule[2].matchAll(
      /(?:^|;)\s*((?:min-)?(?:height|width))\s*:\s*([^;]+)/g,
    ))
      sizes.push(`${selector} { ${decl[1]}: ${decl[2].trim()} }`);
  }
  return sizes;
};

describe("touch target guard", () => {
  it("keeps every control height token at or above 44px", () => {
    const tokens = [
      ...read("src/app/globals.css").matchAll(
        /--control-height-(\w+):\s*(\d+)px/g,
      ),
    ];
    expect(tokens.length).toBeGreaterThan(0);
    const small = tokens
      .filter((t) => Number(t[2]) < FLOOR_PX)
      .map((t) => `--control-height-${t[1]}: ${t[2]}px`);
    expect(small, "raise the token to 44px or more").toEqual([]);
  });

  it("sizes every kit control from the control height scale", () => {
    const offScale = CONTROL_STYLES.flatMap((file) =>
      controlBoxSizes(read(file))
        .filter(
          (d) =>
            /(?:min-)?(?:height|width): /.test(d) &&
            !/var\(--control-height-\w+\)|: (auto|100%|0) }$/.test(d),
        )
        .map((d) => `${file}: ${d}`),
    );
    expect(
      offScale,
      "size a control with var(--control-height-md) or larger",
    ).toEqual([]);
  });
});
