import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  parseGameDefinition,
} from "@/state/gameDefinition";
import { GameSetupWizard } from "./GameSetupWizard";

/*
 * How a player-pick step runs comes from the definition: which seat
 * picks first and which way picking moves, and whether the table picks
 * from a dealt hand. Without either declared the wizard walks the seats
 * as listed and offers every legal option.
 */

// jsdom has no modal dialogs; the wizard opens itself with showModal.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLElement) {
    this.removeAttribute("open");
  };
});

const OPTIONS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

const fixture = (kind: Record<string, unknown> = {}) =>
  parseGameDefinition({
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: "fixture",
    name: "Fixture",
    defaultExpectedTurns: 30,
    defaultAverageSeconds: 60,
    setupSteps: [
      {
        id: "seating",
        label: "Seat players",
        kind: { type: "seat-players", minPlayers: 3, maxPlayers: 3 },
      },
      {
        id: "role",
        label: "Role",
        kind: {
          type: "player-pick",
          mode: "host-only",
          options: OPTIONS.map((label) => ({ id: label.toLowerCase(), label })),
          ...kind,
        },
      },
    ],
  });

const openPicker = async (kind?: Record<string, unknown>) => {
  const user = userEvent.setup();
  const definition = fixture(kind);
  render(
    <GameSetupWizard
      isOpen
      onSubmit={vi.fn()}
      definitions={[definition]}
      initialDefinitionId={definition.id}
    />,
  );
  while (!screen.queryByRole("heading", { name: "Role" }))
    await user.click(screen.getByRole("button", { name: /^Next/ }));
  return user;
};

const offered = () =>
  OPTIONS.filter((name) => screen.queryByRole("button", { name }));

const pickingOrder = async (kind?: Record<string, unknown>) => {
  const user = await openPicker(kind);
  const order: string[] = [];
  for (const option of OPTIONS.slice(0, 3)) {
    order.push(
      screen.getByText(/: choose (a|your) role$/).textContent?.split(":")[0] ??
        "",
    );
    await user.click(screen.getByRole("button", { name: option }));
    const confirm = screen.queryByRole("button", { name: "Confirm setup" });
    if (confirm) await user.click(confirm);
  }
  return order;
};

describe("player-pick order", () => {
  it("walks the seats in listed order when the definition declares none", async () => {
    expect(await pickingOrder()).toEqual(["Player 1", "Player 2", "Player 3"]);
  });

  it("starts from the last seat and walks back under reverse-seat", async () => {
    expect(await pickingOrder({ pickOrder: "reverse-seat" })).toEqual([
      "Player 3",
      "Player 2",
      "Player 1",
    ]);
  });
});

describe("player-pick draft", () => {
  it("offers every option and no draft without a declared one", async () => {
    await openPicker();
    expect(offered()).toEqual(OPTIONS);
    expect(
      screen.queryByRole("button", { name: /draft|shuffle/i }),
    ).not.toBeInTheDocument();
  });

  it("deals one option per seat plus the declared extra", async () => {
    const user = await openPicker({ draft: { dealExtra: 1 } });
    expect(offered()).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Skip draft" }));
    expect(offered()).toEqual(OPTIONS);
  });

  it("deals exactly one per seat with no extra", async () => {
    await openPicker({ draft: { dealExtra: 0 } });
    expect(offered()).toHaveLength(3);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Skip draft",
      }),
    ).toBeInTheDocument();
  });
});

describe("picking from the chosen lead", () => {
  const withLead = (
    lead: Record<string, unknown>,
    pick: Record<string, unknown>,
  ) =>
    parseGameDefinition({
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: "fixture-lead",
      name: "Fixture",
      defaultExpectedTurns: 30,
      defaultAverageSeconds: 60,
      setupSteps: [
        {
          id: "seating",
          label: "Seat players",
          kind: { type: "seat-players", minPlayers: 3, maxPlayers: 3 },
        },
        { id: "lead", label: "Lead", kind: { type: "select-lead", ...lead } },
        {
          id: "role",
          label: "Role",
          kind: {
            type: "player-pick",
            mode: "host-only",
            options: OPTIONS.map((label) => ({
              id: label.toLowerCase(),
              label,
            })),
            ...pick,
          },
        },
      ],
    });

  const open = async (definition: ReturnType<typeof withLead>) => {
    const user = userEvent.setup();
    render(
      <GameSetupWizard
        isOpen
        onSubmit={vi.fn()}
        definitions={[definition]}
        initialDefinitionId={definition.id}
      />,
    );
    while (!screen.queryByRole("heading", { name: "Lead" }))
      await user.click(screen.getByRole("button", { name: /^Next/ }));
    return user;
  };

  const pressedSeat = () =>
    ["Player 1", "Player 2", "Player 3"].filter(
      (name) =>
        screen.getByRole("button", { name }).getAttribute("aria-pressed") ===
        "true",
    );

  it("reverse-seat from the lead starts with the seat before the lead and ends with it", async () => {
    const user = await open(
      withLead({}, { pickOrder: "reverse-seat", pickFrom: "lead" }),
    );
    await user.click(screen.getByRole("button", { name: "Player 2" }));
    await user.click(screen.getByRole("button", { name: /^Next/ }));
    const order: string[] = [];
    for (const option of OPTIONS.slice(0, 3)) {
      order.push(
        screen
          .getByText(/: choose (a|your) role$/)
          .textContent?.split(":")[0] ?? "",
      );
      await user.click(screen.getByRole("button", { name: option }));
      const confirm = screen.queryByRole("button", { name: "Confirm setup" });
      if (confirm) await user.click(confirm);
    }
    expect(order).toEqual(["Player 1", "Player 3", "Player 2"]);
  });

  it("offers the first seat as lead unless the step defaults to a random one", async () => {
    await open(withLead({}, {}));
    expect(pressedSeat()).toEqual(["Player 1"]);
  });

  it("a random default lead lands on one of the seated players", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.9);
    await open(withLead({ defaultLead: "random" }, {}));
    expect(pressedSeat()).toEqual(["Player 3"]);
    random.mockRestore();
  });
});

describe("declared draft behaviour", () => {
  it("opens on every option when the draft starts off, and can switch to the deal", async () => {
    const user = await openPicker({ draft: { dealExtra: 1, startsOn: false } });
    expect(offered()).toEqual(OPTIONS);
    await user.click(screen.getByRole("button", { name: "Back to draft" }));
    expect(offered()).toHaveLength(4);
  });

  it("offers no way out of a draft that is not skippable", async () => {
    await openPicker({ draft: { dealExtra: 1, skippable: false } });
    expect(offered()).toHaveLength(4);
    expect(
      screen.queryByRole("button", { name: "Skip draft" }),
    ).not.toBeInTheDocument();
  });
});
