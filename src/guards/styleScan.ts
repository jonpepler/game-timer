import { listFiles, readLines } from "./ratchet";

/** The one file allowed to hold literal design values: it defines the tokens. */
export const TOKEN_FILE = "src/app/globals.css";

/** Stylesheets and components the design-system guards read. Tests are skipped. */
export const styleSources = (): string[] =>
  listFiles("src", [".css", ".ts", ".tsx"]).filter(
    (f) => !/\.test\.tsx?$/.test(f) && !f.startsWith("src/guards/"),
  );

/**
 * Blank out block and line comments, keeping newlines so line numbers stay
 * true. Comments quote values ("was 12px") and name tokens on purpose, and
 * counting prose as a declaration would punish exactly that documentation.
 * A `//` preceded by a colon or a quote is left alone so URLs survive.
 */
export const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead: string) => lead + " ".repeat(m.length - lead.length),
    );

/** A file's comment-free text. */
export const codeOf = (file: string): string =>
  stripComments(readLines(file).join("\n"));

/** Remove `var(...)` and `env(...)` innermost first, so fallbacks are not read as literals. */
export const stripVarCalls = (value: string): string => {
  let out = value;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/(?:var|env)\(\s*[\w-]+\s*(?:,[^()]*)?\)/g, " ");
  } while (out !== previous);
  return out;
};

export interface Declaration {
  property: string;
  value: string;
  line: number;
}

/**
 * Every `property: value` in a file, in CSS (`font-size: 12px;`) or a style
 * object (`fontSize: "12px",`). A CSS value runs to its `;` so a declaration
 * wrapped over several lines is read whole; a script value stops at the line
 * end. The leading class keeps `scrollPadding` from reading as `padding` and
 * `--x-gap` from reading as `gap`.
 */
export const declarationsIn = (
  source: string,
  properties: readonly string[],
  isCss: boolean,
): Declaration[] => {
  const alternation = [...properties]
    .sort((a, b) => b.length - a.length)
    .join("|");
  const value = isCss ? "[^;}]*" : "[^;},\\n]*";
  const re = new RegExp(
    `(^|[^\\w$.\\-])(${alternation})["']?\\s*:\\s*(${value})`,
    "g",
  );
  return Array.from(source.matchAll(re)).map((m) => ({
    property: m[2],
    value: m[3].replace(/\s+/g, " ").trim(),
    line: source.slice(0, (m.index ?? 0) + m[1].length).split("\n").length,
  }));
};
