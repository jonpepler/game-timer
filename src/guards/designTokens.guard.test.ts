import { enforceRatchet, type Hit } from "./ratchet";
import {
  codeOf,
  declarationsIn,
  styleSources,
  stripVarCalls,
  TOKEN_FILE,
} from "./styleScan";

/**
 * No new literal spacing, type, corner, layer, motion or font-family values.
 * The scales live in src/app/globals.css; a stylesheet or inline style reads
 * them with `var(--space-8)` and friends. A token set with no gate rots: the
 * app reached 191 literal font sizes because nothing failed when one landed.
 *
 * Per file and per family, the count may only fall. Cleaning a file up fails
 * until its entry is lowered (UPDATE_TOKENS_BASELINE=1 npm test), because
 * slack in the baseline is permission for new literals.
 *
 * Not flagged: `0`, relative units (`em`, `rem`, `%` outside radius, `vh`,
 * `ch`), `clamp()`/`min()` display sizes for spacing and type (they are fluid
 * on purpose), and anything inside `var(...)`, so a fallback reads as the
 * token reference it is. Width, height, inset and transform are layout
 * geometry, not spacing, and are not scanned.
 */

const BASELINE_FILE = "src/guards/designTokens.baseline.json";

type Family =
  | "spacing"
  | "font-size"
  | "line-height"
  | "radius"
  | "z-index"
  | "motion"
  | "font-family";

interface FamilySpec {
  properties: string[];
  hits: (value: string) => string[];
  remedy: string;
}

const PX = /-?\d*\.?\d+px\b/g;
const nonZeroPx = (value: string) =>
  (value.match(PX) ?? []).filter((v) => Number.parseFloat(v) !== 0);
