import fs from "node:fs";
import path from "node:path";
import { enforceRatchet, type Hit, listFiles, REPO_ROOT } from "./ratchet";
import { codeOf } from "./styleScan";

/**
 * One visual form, one implementation. The app grew roughly thirty
 * button-like classes across its CSS modules (`.chip`, `.scoreButton`,
 * `.stepperBtn`, `.openChip`, `.dismissButton`...) because each feature
 * drew its own: two controls that do the same job on one screen ended up
 * with different corners, sizes and letter case, and a per-game theme had
 * thirty places to reach instead of one.
 *
 * Every form now lives in the UI kit, src/components/ui. Detection is by
 * CSS shape, not by name, because a copy never keeps the original's name.
 * Each shape below is a set of declarations that together make a
 * recognisable form (a round icon button is pointer + square + fully
 * rounded + centred). A class outside the kit whose own declarations match
 * a shape is a second implementation of that form. Passing a className to
 * the kit component that adds a tweak (a dashed border, a width) is a use,
 * not a copy, because the tweak alone does not match the shape.
 *
 * The baseline records copies that predate the kit and may only shrink
 * (UPDATE_PRIMITIVES_BASELINE=1 npm test after removing one).
 */

const BASELINE_FILE = "src/guards/duplicatePrimitives.baseline.json";
const KIT_DIR = "src/components/ui";

type Decls = Map<string, string>;

interface Shape {
  /** The form, as a reader would name it. */
  form: string;
  matches: (d: Decls) => boolean;
  /** The kit component that draws this form, in src/components/ui. */
  kit: string;
  remedy: string;
}

const PILL = /^(?:999px|9999px|50%|var\(--radius-(?:chip|icon-button|disc)\))$/;
const has = (d: Decls, prop: string, re: RegExp) => re.test(d.get(prop) ?? "");
const pointer = (d: Decls) => d.get("cursor") === "pointer";
const isSquare = (d: Decls) =>
  d.has("width") &&
  d.get("width") === d.get("height") &&
  d.get("width") !== "auto";
const smallType = (d: Decls) =>
  has(d, "font-size", /^(?:1[0-3](?:\.\d+)?px|var\(--font-size-(?:2xs|xs)\))$/);

const SHAPES: Record<string, Shape> = {
  "icon-button": {
    form: "icon button (square, centred glyph)",
    // A square placed by coordinates (a piece on a score track) is drawn
    // content, not a control in the flow of a page.
    matches: (d) =>
      pointer(d) &&
      isSquare(d) &&
      d.get("justify-content") === "center" &&
      d.get("position") !== "absolute",
    kit: "IconButton",
    remedy:
      'Use <IconButton label="..."> from @/components/ui: md (44px) or lg (56px), tone outline, filled or plain, shape round or square (header bar)',
  },
  "pill-button": {
    form: "pill button (stadium-shaped text control)",
    matches: (d) =>
      pointer(d) &&
      has(d, "border-radius", PILL) &&
      d.has("padding") &&
      !isSquare(d),
    kit: "Chip",
    remedy:
      "Use <Chip onPress={...} pressed={...}> from @/components/ui to pick a value, <Segmented> to switch views, or <Button> for a command",
  },
  "solid-button": {
    form: "solid button (inverse fill)",
    matches: (d) =>
      pointer(d) &&
      has(d, "background", /^var\(--color-(?:accent|text)\)$/) &&
      has(d, "color", /^var\(--color-(?:text-inverse|surface)\b/),
    kit: "Button",
    remedy:
      'Use <Button variant="primary"> (or <ButtonLink> for navigation) from @/components/ui',
  },
  "outline-button": {
    form: "outline button (transparent, hairline border)",
    matches: (d) =>
      pointer(d) &&
      has(d, "background", /^transparent$/) &&
      has(d, "border", /^1px solid var\(--color-border/) &&
      !isSquare(d) &&
      !has(d, "border-radius", PILL) &&
      d.get("flex-direction") !== "column",
    kit: "Button",
    remedy:
      'Use <Button variant="secondary"> (or ghost, danger) from @/components/ui, size sm, md or lg',
  },
  "list-row-button": {
    form: "full-width list row that is a button",
    matches: (d) =>
      pointer(d) && d.get("width") === "100%" && d.get("text-align") === "left",
    kit: "ListRow",
    remedy:
      "Use <ListRow label=... lead=... hint=... trailing=...> from @/components/ui; an entry colour is its color prop",
  },
  "section-label": {
    form: "section label (small uppercase letter-spaced text)",
    matches: (d) =>
      d.get("text-transform") === "uppercase" &&
      d.has("letter-spacing") &&
      smallType(d),
    kit: "SectionLabel",
    remedy:
      'Use <SectionLabel as="legend" | "label" | "h3"> from @/components/ui',
  },
  overlay: {
    form: "full-screen overlay (fixed, inset 0)",
    matches: (d) => d.get("position") === "fixed" && d.get("inset") === "0",
    kit: "Sheet",
    remedy:
      "Use <Sheet> (or <Prompt> for a question the table must answer) from @/components/ui; it brings the backdrop, focus handling and Escape",
  },
};

/** Each single-class rule's own declarations, merged across a file's blocks. */
const rulesIn = (css: string): Map<string, { line: number; decls: Decls }> => {
  const rules = new Map<string, { line: number; decls: Decls }>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const cls = /^\.([A-Za-z][\w-]*)$/.exec(selector)?.[1];
    if (!cls) continue;
    const line = css
      .slice(0, (m.index ?? 0) + m[0].indexOf(selector))
      .split("\n").length;
    const rule = rules.get(cls) ?? { line, decls: new Map() };
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      rule.decls.set(
        d.slice(0, i).trim(),
        d
          .slice(i + 1)
          .replace(/\s+/g, " ")
          .replace(/!important/, "")
          .trim(),
      );
    }
    rules.set(cls, rule);
  }
  return rules;
};

