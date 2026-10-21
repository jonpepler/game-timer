import { isBuiltIn, listDefinitions } from "@/state/definitionRegistry";
import { enforceRatchet, type Hit, listFiles, readLines } from "./ratchet";

/**
 * Framework code must not know about any real game. Every built-in
 * definition lists its own vocabulary in `gameSpecificTerms`; this test
 * fails when one of those words appears outside the definitions.
 *
 * Scanned: `src/**` (ts, tsx, css, json) and the shared e2e helpers
 * (`e2e/*.ts` that are not specs). Exempt: the definitions themselves,
 * this guard's own folder, and e2e specs, which drive a specific game by
 * design. Core unit tests are scanned too: they should use generic
 * fixtures, and the ones that still pull in a real game are baselined.
 * Tests scoped to one game live in a folder named after its definition
 * id (`e2e/games/<definitionId>/` or `src/state/definitions/<definitionId>/`)
 * and are exempt like the definitions.
 */

const BASELINE_FILE = "src/guards/gameSpecificTerms.baseline.json";

const GAME_SCOPED = [
  /^e2e\/games\/([^/]+)\//,
  /^src\/state\/definitions\/([^/]+)\//,
];

/** Whether `file` sits in the folder of one of the definitions `ids`. */
const isGameScoped = (file: string, ids: Set<string>): boolean =>
  GAME_SCOPED.some((pattern) => {
    const id = pattern.exec(file)?.[1];
    return id !== undefined && ids.has(id);
  });

const definitionIds = (): Set<string> =>
  new Set(listDefinitions().map((d) => d.id));

const isExempt = (file: string): boolean =>
  isGameScoped(file, definitionIds()) ||
  file.startsWith("src/state/definitions/") ||
  file.startsWith("src/guards/") ||
  (file.startsWith("e2e/") && file.endsWith(".spec.ts"));

const scannedFiles = (): string[] =>
  [
    ...listFiles("src", [".ts", ".tsx", ".css", ".json"]),
    ...listFiles("e2e", [".ts"]),
  ].filter((f) => !isExempt(f));

/** Split one identifier into lower-case words: camel, Pascal, snake, kebab. */
const wordsOf = (token: string): string[] =>
  (token.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map((w) =>
    w.toLowerCase(),
  );

/** The word plus the stems it could inflect from (plurals, -ed, -ing). */
const stemsOf = (word: string): string[] => {
  const out = [word];
  if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) out.push(word.slice(0, -2));
  if (word.endsWith("s")) out.push(word.slice(0, -1));
  if (word.endsWith("ed")) out.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("ing"))
    out.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  return out;
};

/**
 * Names the platform owns that happen to contain a game's word: the CSS
 * `:root` selector, Next.js's `RootLayout`, and the React and DOM APIs
 * named after a tree's root. Each is matched exactly, case and all, and
 * skipped; any other spelling of the word is still a hit.
 */
const PLATFORM_SELECTORS = /:root\b/g;
const PLATFORM_TOKENS = new Set([
  "RootLayout",
  "createRoot",
  "hydrateRoot",
  "getRootNode",
  "rootMargin",
  "shadowRoot",
]);

const termsInLine = (line: string, terms: Set<string>): string[] => {
  const found: string[] = [];
  const tokens = line.replace(PLATFORM_SELECTORS, "").match(/[A-Za-z0-9]+/g);
  for (const token of tokens ?? []) {
    if (PLATFORM_TOKENS.has(token)) continue;
    for (const word of wordsOf(token)) {
      const term = stemsOf(word).find((s) => terms.has(s));
      if (term) found.push(term);
    }
  }
  return found;
};

const builtInTerms = (): Set<string> =>
  new Set(
    listDefinitions()
      .filter((d) => isBuiltIn(d.id))
      .flatMap((d) => d.gameSpecificTerms ?? [])
      .map((t) => t.toLowerCase()),
  );

describe("game-specific vocabulary guard", () => {
  it("matches terms inside camelCase, PascalCase, snake and kebab words", () => {
    const terms = new Set(["seize", "hireling", "company"]);
    expect(termsInLine("const seizedNextLead = 1;", terms)).toEqual(["seize"]);
    expect(termsInLine("findDealtHirelingIds()", terms)).toEqual(["hireling"]);
    expect(termsInLine('type: "SEIZE_LEAD"', terms)).toEqual(["seize"]);
    expect(termsInLine(".seize-button {", terms)).toEqual(["seize"]);
    expect(termsInLine("// all companies", terms)).toEqual(["company"]);
    expect(termsInLine("seizure lead", terms)).toEqual([]);
  });

  it("skips platform names that share a word with a game, and only those", () => {
    const terms = new Set(["root"]);
    expect(termsInLine(":root {", terms)).toEqual([]);
    expect(termsInLine("export default function RootLayout({", terms)).toEqual(
      [],
    );
    expect(termsInLine("createRoot(el); el.getRootNode()", terms)).toEqual([]);
    expect(termsInLine("{ rootMargin: '0px' } host.shadowRoot", terms)).toEqual(
      [],
    );
    expect(termsInLine("import { rootDefinition } from", terms)).toEqual([
      "root",
    ]);
    expect(termsInLine("// a game such as Root", terms)).toEqual(["root"]);
    expect(termsInLine('id: "root",', terms)).toEqual(["root"]);
    expect(termsInLine(".root-card:hover {", terms)).toEqual(["root"]);
  });

  it("exempts the folder named after a definition id, and nothing else", () => {
    const ids = new Set(["alpha"]);
    expect(isGameScoped("e2e/games/alpha/helpers.ts", ids)).toBe(true);
    expect(isGameScoped("e2e/games/alpha/deep/flow.spec.ts", ids)).toBe(true);
    expect(
      isGameScoped("src/state/definitions/alpha/rules.test.tsx", ids),
    ).toBe(true);
    expect(isGameScoped("e2e/games/beta/helpers.ts", ids)).toBe(false);
    expect(isGameScoped("e2e/games/alpha.ts", ids)).toBe(false);
    expect(isGameScoped("e2e/alpha/helpers.ts", ids)).toBe(false);
    expect(isGameScoped("src/components/alpha/View.tsx", ids)).toBe(false);
  });

  it("every built-in game declares its terms in lower case", () => {
    for (const d of listDefinitions().filter((x) => isBuiltIn(x.id))) {
      for (const t of d.gameSpecificTerms ?? []) {
        expect(wordsOf(t), `${d.id}: "${t}"`).toEqual([t]);
      }
    }
    expect(builtInTerms().size).toBeGreaterThan(0);
  });

  it("no framework file uses a game's vocabulary beyond the baseline", () => {
    const terms = builtInTerms();
    const hits: Hit[] = [];
    for (const file of scannedFiles()) {
      readLines(file).forEach((line, i) => {
        for (const key of termsInLine(line, terms)) {
          hits.push({ file, line: i + 1, key });
        }
      });
    }
    enforceRatchet({
      hits,
      baselineFile: BASELINE_FILE,
      updateEnvVar: "UPDATE_VOCAB_BASELINE",
    });
  });
});
