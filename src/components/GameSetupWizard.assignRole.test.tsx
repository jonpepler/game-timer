import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  parseGameDefinition,
} from "@/state/gameDefinition";
import { GameSetupWizard } from "./GameSetupWizard";

/*
 * An assign-role step gives one of the definition's player roles to the
 * seats the table picks: one seat or none, or any number of seats. Later
 * steps can show only when the role was, or was not, given.
 */

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLElement) {
    this.removeAttribute("open");
  };
});

const definition = parseGameDefinition({
  schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
  id: "fixture",
  name: "Fixture",
  defaultExpectedTurns: 30,
  defaultAverageSeconds: 60,
  turnOrder: { mode: "lead-relative" },
  playerRoles: {
    defaultRole: "member",
    roles: [
      { id: "member", label: "Member" },
      { id: "deputy", label: "Deputy" },
      { id: "head", label: "Head", leadsRound: true, unique: true },
    ],
  },
  setupSteps: [
    {
      id: "seating",
      label: "Seat players",
      kind: { type: "seat-players", minPlayers: 3, maxPlayers: 3 },
    },
    {
      id: "head",
      label: "Head",
      kind: { type: "assign-role", role: "head", noneLabel: "No head" },
    },
    {
      id: "deputies",
      label: "Deputies",
      visibleWhen: { type: "role-assigned", step: "head" },
      kind: { type: "assign-role", role: "deputy", many: true },
    },
    {
      id: "first",
      label: "First player",
      visibleWhen: { type: "role-unassigned", step: "head" },
      kind: { type: "select-lead" },
    },
  ],
});

const open = async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(
    <GameSetupWizard
      isOpen
      onSubmit={onSubmit}
      definitions={[definition]}
      initialDefinitionId={definition.id}
    />,
  );
  const next = async (heading: string) => {
    while (!screen.queryByRole("heading", { name: heading }))
      await user.click(screen.getByRole("button", { name: /^Next/ }));
  };
  return { user, onSubmit, next };
};

describe("assign-role setup step", () => {
  it("offers each seat and a none choice, starting on none", async () => {
    const { next } = await open();
    await next("Head");
    for (const name of ["Player 1", "Player 2", "Player 3", "No head"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No head" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("with the role given, asks the next role for the other seats only", async () => {
    const { user, next } = await open();
    await next("Head");
    await user.click(screen.getByRole("button", { name: "Player 2" }));
    await next("Deputies");
    expect(
      screen.queryByRole("checkbox", { name: "Player 2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Player 1" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Player 3" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("heading", { name: "First player" }),
    ).not.toBeInTheDocument();
  });

  it("with no one given the role, asks for the first player instead", async () => {
    const { user, next } = await open();
    await next("Head");
    await user.click(screen.getByRole("button", { name: /^Next/ }));
    expect(
      screen.getByRole("heading", { name: "First player" }),
    ).toBeInTheDocument();
  });

  it("submits the seats each role went to", async () => {
    const { user, onSubmit, next } = await open();
    await next("Head");
    await user.click(screen.getByRole("button", { name: "Player 3" }));
    await next("Deputies");
    await user.click(screen.getByRole("checkbox", { name: "Player 1" }));
    await user.click(screen.getByRole("button", { name: /start game/i }));
    const config = onSubmit.mock.calls[0][0];
    expect(config.setupContext.head).toEqual({
      kind: "assign-role",
      seatIndices: [2],
    });
    expect(config.setupContext.deputies).toEqual({
      kind: "assign-role",
      seatIndices: [0],
    });
  });
});
