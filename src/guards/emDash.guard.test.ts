import { enforceRatchet, type Hit, listFiles, readLines } from "./ratchet";

/**
 * No em-dashes anywhere in `src/**` or `e2e/**`: code, comments, log and
 * UI strings, and the definition JSON. An en-dash standing in for an
 * em-dash counts too; one between two numbers (a numeric range) is fine.
 */

const BASELINE_FILE = "src/guards/emDash.baseline.json";
const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);
const EN_DASH_RANGE = new RegExp(`\\d ?${EN_DASH} ?\\d`, "g");

const TEXT_EXTENSIONS = [".ts", ".tsx", ".js", ".css", ".json", ".md", ".svg"];

const dashesInLine = (line: string): string[] => {
  const found: string[] = [];
  for (const _ of line.matchAll(new RegExp(EM_DASH, "g"))) {
    found.push("em-dash");
  }
  const withoutRanges = line.replace(EN_DASH_RANGE, "");
  for (const _ of withoutRanges.matchAll(new RegExp(EN_DASH, "g"))) {
    found.push("en-dash");
  }
  return found;
};

describe("em-dash guard", () => {
  it("flags em-dashes and en-dashes used as dashes, not numeric ranges", () => {
    expect(dashesInLine(`a ${EM_DASH} b ${EM_DASH} c`)).toEqual([
      "em-dash",
      "em-dash",
    ]);
    expect(dashesInLine(`words ${EN_DASH} more`)).toEqual(["en-dash"]);
    expect(dashesInLine(`2${EN_DASH}5 players, 33 ${EN_DASH} 27`)).toEqual([]);
  });

  it("no file gains an em-dash beyond the baseline", () => {
    const hits: Hit[] = [];
    for (const file of [
      ...listFiles("src", TEXT_EXTENSIONS),
      ...listFiles("e2e", TEXT_EXTENSIONS),
    ]) {
      readLines(file).forEach((line, i) => {
        for (const key of dashesInLine(line)) {
          hits.push({ file, line: i + 1, key });
        }
      });
    }
    enforceRatchet({
      hits,
      baselineFile: BASELINE_FILE,
      updateEnvVar: "UPDATE_EMDASH_BASELINE",
    });
  });
});
