import fs from "node:fs";
import path from "node:path";
import { builtInThemes } from "@/state/definitions";
import { GameThemeSchema, schemeTokens } from "@/state/gameTheme";
import { listFiles, REPO_ROOT } from "./ratchet";
import { codeOf, styleSources, TOKEN_FILE } from "./styleScan";

/**
 * A game theme reaches the screen through tokens and nothing else. Theme
 * files may only set custom properties that src/app/globals.css declares,
 * so a theme can never invent a token no component reads, and no
 * component may read a theme's values directly: the theme module and the
 * theme files are imported only by the code that turns them into tokens.
 * Zero tolerance: there is no baseline.
 *
 * Two pieces of framework state come out of the theme store as values,
 * each to one reader: the clock face's enumerated options to the clock,
 * and the light or dark switch to the scheme toggle. The active scheme
 * (`useColourScheme`) is framework state any component may read.
 */

const THEME_FILES = listFiles("src/state/definitions", [".json"]).filter(
  (f) => path.basename(f) === "theme.json",
);

const declaredTokens = new Set(
  [...codeOf(TOKEN_FILE).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]),
);

/** Files that may import the theme module, the theme files or the registry's themes. */
const THEME_READERS = new Set([
  "src/state/gameTheme.ts",
  "src/hooks/useGameTheme.ts",
]);
const isDefinitionFile = (f: string) => f.startsWith("src/state/definitions/");

/** Hooks that hand a theme value out, and the one file allowed to call each. */
const VALUE_HOOKS: Record<string, string> = {
  useClockFace: "src/components/timer/TimerRing.tsx",
  useThemeScheme: "src/components/SchemeToggle.tsx",
};

const sources = () =>
  styleSources().filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

describe("theme token guard", () => {
  it("finds the bundled theme files", () => {
    expect(THEME_FILES.length).toBeGreaterThan(0);
    expect(THEME_FILES.length).toBe(builtInThemes.length);
  });

  it.each(THEME_FILES)("%s sets only tokens globals.css declares", (file) => {
    const theme = GameThemeSchema.parse(
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")),
    );
    const unknown = (["light", "dark"] as const).flatMap((scheme) =>
      Object.keys(schemeTokens(theme, scheme))
        .filter((token) => !declaredTokens.has(token))
        .map((token) => `${scheme}: ${token}`),
    );
    expect(
      unknown,
      "A theme may only override a token the app declares in src/app/globals.css. Declare the token there (and read it somewhere), or drop it from the theme.",
    ).toEqual([]);
  });

  it("no component reads a theme outside the token pipeline", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (THEME_READERS.has(file) || isDefinitionFile(file)) continue;
      const code = codeOf(file);
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (
          /from\s+["'][^"']*(state\/gameTheme|\/theme\.json)["']/.test(line) ||
          /\bbuiltInThemes\b/.test(line)
        )
          offenders.push(`${file}:${i + 1}: imports the theme itself`);
        if (/getPropertyValue\(\s*["'`]--/.test(line))
          offenders.push(`${file}:${i + 1}: reads a token's value in script`);
        for (const [hook, reader] of Object.entries(VALUE_HOOKS)) {
          if (new RegExp(`\\b${hook}\\b`).test(line) && file !== reader)
            offenders.push(`${file}:${i + 1}: ${hook} belongs to ${reader}`);
        }
      });
    }
    expect(
      offenders,
      "Read the theme through tokens: var(--color-*), var(--font-*), var(--radius-*) and the rest in src/app/globals.css. Only src/hooks/useGameTheme.ts turns a theme into tokens.",
    ).toEqual([]);
  });

  it("would catch a component importing a theme", () => {
    const line = 'import theme from "@/state/definitions/x/theme.json";';
    expect(
      /from\s+["'][^"']*(state\/gameTheme|\/theme\.json)["']/.test(line),
    ).toBe(true);
  });
});
