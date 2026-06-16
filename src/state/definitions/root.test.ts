import { describe, expect, it } from "vitest";
import {
  optionVisibleUnderContext,
  type SetupContext,
  type SetupOption,
} from "../gameDefinition";
import { rootDefinition } from "./root";

/*
 * Root hireling module gating. Hirelings are sold in standalone
 * Hirelings Packs, NOT the same-named faction expansions, and each pack
 * supplies its own meeples (Law of Root H.3.3 — a hireling never needs
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
