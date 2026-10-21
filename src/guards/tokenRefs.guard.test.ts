import { codeOf, styleSources } from "./styleScan";

/**
 * Every `var(--x)` with no fallback names a custom property that is declared
 * somewhere. An unresolvable `var()` makes the whole declaration invalid at
 * computed-value time, so the property silently falls back to its inherited
 * or initial value: a border vanishes, a focus ring does nothing, and the
 * screenshot still looks deliberate. This app shipped exactly that once:
 * `--color-accent` was read for selection and focus rings long before
 * globals.css declared it, so keyboard focus showed nothing.
 *
 * Declared means: in src/app/globals.css, or anywhere in the scanned source
 * as `--x:` (a component scoping its own property) or `"--x":` (one set from
 * a style object). A reference with a fallback, `var(--x, 8px)`, is safe by
 * construction and not checked.
 */

/** `--x:`, `"--x":` and a computed `["--x" as string]:` key. */
const DECLARATION = /(--[a-zA-Z0-9-]{2,})["']?(?:\s+as\s+\w+)?\]?\s*:/g;
const BARE_REFERENCE = /var\(\s*(--[a-zA-Z0-9-]{2,})\s*\)/g;
/** next/font sets these from `variable:` options rather than a declaration. */
const FONT_VARIABLE = /variable:\s*["'](--[a-zA-Z0-9-]+)["']/g;

const declaredIn = (source: string): string[] => [
  ...[...source.matchAll(DECLARATION)].map((m) => m[1]),
  ...[...source.matchAll(FONT_VARIABLE)].map((m) => m[1]),
];

const bareReferencesIn = (
  source: string,
): Array<{ line: number; name: string }> =>
  [...source.matchAll(BARE_REFERENCE)].map((m) => ({
    line: source.slice(0, m.index).split("\n").length,
    name: m[1],
  }));

const sources = () =>
  styleSources().map((file) => ({ file, code: codeOf(file) }));

describe("token reference guard", () => {
  it("finds bare references and skips ones with a fallback", () => {
    expect(
      bareReferencesIn(
        "a { color: var(--color-text); border: 1px solid var( --color-border ); }",
      ).map((r) => r.name),
    ).toEqual(["--color-text", "--color-border"]);
    expect(bareReferencesIn("gap: var(--gap-bogus, 8px);")).toEqual([]);
  });

  it("finds declarations in a stylesheet, a style object and a font", () => {
    expect(declaredIn(":root { --space-8: 8px; }")).toEqual(["--space-8"]);
    expect(declaredIn('style={{ "--entry-color": color }}')).toEqual([
      "--entry-color",
    ]);
    expect(declaredIn('["--victor-color" as string]: c')).toEqual([
      "--victor-color",
    ]);
    expect(declaredIn('variable: "--font-type-slab",')).toEqual([
      "--font-type-slab",
    ]);
  });

  it("every var() without a fallback resolves to a declared property", () => {
    const all = sources();
    const declared = new Set(all.flatMap((s) => declaredIn(s.code)));
    expect(declared.has("--color-text")).toBe(true);
    expect(declared.has("--color-token-that-does-not-exist")).toBe(false);

    const references = all.flatMap((s) =>
      bareReferencesIn(s.code).map((r) => ({ ...r, file: s.file })),
    );
    expect(references.length).toBeGreaterThan(200);

    const dangling = references
      .filter((r) => !declared.has(r.name))
      .map((r) => `  ${r.file}:${r.line}  var(${r.name})`);
    expect(
      dangling,
      `These read a custom property nothing declares, so the declaration is invalid and the browser silently drops it:\n${dangling.join("\n")}\n\nFix the name (the tokens are in src/app/globals.css), declare the token there if it should exist, or give the reference a fallback if the property is optional.`,
    ).toEqual([]);
  });
});
