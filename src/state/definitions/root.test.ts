import { describe, expect, it } from "vitest";
import {
  optionExcludedByDeals,
  optionVisibleUnderContext,
  type SetupContext,
  type SetupOption,
} from "../gameDefinition";
import { rootDefinition } from "./root";

/*
 * Root hireling module gating. Hirelings are sold in standalone
 * Hirelings Packs, NOT the same-named faction expansions, and each pack
 * supplies its own meeples (Law of Root H.3.3: a hireling never needs
 * you to own the matching faction). So a hireling must be gated by its
 * pack toggle, never by the faction expansion. Verified against Leder
 * Games product pages (see modules.json referenceCatalog note).
 */

const stepOptions = (id: string): SetupOption[] => {
  const step = rootDefinition.setupSteps?.find((s) => s.id === id);
  if (!step || !("options" in step.kind)) {
    throw new Error(`step "${id}" has no resolved options`);
  }
  return step.kind.options;
};

const hirelings = stepOptions("hirelings");
const factions = stepOptions("faction");
const hireling = (id: string) => {
  const o = hirelings.find((h) => h.id === id);
  if (!o) throw new Error(`no hireling "${id}"`);
  return o;
};

// All module toggle ids, and a context with a chosen subset selected.
const allModuleIds = stepOptions("expansions").map((o) => o.id);
const withModules = (selectedIds: string[]): SetupContext => ({
  expansions: { kind: "multi-toggle", selectedIds },
});
const withModulesExcept = (...off: string[]): SetupContext =>
  withModules(allModuleIds.filter((id) => !off.includes(id)));

const visible = (opt: SetupOption, ctx: SetupContext) =>
  optionVisibleUnderContext(opt, ctx);

// Hireling → the pack toggle that should gate it.
const PACK_OF: Record<string, string> = {
  patrol: "marauders",
  dynasty: "marauders",
  uprising: "marauders",
  exile: "marauders",
  prophets: "riverfolkHirelings",
  flotilla: "riverfolkHirelings",
  bandits: "riverfolkHirelings",
  expedition: "underworldHirelings",
  spies: "underworldHirelings",
  protector: "underworldHirelings",
  flameBearers: "marauderHirelings",
  vaultKeepers: "marauderHirelings",
  band: "marauderHirelings",
  advocates: "homelandHirelings",
  roamers: "homelandHirelings",
  farmers: "homelandHirelings",
};

describe("root hireling module gating", () => {
  it("tags every hireling with its real source product, not the faction expansion", () => {
    for (const [id, expected] of Object.entries(PACK_OF)) {
      expect(`${id}:${hireling(id).module}`).toBe(`${id}:${expected}`);
    }
    // No hireling is gated by a plain faction expansion (the old bug).
    for (const h of hirelings) {
      expect(h.module).not.toBe("riverfolk");
      expect(h.module).not.toBe("underworld");
      expect(h.module).not.toBe("homeland");
    }
  });

  it("shows all hirelings when every module is enabled", () => {
    const ctx = withModules(allModuleIds);
    for (const id of Object.keys(PACK_OF)) {
      expect(visible(hireling(id), ctx)).toBe(true);
    }
  });

  it("hides exactly a pack's hirelings when that pack is toggled off", () => {
    const ctx = withModulesExcept("riverfolkHirelings");
    // The Riverfolk pack's three vanish…
    for (const id of ["prophets", "flotilla", "bandits"]) {
      expect(visible(hireling(id), ctx)).toBe(false);
    }
    // …and nothing else does.
    for (const id of Object.keys(PACK_OF)) {
      if (PACK_OF[id] === "riverfolkHirelings") continue;
      expect(visible(hireling(id), ctx)).toBe(true);
    }
  });

  it("separates the Marauder Expansion from the Marauder Hirelings Pack", () => {
    // Pack off, Expansion on: the three pack hirelings hide, but the
    // four Marauder *Expansion* hirelings stay.
    const ctx = withModulesExcept("marauderHirelings");
    for (const id of ["flameBearers", "vaultKeepers", "band"]) {
      expect(visible(hireling(id), ctx)).toBe(false);
    }
    for (const id of ["patrol", "dynasty", "uprising", "exile"]) {
      expect(visible(hireling(id), ctx)).toBe(true);
    }
  });

  it("does NOT gate hirelings on the faction expansion (the corrected behaviour)", () => {
    // Riverfolk *Expansion* off but its Hirelings Pack on: the hirelings
    // stay visible (they come from the pack), while the expansion's
    // factions disappear. This is the whole point of the regate.
    const ctx = withModulesExcept("riverfolk");
    for (const id of ["prophets", "flotilla", "bandits"]) {
      expect(visible(hireling(id), ctx)).toBe(true);
    }
    const riverfolkFaction = factions.find((f) => f.module === "riverfolk");
    expect(
      riverfolkFaction,
      "a faction gated on the riverfolk expansion",
    ).toBeDefined();
    if (riverfolkFaction) expect(visible(riverfolkFaction, ctx)).toBe(false);
  });
});

