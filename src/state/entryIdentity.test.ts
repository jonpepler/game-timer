import { describe, expect, it } from "vitest";
import {
  ENTRY_SYMBOLS,
  flatLabel,
  joinLineage,
  spokenName,
  TYPE_STYLES,
} from "./entryIdentity";
import { parseGameDefinition } from "./gameDefinition";

const withEntry = (entry: Record<string, unknown>) => ({
  schemaVersion: 1,
  id: "fixture",
  name: "Fixture",
  defaultExpectedTurns: 10,
  defaultAverageSeconds: 60,
  turnOrder: {
    mode: "variable",
    entryKinds: [{ id: "big", label: "Big", prominent: true }],
    entries: [{ id: "alpha", label: "Alpha", kind: "big", ...entry }],
  },
});

describe("entry identity tokens", () => {
  it("accepts every type style and symbol from the framework's sets", () => {
    for (const typeStyle of TYPE_STYLES)
      for (const symbol of ENTRY_SYMBOLS)
        expect(() =>
          parseGameDefinition(withEntry({ identity: { typeStyle, symbol } })),
        ).not.toThrow();
  });

  it("keeps the identity on the parsed entry", () => {
    const def = parseGameDefinition(
      withEntry({ identity: { typeStyle: "slab", symbol: "anchor" } }),
    );
    expect(def.turnOrder?.entries?.[0].identity).toEqual({
      typeStyle: "slab",
      symbol: "anchor",
    });
  });

  it("rejects a type style or symbol outside the sets", () => {
    expect(() =>
      parseGameDefinition(withEntry({ identity: { typeStyle: "comic" } })),
    ).toThrow(/typeStyle/);
    expect(() =>
      parseGameDefinition(withEntry({ identity: { symbol: "skull" } })),
    ).toThrow(/symbol/);
  });

  it("rejects a font or CSS value given directly", () => {
    expect(() =>
      parseGameDefinition(
        withEntry({ identity: { fontFamily: "Comic Sans MS" } }),
      ),
    ).toThrow(/fontFamily/);
  });
});

describe("structured names", () => {
  const parts = { title: "Group", lineage: ["North Side", "Field"] };

  it("runs lineage names together with no connector, so they read as one name", () => {
    expect(joinLineage(["A"])).toBe("A");
    expect(joinLineage(["A", "B"])).toBe("A B");
    expect(joinLineage(["A", "B", "C"])).toBe("A B C");
  });

  it("flattens to lineage then title for plain-string uses", () => {
    expect(flatLabel(parts)).toBe("North Side Field Group");
    expect(flatLabel({ title: "Solo", lineage: [] })).toBe("Solo");
  });

  it("reads aloud exactly as it is written", () => {
    expect(spokenName(parts)).toBe("North Side Field Group");
  });
});
