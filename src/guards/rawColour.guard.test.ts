import { enforceRatchet, type Hit } from "./ratchet";
import { codeOf, styleSources, TOKEN_FILE } from "./styleScan";

/**
 * Colour lives in src/app/globals.css. A stylesheet or component that writes
 * `#4caf50`, `rgba(0, 0, 0, 0.75)` or `hsl(...)` itself is a colour a theme
 * cannot reach: a per-game palette overrides tokens, so every literal is a
 * spot that stays dark-mode white-on-black whatever the theme says. Shadows
 * and overlay backdrops count, since they assume the page is dark too.
 *
 * Scanned: every stylesheet and every .tsx (inline styles, SVG fills and
 * strokes). Data is not scanned: player colours come from definitions and
 * src/lib palettes, and are content rather than chrome. Per file, the count
 * may only fall; lower it with UPDATE_COLOUR_BASELINE=1 npm test.
 */

const BASELINE_FILE = "src/guards/rawColour.baseline.json";

const COLOUR =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/g;

/**
 * Raw colour literals in one file's source. A hex digit run that is part of
 * an identifier or a URL fragment (`#section`, `id="#a1"` in prose) only
 * counts when it is 3, 4, 6 or 8 hex digits long and not followed by a word
 * character, which is the shape of a colour.
 */
const coloursIn = (source: string): Array<{ line: number; text: string }> =>
  [...source.matchAll(COLOUR)].map((m) => ({
    line: source.slice(0, m.index).split("\n").length,
    text: m[0].endsWith("(") ? `${m[0]}...)` : m[0],
  }));

const scanned = () =>
  styleSources().filter(
    (f) => f !== TOKEN_FILE && (f.endsWith(".css") || f.endsWith(".tsx")),
  );

describe("raw colour guard", () => {
  it("sees hex, rgb and hsl in a stylesheet and an inline style", () => {
    const css = [
      ".dot { background: #4caf50; }",
      ".scrim { background: rgba(0, 0, 0, 0.75); }",
      ".glow { box-shadow: 0 0 4px hsl(0 0% 100% / 0.4); }",
    ].join("\n");
    expect(coloursIn(css).map((c) => c.line)).toEqual([1, 2, 3]);
    expect(coloursIn('<path fill="#fff" />')).toHaveLength(1);
    expect(coloursIn('style={{ color: "rgb(1, 2, 3)" }}')).toHaveLength(1);
  });

  it("leaves tokens and non-colour hashes alone", () => {
    expect(
      coloursIn(
        "color: var(--color-text); background: color-mix(in srgb, var(--color-accent) 12%, transparent);",
      ),
    ).toEqual([]);
    expect(coloursIn('href="#players-heading"')).toEqual([]);
  });

  it("no file gains a raw colour beyond the baseline", () => {
    const hits: Hit[] = [];
    for (const file of scanned()) {
      for (const c of coloursIn(codeOf(file))) {
        hits.push({ file, line: c.line, key: "colour", detail: c.text });
      }
    }
    // The scan reaches the stylesheets, so a pass is not a blind scan.
    expect(scanned().length).toBeGreaterThan(20);
    enforceRatchet({
      hits,
      baselineFile: BASELINE_FILE,
      updateEnvVar: "UPDATE_COLOUR_BASELINE",
      remedy:
        "Read a token from src/app/globals.css instead: --color-* for colour (status tones --color-success/warning/danger with their -tint and --color-on-*-tint pairs, --color-on-light/--color-on-dark for text on a player colour, --color-chart-* for charts) and --elevation-* for the backdrop, shadows and drop shadows. For a tint of a token use color-mix(in srgb, var(--color-x) N%, transparent). If no token fits the job, add a role-named one to globals.css and read that: a theme can then override it.",
    });
  });
});
