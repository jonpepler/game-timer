import { describe, expect, it } from "vitest";
import { isBuiltIn, listDefinitions } from "@/state/definitionRegistry";

/*
 * Choosing modules and seating players needs no explanation: the game
 * already bounds the seat count and the wizard enforces it. Built-in
 * games keep those screens to their labels.
 */
describe("built-in setup copy", () => {
  const builtIns = listDefinitions().filter((d) => isBuiltIn(d.id));

  it("gives module and seating steps no subtitle", () => {
    for (const definition of builtIns)
      for (const step of definition.setupSteps ?? [])
        if (
          step.kind.type === "multi-toggle" ||
          step.kind.type === "seat-players"
        )
          expect(step.description, `${definition.id}/${step.id}`).toBe(
            undefined,
          );
  });

  it("gives module options no description", () => {
    for (const definition of builtIns)
      for (const step of definition.setupSteps ?? [])
        if (step.kind.type === "multi-toggle")
          for (const option of step.kind.options)
            expect(
              option.description,
              `${definition.id}/${step.id}/${option.id}`,
            ).toBe(undefined);
  });
});
