import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TurnOrder } from "@/state/gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
  gameSessionReducer,
} from "@/state/gameSession";
import { projectCommand, type SessionCommand } from "@/state/sessionCommands";
import { useTurnEntryControls } from "./useTurnEntryControls";

const ORDER: TurnOrder = {
  mode: "variable",
  entryKinds: [{ id: "x", label: "Kind X" }],
  entries: [{ id: "a", label: "Alpha", kind: "x", inPlay: false }],
  entryValues: {
    label: "Value",
    track: [10, 20, 30],
    steps: [{ id: "up", label: "Up", effect: "move", spaces: 1 }],
  },
  lists: [
    { id: "seats", label: "Seats", includePlayers: true },
    {
      id: "valued",
      label: "Valued",
      kinds: ["x"],
      orderBy: "value",
      ownerRequired: true,
    },
  ],
  phases: [
    { id: "open", label: "Open", list: "seats", next: "valued" },
    { id: "valued", label: "Valued", list: "valued", next: "open" },
  ],
};

const players = [
  { name: "Ann", color: "#a00" },
  { name: "Bo", color: "#0a0" },
];

const initial = (): GameSessionState =>
  projectCommand(
    createInitialGameSessionState({
      initialAverageSeconds: 60,
      expectedTurns: 10,
      players: players.map((p) => ({ name: p.name, metadata: {} })),
      turnOrder: ORDER,
    }),
    { type: "END_TURN" },
    0,
  );

function Harness({
  state,
  run,
}: {
  state: GameSessionState;
  run: (command: SessionCommand) => void;
}) {
  const controls = useTurnEntryControls({
    state,
    players,
    run,
    disabled: false,
  });
  return (
    <>
      <button type="button" onClick={controls.endPhase}>
        open end of phase
      </button>
      <button type="button" onClick={() => controls.addEntry("a")}>
        open add
      </button>
      {controls.overlays}
    </>
  );
}

describe("useTurnEntryControls across screens", () => {
  it("builds commands against the phase it showed", () => {
    const run = vi.fn();
    render(<Harness state={initial()} run={run} />);
    fireEvent.click(screen.getByText("open end of phase"));
    fireEvent.click(screen.getByRole("button", { name: "Valued" }));
    expect(run).toHaveBeenCalledWith({
      type: "SET_PHASE",
      phaseId: "valued",
      from: { phaseId: "open", run: 1 },
      undoGroup: expect.any(String),
    });
  });

  it("tags every command of one sheet with the sheet's undo group", () => {
    const state = projectCommand(
      initial(),
      { type: "ACTIVATE_ENTRY", entryId: "a", value: 20, playerIndex: 1 },
      0,
    );
    const run = vi.fn();
    function Panel() {
      const controls = useTurnEntryControls({
        state,
        players,
        run,
        disabled: false,
      });
      return (
        <>
          <button type="button" onClick={() => controls.openActions("a")}>
            open actions
          </button>
          {controls.overlays}
        </>
      );
    }
    render(<Panel />);
    fireEvent.click(screen.getByText("open actions"));
    fireEvent.click(screen.getByRole("button", { name: "Up to 30" }));
    fireEvent.click(screen.getByText("open actions"));
    fireEvent.click(screen.getByRole("button", { name: "Ann" }));
    const [first, second] = run.mock.calls.map(([c]) => c);
    expect(first).toMatchObject({ type: "SET_ENTRY_VALUE", value: 30 });
    expect(second).toMatchObject({ type: "SET_ENTRY_OWNER", playerIndex: 0 });
    // Two openings of the sheet are two flows.
    expect(first.undoGroup).toEqual(expect.any(String));
    expect(second.undoGroup).not.toBe(first.undoGroup);
  });

  it("closes the end-of-phase flow when another screen ends the phase", () => {
    // An entry in play, so the next phase has a turn to run.
    const state = projectCommand(
      initial(),
      { type: "ACTIVATE_ENTRY", entryId: "a", value: 20, playerIndex: 1 },
      0,
    );
    const { rerender } = render(<Harness state={state} run={vi.fn()} />);
    fireEvent.click(screen.getByText("open end of phase"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    act(() => {
      rerender(
        <Harness
          state={projectCommand(
            state,
            { type: "SET_PHASE", phaseId: "valued" },
            0,
          )}
          run={vi.fn()}
        />,
      );
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes an add sheet when another screen adds the entry", () => {
    const state = initial();
    const run = vi.fn();
    const { rerender } = render(<Harness state={state} run={run} />);
    fireEvent.click(screen.getByText("open add"));
    expect(screen.getByRole("dialog", { name: "Add Alpha" })).toBeTruthy();
    act(() => {
      rerender(
        <Harness
          state={projectCommand(
            state,
            { type: "ACTIVATE_ENTRY", entryId: "a", value: 20, playerIndex: 1 },
            0,
          )}
          run={run}
        />,
      );
    });
    expect(screen.queryByRole("dialog", { name: "Add Alpha" })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the end-of-phase exit question", () => {
  const withExitQuestion: TurnOrder = {
    ...ORDER,
    phases: [
      { ...ORDER.phases[0], exitPrompt: "Who starts next time?" },
      ORDER.phases[1],
    ],
  };

  function Table({ sent }: { sent: SessionCommand[] }) {
    const [state, setState] = useState(() =>
      projectCommand(
        projectCommand(
          createInitialGameSessionState({
            initialAverageSeconds: 60,
            expectedTurns: 10,
            players: players.map((p) => ({ name: p.name, metadata: {} })),
            turnOrder: withExitQuestion,
          }),
          { type: "END_TURN" },
          0,
        ),
        { type: "ACTIVATE_ENTRY", entryId: "a", value: 20, playerIndex: 1 },
        0,
      ),
    );
    const controls = useTurnEntryControls({
      state,
      players,
      run: (command) => {
        sent.push(command);
        setState((s) => projectCommand(s, command, 0));
      },
      disabled: false,
    });
    return (
      <>
        <p>Running: {state.activePhaseId}</p>
        <button type="button" onClick={controls.endPhase}>
          End phase
        </button>
        <button
          type="button"
          onClick={() =>
            setState((s) => gameSessionReducer(s, { type: "UNDO" }))
          }
        >
          Undo
        </button>
        {controls.overlays}
      </>
    );
  }

  it("is asked again when undo returns to its phase, and the new answer is the one sent", async () => {
    const user = userEvent.setup();
    const sent: SessionCommand[] = [];
    render(<Table sent={sent} />);

    await user.click(screen.getByRole("button", { name: "End phase" }));
    await user.click(screen.getByRole("button", { name: "Bo" }));
    await user.click(screen.getByRole("button", { name: "Valued" }));
    expect(screen.getByText("Running: valued")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Running: open")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "End phase" }));
    expect(
      screen.getByRole("alertdialog", { name: "Who starts next time?" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ann" }));
    await user.click(screen.getByRole("button", { name: "Valued" }));

    const exitAnswers = sent.flatMap((c) =>
      c.type === "SET_PHASE" ? [c.exitFirstEntryId] : [],
    );
    expect(exitAnswers).toEqual(["seat-1", "seat-0"]);
  });
});