/*
 * Dealing a hireling rules its matching faction out of the faction draft.
 * This table is the old per-faction `matchingHireling` field, inverted:
 * the relation now lives on the hireling as the generic `excludeOptionIds`.
 */
describe("root hireling excludes its matching faction", () => {
  const EXCLUDED_BY: Record<string, string[]> = {
    patrol: ["marquise"],
    dynasty: ["eyrie"],
    uprising: ["alliance"],
    exile: ["vagabond", "vagabond__2", "knaves"],
    prophets: ["lizards"],
    flotilla: ["riverfolk"],
    expedition: ["duchy"],
    spies: ["corvids"],
    flameBearers: ["hundreds"],
    vaultKeepers: ["keepers"],
    advocates: ["twilight"],
    roamers: ["lilypad"],
    bandits: [],
    protector: [],
    band: [],
    farmers: [],
  };
  const steps = rootDefinition.setupSteps ?? [];
  const excludedWhen = (choice: SetupContext[string]) =>
    factions
      .filter((f) => optionExcludedByDeals(f.id, steps, { hirelings: choice }))
      .map((f) => f.id)
      .sort();
  const dealt = (dealtIds: string[]) =>
    excludedWhen({ kind: "deal-random", skipped: false, dealtIds });

  it("covers every hireling", () => {
    expect(Object.keys(EXCLUDED_BY).sort()).toEqual(
      hirelings.map((h) => h.id).sort(),
    );
  });

  for (const [hirelingId, expected] of Object.entries(EXCLUDED_BY)) {
    it(`dealing ${hirelingId} excludes ${expected.join(", ") || "nothing"}`, () => {
      expect(dealt([hirelingId])).toEqual([...expected].sort());
    });
  }

  it("unions the exclusions of every dealt hireling", () => {
    expect(dealt(["patrol", "dynasty", "bandits"])).toEqual([
      "eyrie",
      "marquise",
    ]);
  });

  it("excludes nothing when the hireling deal was skipped", () => {
    expect(excludedWhen({ kind: "deal-random", skipped: true })).toEqual([]);
  });
});

describe("root definition shape", () => {
  it("Root pressure-tests the schema: full player-pick roster + score subsystem", () => {
    const root = rootDefinition;
    const pickStep = root.setupSteps?.find(
      (s) => s.kind.type === "player-pick",
    );
    expect(pickStep).toBeDefined();
    if (pickStep && pickStep.kind.type === "player-pick") {
      // 13 official factions across base + four expansions (Riverfolk,
      // Underworld, Marauders, Homeland), plus the second Vagabond
      // (Riverfolk variant, gated by the two-vagabonds toggle) = 14.
      expect(pickStep.kind.options).toHaveLength(14);
      // Factions are picked from the last seat back to the first.
      expect(pickStep.kind.pickOrder).toBe("reverse-seat");
      // The draft deals one more faction than there are seats.
      expect(pickStep.kind.draft).toEqual({ dealExtra: 1 });
      // Option ids must be unique: they are foreign keys for player
      // metadata + the mutex constraint references.
      const ids = pickStep.kind.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Mutex pair (Vagabond ↔ Knaves) declared on the step.
      expect(pickStep.kind.constraints).toContainEqual({
        type: "mutually-exclusive",
        optionIds: ["vagabond", "knaves"],
      });
    }
    // maxPlayers caps the table even though there are 13 options to
    // pick from.
    expect(root.maxPlayers).toBe(6);
    expect(root.score?.max).toBe(30);
    expect(root.score?.victory?.type).toBe("firstToMax");
  });
});

describe("Root rules held in config", () => {
  it("Law of Root A.6.3: hirelings are set up starting with the last player in turn order, going counterclockwise", () => {
    const step = rootDefinition.setupSteps?.find(
      (s) => s.id === "hireling-setup",
    );
    expect(step?.kind).toMatchObject({
      type: "dealt-resolve",
      order: "reverse-seat",
    });
  });
});
