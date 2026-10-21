import { compareWithBaseline } from "./ratchet";

const hit = (file: string, line: number, key: string) => ({ file, line, key });

describe("compareWithBaseline", () => {
  it("passes when counts match the baseline", () => {
    expect(
      compareWithBaseline([hit("a.ts", 1, "x"), hit("a.ts", 4, "x")], {
        "a.ts": { x: 2 },
      }),
    ).toEqual({ added: [], shrunk: [] });
  });

  it("reports a new violation with every offending line", () => {
    const { added } = compareWithBaseline(
      [hit("a.ts", 1, "x"), hit("a.ts", 9, "x"), hit("b.ts", 3, "y")],
      { "a.ts": { x: 1 } },
    );
    expect(added).toHaveLength(2);
    expect(added[0]).toContain("a.ts:9: x");
    expect(added[1]).toContain("b.ts:3: y");
  });

  it("reports a stale baseline when a count goes down", () => {
    const { added, shrunk } = compareWithBaseline([hit("a.ts", 1, "x")], {
      "a.ts": { x: 3 },
      "gone.ts": { y: 1 },
    });
    expect(added).toEqual([]);
    expect(shrunk).toEqual([
      'a.ts "x": baseline 3, now 1',
      'gone.ts "y": baseline 1, now 0',
    ]);
  });
});
