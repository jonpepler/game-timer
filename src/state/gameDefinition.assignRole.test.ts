import { describe, expect, it } from "vitest";
import {
  type GameDefinition,
  parseGameDefinition,
  type SetupContext,
  safeParseGameDefinition,
  visibleSetupSteps,
} from "./gameDefinition";

const roles = {
  defaultRole: "member",
  roles: [
    { id: "member", label: "Member" },
    { id: "deputy", label: "Deputy" },
    { id: "head", label: "Head", leadsRound: true, unique: true },
  ],
};

const base = (setupSteps: unknown[]) => ({
  schemaVersion: 1,
  id: "test",
  name: "Test",
  defaultExpectedTurns: 30,
  defaultAverageSeconds: 60,
  turnOrder: { mode: "lead-relative" },
  playerRoles: roles,
  setupSteps: [
    { id: "seating", label: "Seat players", kind: { type: "seat-players" } },
    ...setupSteps,
  ],
});

const headStep = {
  id: "head",
  label: "Head",
  kind: { type: "assign-role", role: "head", noneLabel: "No head" },
};

describe("assign-role step schema", () => {
  it("accepts a step naming a declared role", () => {
    expect(() => parseGameDefinition(base([headStep]))).not.toThrow();
  });

  it("rejects a step naming an undeclared role", () => {
    expect(
      safeParseGameDefinition(
        base([{ ...headStep, kind: { type: "assign-role", role: "nobody" } }]),
      ).success,
    ).toBe(false);
  });

  it("rejects many holders of a unique role", () => {
    expect(
      safeParseGameDefinition(
        base([
          {
            ...headStep,
            kind: { type: "assign-role", role: "head", many: true },
          },
        ]),
      ).success,
    ).toBe(false);
  });

  it("rejects a role gate that names no earlier assign-role step", () => {
    expect(
      safeParseGameDefinition(
        base([
          {
            id: "first",
            label: "First",
            visibleWhen: { type: "role-unassigned", step: "head" },
            kind: { type: "select-lead" },
          },
          headStep,
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("role gates", () => {
  const def: GameDefinition = parseGameDefinition(
    base([
      headStep,
      {
        id: "first",
        label: "First",
        visibleWhen: { type: "role-unassigned", step: "head" },
        kind: { type: "select-lead" },
      },
      {
        id: "deputies",
        label: "Deputies",
        visibleWhen: { type: "role-assigned", step: "head" },
        kind: { type: "assign-role", role: "deputy", many: true },
      },
    ]),
  );
  const ids = (context: SetupContext) =>
    visibleSetupSteps(def, context).map((s) => s.id);

  it("shows the unassigned branch while no seat holds the role", () => {
    const shown = ids({ head: { kind: "assign-role", seatIndices: [] } });
    expect(shown).toContain("first");
    expect(shown).not.toContain("deputies");
  });

  it("shows the assigned branch once a seat holds the role", () => {
    const shown = ids({ head: { kind: "assign-role", seatIndices: [1] } });
    expect(shown).toContain("deputies");
    expect(shown).not.toContain("first");
  });
});
