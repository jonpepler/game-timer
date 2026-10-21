import { describe, expect, it } from "vitest";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  loadGameDefinitionWithModules,
  optionVisibleUnderContext,
  parseGameContentModules,
  parseGameDefinition,
  parseGameDefinitionStructure,
  safeParseGameDefinition,
  turnOrderForSetup,
  visibleSetupSteps,
} from "./gameDefinition";
import type { SetupContext, TurnOrder } from "./gameDefinition";

const minimalValid = {
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "generic",
  name: "Generic",
  defaultExpectedTurns: 90,
  defaultAverageSeconds: 300,
};

describe("GameDefinitionSchema", () => {
  it("parses a minimal definition", () => {
    const parsed = parseGameDefinition(minimalValid);
    expect(parsed.id).toBe("generic");
  });

  it("rejects a wrong schemaVersion literal", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      schemaVersion: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field with a useful path", () => {
    const { name: _name, ...withoutName } = minimalValid;
    const result = safeParseGameDefinition(withoutName);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name");
    }
  });

  it("validates a player-pick step's option array", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "side",
          label: "Side",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [
              { id: "a", label: "Alpha", color: "#fff" },
              { id: "b", label: "Beta", color: "#000", description: "Second." },
            ],
          },
        },
      ],
    });
    expect(parsed.setupSteps?.[0].kind.type).toBe("player-pick");
  });

  it("rejects a player-pick option missing its id", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "side",
          label: "Side",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [{ label: "Alpha" }],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("setupSteps"))).toBe(true);
    }
  });

  it("rejects an unknown score displayStyle", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      score: {
        displayStyle: "spiral",
        min: 0,
        increment: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it("parses a full setupSteps array (every step kind)", () => {
    const parsed = parseGameDefinition({
      ...minimalValid,
      id: "fixture",
      name: "Fixture",
      maxPlayers: 6,
      setupSteps: [
        {
          id: "map",
          label: "Map",
          kind: {
            type: "select-one",
            options: [{ id: "autumn", label: "Autumn" }],
          },
        },
        {
          id: "sites",
          label: "Sites",
          kind: { type: "select-count", min: 0, max: 2 },
        },
        {
          id: "draft",
          label: "Draft roles",
          kind: { type: "toggle", defaultValue: false },
        },
        {
          id: "role",
          label: "Role",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: [
              { id: "wanderer", label: "Wanderer", color: "#aaa" },
              { id: "rogues", label: "Rogues", color: "#bbb" },
            ],
            constraints: [
              { type: "mutually-exclusive", optionIds: ["wanderer", "rogues"] },
            ],
          },
        },
      ],
    });
    expect(parsed.setupSteps).toHaveLength(4);
    expect(parsed.setupSteps?.[0].kind.type).toBe("select-one");
    expect(parsed.setupSteps?.[3].kind.type).toBe("player-pick");
    if (parsed.setupSteps?.[3].kind.type === "player-pick") {
      expect(parsed.setupSteps[3].kind.constraints).toEqual([
        { type: "mutually-exclusive", optionIds: ["wanderer", "rogues"] },
      ]);
    }
  });

  it("rejects an unknown setup-step kind", () => {
    const result = safeParseGameDefinition({
      ...minimalValid,
      setupSteps: [
        {
          id: "weird",
          label: "Weird",
          kind: { type: "summon-demon" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("visibleWhen gates", () => {
  const withGate = (module: string) => ({
    ...minimalValid,
    setupSteps: [
      {
        id: "modules",
        label: "Modules",
        kind: {
          type: "multi-toggle",
          options: [
            { id: "base", label: "Base" },
            { id: "extra", label: "Extra" },
          ],
        },
      },
      {
        id: "extra-setup",
        label: "Extra setup",
        visibleWhen: { type: "module-selected", module },
        kind: { type: "info" },
      },
    ],
  });

  it("accepts a gate on a declared module", () => {
    expect(safeParseGameDefinition(withGate("extra")).success).toBe(true);
  });

  it("rejects a gate on an unknown module id at load", () => {
    const result = safeParseGameDefinition(withGate("extar"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe(
        "setupSteps.1.visibleWhen.module",
      );
      expect(result.error.issues[0].message).toContain('"extar"');
    }
  });

  const withToggleGate = (
    gate: { type: "toggle-on" | "toggle-off"; step: string },
    toggleFirst = true,
  ) => {
    const toggle = {
      id: "variant",
      label: "Play the variant",
      kind: { type: "toggle", defaultValue: true },
    };
    const gated = {
      id: "variant-setup",
      label: "Variant setup",
      visibleWhen: gate,
      kind: { type: "info" },
    };
    return parseGameDefinition({
      ...minimalValid,
      setupSteps: toggleFirst ? [toggle, gated] : [gated, toggle],
    });
  };

  it("shows a toggle-on step only while the toggle is on", () => {
    const def = withToggleGate({ type: "toggle-on", step: "variant" });
    const ids = (value: boolean) =>
      visibleSetupSteps(def, {
        variant: { kind: "toggle", value },
      }).map((s) => s.id);
    expect(ids(true)).toContain("variant-setup");
    expect(ids(false)).not.toContain("variant-setup");
    // A toggle missing from the context counts as off.
    expect(visibleSetupSteps(def, {}).map((s) => s.id)).not.toContain(
      "variant-setup",
    );
  });

  it("shows a toggle-off step only while the toggle is off", () => {
    const def = withToggleGate({ type: "toggle-off", step: "variant" });
    const ids = (value: boolean) =>
      visibleSetupSteps(def, {
        variant: { kind: "toggle", value },
      }).map((s) => s.id);
    expect(ids(false)).toContain("variant-setup");
    expect(ids(true)).not.toContain("variant-setup");
  });

  it("rejects a toggle gate on an unknown or later step", () => {
    expect(() =>
      withToggleGate({ type: "toggle-on", step: "varaint" }),
    ).toThrow(/not an earlier toggle step/);
    expect(() =>
      withToggleGate({ type: "toggle-on", step: "variant" }, false),
    ).toThrow(/not an earlier toggle step/);
  });
});

describe("structure + modules split", () => {
  const minimalStructure = {
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: "ex",
    name: "Example",
    defaultExpectedTurns: 30,
    defaultAverageSeconds: 200,
    contentSource: "./modules.json",
    setupSteps: [
      {
        id: "pick-side",
        label: "Side",
        kind: {
          type: "player-pick",
          mode: "host-only",
          optionCategory: "role",
          optionIds: ["a", "b"],
        },
      },
    ],
  };

  const minimalModules = {
    schemaVersion: 1,
    categories: {
      role: {
        a: { label: "Alpha", color: "#111", assets: { meeple: "alpha.svg" } },
        b: { label: "Beta", color: "#222" },
      },
    },
  };

  it("structure schema accepts a step with optionIds + optionCategory", () => {
    const s = parseGameDefinitionStructure(minimalStructure);
    expect(s.setupSteps?.[0].kind.type).toBe("player-pick");
  });

  it("modules schema accepts an arbitrary category map", () => {
    const m = parseGameContentModules(minimalModules);
    expect(m.categories.role.a.label).toBe("Alpha");
  });

  it("loader joins structure ids + category content into full SetupOptions", () => {
    const def = loadGameDefinitionWithModules(minimalStructure, minimalModules);
    const step = def.setupSteps?.[0];
    if (step?.kind.type !== "player-pick") throw new Error("wrong kind");
    expect(step.kind.options.map((o) => o.id)).toEqual(["a", "b"]);
    expect(step.kind.options[0].label).toBe("Alpha");
    expect(step.kind.options[0].color).toBe("#111");
    // Passthrough: extra fields from the modules survive on the merged option.
    expect(
      (step.kind.options[0] as unknown as { assets: { meeple: string } }).assets
        .meeple,
    ).toBe("alpha.svg");
  });

  it("loader throws on an option id with no entry in its category", () => {
    expect(() =>
      loadGameDefinitionWithModules(
        {
          ...minimalStructure,
          setupSteps: [
            {
              ...minimalStructure.setupSteps[0],
              kind: {
                ...minimalStructure.setupSteps[0].kind,
                optionIds: ["a", "ghost"],
              },
            },
          ],
        },
        minimalModules,
      ),
    ).toThrow(/unknown option id "ghost"/);
  });

  it("loader throws on a step referencing an undeclared category", () => {
    expect(() =>
      loadGameDefinitionWithModules(
        {
          ...minimalStructure,
          setupSteps: [
            {
              ...minimalStructure.setupSteps[0],
              kind: {
                ...minimalStructure.setupSteps[0].kind,
                optionCategory: "imaginary",
              },
            },
          ],
        },
        minimalModules,
      ),
    ).toThrow(/unknown content category "imaginary"/);
  });

  it("merged shape passes the existing GameDefinition validator", () => {
    const def = loadGameDefinitionWithModules(minimalStructure, minimalModules);
    expect(() => parseGameDefinition(def)).not.toThrow();
    expect(def).not.toHaveProperty("contentSource");
  });
});

describe("setup step kinds", () => {
  const struct = (kinds: Record<string, unknown>[]) => ({
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: "x",
    name: "X",
    defaultExpectedTurns: 30,
    defaultAverageSeconds: 200,
    setupSteps: kinds.map((kind, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      kind,
    })),
  });

  it("multi-toggle step parses with optionCategory + optionIds", () => {
    const s = parseGameDefinitionStructure(
      struct([
        {
          type: "multi-toggle",
          optionCategory: "expansion",
          optionIds: ["a", "b", "c"],
          defaultSelectedIds: ["a"],
        },
      ]),
    );
    expect(s.setupSteps?.[0].kind.type).toBe("multi-toggle");
  });

  it("deal-random step parses with count + optional", () => {
    const s = parseGameDefinitionStructure(
      struct([
        {
          type: "deal-random",
          optionCategory: "helper",
          optionIds: ["x", "y", "z"],
          count: 3,
          optional: true,
        },
      ]),
    );
    expect(s.setupSteps?.[0].kind.type).toBe("deal-random");
  });

  it("seat-players step parses with player-count bounds", () => {
    const s = parseGameDefinitionStructure(
      struct([
        {
          type: "seat-players",
          minPlayers: 2,
          maxPlayers: 6,
          defaultPlayerCount: 3,
        },
      ]),
    );
    expect(s.setupSteps?.[0].kind.type).toBe("seat-players");
  });

  it("loader resolves multi-toggle + deal-random options against modules", () => {
    const def = loadGameDefinitionWithModules(
      {
        schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
        id: "g",
        name: "G",
        defaultExpectedTurns: 30,
        defaultAverageSeconds: 200,
        setupSteps: [
          {
            id: "exp",
            label: "Expansions",
            kind: {
              type: "multi-toggle",
              optionCategory: "expansion",
              optionIds: ["base", "expansionB"],
              defaultSelectedIds: ["base"],
            },
          },
          {
            id: "hire",
            label: "Helpers",
            kind: {
              type: "deal-random",
              optionCategory: "helper",
              optionIds: ["h1", "h2", "h3"],
              count: 2,
              optional: true,
            },
          },
        ],
      },
      {
        schemaVersion: 1,
        categories: {
          expansion: {
            base: { label: "Base" },
            expansionB: { label: "Expansion B" },
          },
          helper: {
            h1: { label: "Helper One", module: "base" },
            h2: { label: "Helper Two", module: "expansionB" },
            h3: { label: "Helper Three", module: "base" },
          },
        },
      },
    );
    const exp = def.setupSteps?.[0];
    const hire = def.setupSteps?.[1];
    if (exp?.kind.type !== "multi-toggle") throw new Error("not multi-toggle");
    if (hire?.kind.type !== "deal-random") throw new Error("not deal-random");
    expect(exp.kind.options.map((o) => o.id)).toEqual(["base", "expansionB"]);
    expect(hire.kind.options).toHaveLength(3);
    expect(hire.kind.count).toBe(2);
    expect(hire.kind.optional).toBe(true);
  });
});

describe("optionVisibleUnderContext", () => {
  it("treats an option without `module` as always visible", () => {
    const ctx: SetupContext = {
      exp: { kind: "multi-toggle", selectedIds: ["base"] },
    };
    expect(optionVisibleUnderContext({}, ctx)).toBe(true);
  });

  it("hides an option whose module isn't in any multi-toggle selection", () => {
    const ctx: SetupContext = {
      exp: { kind: "multi-toggle", selectedIds: ["base"] },
    };
    expect(optionVisibleUnderContext({ module: "expansionB" }, ctx)).toBe(
      false,
    );
    expect(optionVisibleUnderContext({ module: "base" }, ctx)).toBe(true);
  });

  it("falls through to visible when the wizard hasn't hit a multi-toggle yet", () => {
    const ctx: SetupContext = {
      map: { kind: "select-one", optionId: "autumn" },
    };
    expect(optionVisibleUnderContext({ module: "expansionB" }, ctx)).toBe(true);
  });
});

describe("turnOrderForSetup", () => {
  const order: TurnOrder = {
    mode: "variable",
    entryKinds: [{ id: "k", label: "K" }],
    entries: [
      { id: "always", label: "Always", kind: "k" },
      { id: "base", label: "Base", kind: "k", module: "base" },
      { id: "extra", label: "Extra", kind: "k", module: "expansion" },
      { id: "variant", label: "Variant", kind: "k", requiresToggle: "v" },
    ],
    lists: [
      { id: "people", label: "People", includePlayers: true },
      { id: "things", label: "Things", kinds: ["k"] },
    ],
    phases: [
      { id: "a", label: "A", list: "people", next: "x" },
      { id: "x", label: "X", list: "things", module: "expansion" },
      { id: "b", label: "B", list: "things" },
    ],
  };
  const ctx = (modules: string[], variant = true): SetupContext => ({
    modules: { kind: "multi-toggle", selectedIds: modules },
    v: { kind: "toggle", value: variant },
  });
  const entryIds = (o: TurnOrder) => o.entries?.map((e) => e.id);

  it("keeps everything when every gate is open", () => {
    const out = turnOrderForSetup(order, ctx(["base", "expansion"]));
    expect(entryIds(out)).toEqual(["always", "base", "extra", "variant"]);
    expect(out.phases?.map((p) => p.id)).toEqual(["a", "x", "b"]);
    expect(out.phases?.[0].next).toBe("x");
  });

  it("drops entries and phases whose module is not selected", () => {
    const out = turnOrderForSetup(order, ctx(["base"]));
    expect(entryIds(out)).toEqual(["always", "base", "variant"]);
    expect(out.phases?.map((p) => p.id)).toEqual(["a", "b"]);
    // `next` pointed at the dropped phase, so it falls back to order.
    expect(out.phases?.[0]).not.toHaveProperty("next");
    expect(() =>
      parseGameDefinition({ ...minimalValid, turnOrder: out }),
    ).not.toThrow();
  });

  it("drops entries whose toggle is off", () => {
    const out = turnOrderForSetup(order, ctx(["base", "expansion"], false));
    expect(entryIds(out)).toEqual(["always", "base", "extra"]);
  });

  it("keeps everything with no multi-toggle in the setup", () => {
    expect(entryIds(turnOrderForSetup(order, {}))).toEqual([
      "always",
      "base",
      "extra",
      "variant",
    ]);
  });

  it("drops value steps whose module is not selected or toggle is off", () => {
    const valued: TurnOrder = {
      ...order,
      entryValues: {
        label: "Value",
        track: [0, 10, 20],
        steps: [
          { id: "up", label: "+1", effect: "move", spaces: 1 },
          {
            id: "more",
            label: "+2",
            effect: "move",
            spaces: 2,
            module: "expansion",
          },
          { id: "gone", label: "Gone", effect: "remove", requiresToggle: "v" },
        ],
      },
    };
    const stepIds = (o: TurnOrder) => o.entryValues?.steps.map((s) => s.id);
    expect(
      stepIds(turnOrderForSetup(valued, ctx(["base", "expansion"]))),
    ).toEqual(["up", "more", "gone"]);
    expect(stepIds(turnOrderForSetup(valued, ctx(["base"])))).toEqual([
      "up",
      "gone",
    ]);
    expect(
      stepIds(turnOrderForSetup(valued, ctx(["base", "expansion"], false))),
    ).toEqual(["up", "more"]);
  });
});
