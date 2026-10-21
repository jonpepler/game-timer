import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../..");

/** One offending occurrence, reported as `file:line: key`. */
export interface Hit {
  file: string;
  line: number;
  key: string;
  /** The offending text, shown beside the key in a failure. */
  detail?: string;
}

/** Per file, per key (a term or a character name): how many hits. */
export type Baseline = Record<string, Record<string, number>>;

/**
 * Every file under `dir` (relative to the repo root) whose extension is in
 * `extensions`, as repo-relative POSIX paths in a stable order.
 */
export const listFiles = (dir: string, extensions: string[]): string[] => {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (extensions.includes(path.extname(entry.name))) out.push(child);
    }
  };
  walk(dir);
  return out.sort();
};

export const readLines = (file: string): string[] =>
  fs.readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n");

export const tally = (hits: Hit[]): Baseline => {
  const counts: Baseline = {};
  for (const h of hits) {
    counts[h.file] ??= {};
    counts[h.file][h.key] = (counts[h.file][h.key] ?? 0) + 1;
  }
  return counts;
};

const sortBaseline = (b: Baseline): Baseline =>
  Object.fromEntries(
    Object.keys(b)
      .sort()
      .map((file) => [
        file,
        Object.fromEntries(
          Object.keys(b[file])
            .sort()
            .map((key) => [key, b[file][key]]),
        ),
      ]),
  );

export const readBaseline = (file: string): Baseline => {
  const abs = path.join(REPO_ROOT, file);
  if (!fs.existsSync(abs)) return {};
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Baseline;
};

export const writeBaseline = (file: string, b: Baseline) => {
  fs.writeFileSync(
    path.join(REPO_ROOT, file),
    `${JSON.stringify(sortBaseline(b), null, 2)}\n`,
  );
};

export interface RatchetResult {
  /** Hits in a file/key whose count rose above the baseline. */
  added: string[];
  /** Baseline entries whose count fell, so the baseline is stale. */
  shrunk: string[];
}

/**
 * Compare current hits with the committed baseline. A count above its
 * baseline is a new violation; a count below it means someone fixed
 * violations and the baseline must be tightened to lock that in.
 */
export const compareWithBaseline = (
  hits: Hit[],
  baseline: Baseline,
): RatchetResult => {
  const current = tally(hits);
  const added: string[] = [];
  const shrunk: string[] = [];
  for (const [file, keys] of Object.entries(current)) {
    for (const [key, count] of Object.entries(keys)) {
      const allowed = baseline[file]?.[key] ?? 0;
      if (count > allowed) {
        const where = hits
          .filter((h) => h.file === file && h.key === key)
          .map(
            (h) =>
              `  ${h.file}:${h.line}: ${h.key}${h.detail ? ` (${h.detail})` : ""}`,
          );
        added.push(
          `${file} "${key}": ${count} found, baseline allows ${allowed}\n${where.join("\n")}`,
        );
      }
    }
  }
  for (const [file, keys] of Object.entries(baseline)) {
    for (const [key, allowed] of Object.entries(keys)) {
      const count = current[file]?.[key] ?? 0;
      if (count < allowed) {
        shrunk.push(`${file} "${key}": baseline ${allowed}, now ${count}`);
      }
    }
  }
  return { added, shrunk };
};

/**
 * Run the ratchet: fail on new violations, fail on a stale baseline, and
 * when `updateEnvVar` is set, rewrite the baseline instead. The rewrite is
 * refused while there are new violations, so the baseline only shrinks
 * (a missing baseline file is the one exception: it is created as is).
 */
export const enforceRatchet = ({
  hits,
  baselineFile,
  updateEnvVar,
  remedy,
}: {
  hits: Hit[];
  baselineFile: string;
  updateEnvVar: string;
  /** What to write instead, appended to a new-violation failure. */
  remedy?: string;
}) => {
  const update = process.env[updateEnvVar] === "1";
  if (update && !fs.existsSync(path.join(REPO_ROOT, baselineFile))) {
    writeBaseline(baselineFile, tally(hits));
    return;
  }
  const { added, shrunk } = compareWithBaseline(
    hits,
    readBaseline(baselineFile),
  );
  if (added.length > 0) {
    throw new Error(
      `New violations (fix them; the baseline cannot grow):\n\n${added.join("\n\n")}${remedy ? `\n\n${remedy}` : ""}`,
    );
  }
  if (update) {
    writeBaseline(baselineFile, tally(hits));
    return;
  }
  if (shrunk.length > 0) {
    throw new Error(
      `Violations were removed, tighten the baseline with ${updateEnvVar}=1 npm test:\n${shrunk.join("\n")}`,
    );
  }
};