/** Every rule in `css` that draws one of the shapes, as `shape .class`. */
const shapesIn = (
  css: string,
): Array<{ key: string; line: number; shape: string; cls: string }> => {
  const out = [];
  for (const [cls, rule] of rulesIn(css)) {
    for (const [shape, spec] of Object.entries(SHAPES)) {
      if (spec.matches(rule.decls)) {
        out.push({ key: `${shape} .${cls}`, line: rule.line, shape, cls });
      }
    }
  }
  return out;
};

const allShapes = () =>
  listFiles("src", [".css"]).flatMap((file) =>
    shapesIn(codeOf(file)).map((s) => ({ ...s, file })),
  );

describe("one visual form, one implementation", () => {
  it("recognises each form from its declarations alone", () => {
    const planted = [
      ".a { width: 40px; height: 40px; display: inline-flex; justify-content: center; border-radius: 999px; cursor: pointer; }",
      ".b { padding: 8px 16px; border-radius: 999px; cursor: pointer; }",
      ".c { background: var(--color-accent); color: var(--color-text-inverse); cursor: pointer; }",
      ".d { background: transparent; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; }",
      ".e { width: 100%; text-align: left; cursor: pointer; }",
      ".f { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }",
      ".g { position: fixed; inset: 0; }",
    ].join("\n");
    expect(shapesIn(planted).map((s) => s.key)).toEqual([
      "icon-button .a",
      "pill-button .b",
      "solid-button .c",
      "outline-button .d",
      "list-row-button .e",
      "section-label .f",
      "overlay .g",
    ]);
  });

  it("treats a tweak passed to a kit component as a use", () => {
    expect(shapesIn(".dashed { border-style: dashed; width: 100%; }")).toEqual(
      [],
    );
  });

  it("names a kit component that exists for every form", () => {
    for (const spec of Object.values(SHAPES)) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, KIT_DIR, `${spec.kit}.tsx`)),
        spec.form,
      ).toBe(true);
    }
  });

  it("no form gains a second implementation beyond the baseline", () => {
    const hits: Hit[] = [];
    const remedies = new Set<string>();
    for (const s of allShapes()) {
      const spec = SHAPES[s.shape];
      if (s.file.startsWith(`${KIT_DIR}/`)) continue;
      hits.push({ file: s.file, line: s.line, key: s.key, detail: spec.form });
      remedies.add(`  ${s.shape}: ${spec.remedy}`);
    }
    enforceRatchet({
      hits,
      baselineFile: BASELINE_FILE,
      updateEnvVar: "UPDATE_PRIMITIVES_BASELINE",
      remedy: [
        "These classes draw a form the UI kit already has. Use the kit component instead of styling a new one:",
        ...remedies,
        "If the control genuinely is a new form, that is a UI kit decision: add it to src/components/ui (see CLAUDE.md) and to SHAPES here, not as one more local class.",
      ].join("\n"),
    });
  });
});