const bareNumber = (value: string) => {
  const trimmed = value.replace(/["'`,;]|!important/g, "").trim();
  return /^-?\d*\.?\d+$/.test(trimmed) ? [trimmed] : [];
};
/** Fluid sizes are deliberate: a clamp() or min() is read as one value, not flagged. */
const withoutFluid = (value: string) =>
  value.replace(/(?:clamp|min|max|calc)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, " ");

const sides = (base: string, camel: string) => [
  base,
  ...["top", "right", "bottom", "left", "inline", "block"].map(
    (s) => `${base}-${s}`,
  ),
  camel,
  ...["Top", "Right", "Bottom", "Left", "Inline", "Block"].map(
    (s) => `${camel}${s}`,
  ),
];

const FAMILIES: Record<Family, FamilySpec> = {
  spacing: {
    properties: [
      ...sides("padding", "padding"),
      ...sides("margin", "margin"),
      "gap",
      "row-gap",
      "column-gap",
      "rowGap",
      "columnGap",
    ],
    hits: (v) => nonZeroPx(withoutFluid(v)),
    remedy:
      "use a --space-* rung (2, 4, 6, 8, 12, 16, 24, 32). A value between rungs is a design question: snap it to the nearer rung",
  },
  "font-size": {
    properties: ["font-size", "fontSize"],
    hits: (v) => nonZeroPx(withoutFluid(v)),
    remedy:
      "use --font-size-2xs/xs/sm/md/lg/xl (11, 12, 14, 16, 20, 28). A fluid display size may stay a clamp()",
  },
  "line-height": {
    properties: ["line-height", "lineHeight"],
    hits: (v) => [...bareNumber(v), ...nonZeroPx(v)],
    remedy:
      "use --line-height-flush/tight/body/prose (1, 1.2, 1.4, 1.5); they are named by role",
  },
  radius: {
    properties: [
      "border-radius",
      "borderRadius",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
    ],
    hits: (v) => [...nonZeroPx(v), ...(v.match(/\b\d*\.?\d+%/g) ?? [])],
    remedy:
      "use the --radius-* token for what the element is: control (button, selectable row), field, chip, panel, sheet, chrome (header bar), tooltip, icon-button or disc. Better still, use the kit component in src/components/ui, which already reads it",
  },
  "z-index": {
    properties: ["z-index", "zIndex"],
    hits: (v) => bareNumber(v).filter((n) => Number(n) > 5),
    remedy:
      "use a --z-* layer (chrome, popover, toast, debug, hero, prompt, sheet). Sibling order inside one component (0 to 5) may stay a literal",
  },
  motion: {
    properties: [
      "transition",
      "transition-duration",
      "transition-delay",
      "transition-timing-function",
      "animation",
      "animation-duration",
      "animation-delay",
      "animation-timing-function",
      "transitionDuration",
      "transitionTimingFunction",
      "animationDuration",
    ],
    hits: (v) => [
      ...(v.match(/\b\d*\.?\d+m?s\b/g) ?? []).filter(
        (d) => Number.parseFloat(d) !== 0,
      ),
      ...(v.match(/cubic-bezier\([^)]*\)/g) ?? []),
      ...(v.match(/\b(?:ease-in-out|ease-in|ease-out|ease|linear)\b/g) ?? []),
    ],
    remedy:
      "use --duration-press/fast/base/slow and --ease-standard/out/emphasis. A duration that encodes something physical may stay a literal: say why at the call site",
  },
  "font-family": {
    properties: ["font-family", "fontFamily"],
    hits: (v) =>
      v === "inherit"
        ? []
        : stripVarCalls(v).replace(/[\s,"'`]/g, "")
          ? [v]
          : [],
    remedy:
      "inherit the body face (`font: inherit` on a control), or read a font token: var(--font-display) for headings and labels, var(--font-numeric) with tabular-nums for numbers the table reads, var(--font-mono) for codes and logs. A page never names its own face, or a theme cannot replace it",
  },
};

const isCss = (file: string) => file.endsWith(".css");

/** Every literal design value in one file's source, as `family` hits. */
const literalsIn = (
  source: string,
  css: boolean,
): Array<{ family: Family; line: number; text: string }> => {
  const out: Array<{ family: Family; line: number; text: string }> = [];
  for (const [family, spec] of Object.entries(FAMILIES) as [
    Family,
    FamilySpec,
  ][]) {
    for (const d of declarationsIn(source, spec.properties, css)) {
      for (const hit of spec.hits(stripVarCalls(d.value))) {
        out.push({ family, line: d.line, text: `${d.property}: ${hit}` });
      }
    }
  }
  return out;
};

const scanned = () =>
  styleSources().filter(
    (f) => f !== TOKEN_FILE && (f.endsWith(".css") || f.endsWith(".tsx")),
  );

describe("design-token guard", () => {
  it("sees every family in a stylesheet and an inline style", () => {
    const css = [
      ".x {",
      "  padding: 7px 13px;",
      "  font-size: 13px;",
      "  line-height: 1.27;",
      "  border-radius: 9px;",
      "  z-index: 37;",
      "  transition: opacity 220ms ease-in;",
      '  font-family: "Trebuchet MS",',
      "    sans-serif;",
      "}",
    ].join("\n");
    expect(new Set(literalsIn(css, true).map((h) => h.family))).toEqual(
      new Set(Object.keys(FAMILIES)),
    );
    const style = '<div style={{ paddingTop: "7px", fontSize: "13px" }} />';
    expect(literalsIn(style, false).map((h) => h.family)).toEqual([
      "spacing",
      "font-size",
    ]);
  });

  it("reads tokens, fallbacks, zero and fluid sizes as clean", () => {
    const css = [
      "  padding: var(--space-8) 0;",
      "  margin: var(--space-4, 4px);",
      "  font-size: clamp(18px, 3vmin, 28px);",
      "  border-radius: var(--radius-chip);",
      "  z-index: 2;",
      "  transition: opacity var(--duration-fast) var(--ease-standard);",
      "  font-family: var(--font-mono);",
      "  font-family: inherit;",
    ].join("\n");
    expect(literalsIn(css, true)).toEqual([]);
  });

  it("no file gains a literal design value beyond the baseline", () => {
    const hits: Hit[] = [];
    for (const file of scanned()) {
      for (const h of literalsIn(codeOf(file), isCss(file))) {
        hits.push({ file, line: h.line, key: h.family, detail: h.text });
      }
    }
    // The scan reaches the stylesheets, so a pass is not a blind scan.
    expect(scanned().length).toBeGreaterThan(20);
    enforceRatchet({
      hits,
      baselineFile: BASELINE_FILE,
      updateEnvVar: "UPDATE_TOKENS_BASELINE",
      remedy: [
        "Write a token from src/app/globals.css instead of the literal:",
        ...Object.entries(FAMILIES).map(([f, s]) => `  ${f}: ${s.remedy}`),
      ].join("\n"),
    });
  });
});
