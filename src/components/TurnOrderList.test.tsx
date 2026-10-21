import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TurnOrderPanel } from "./TurnOrderPanel";
import { TurnOrderList, type TurnOrderRow } from "./TurnOrderList";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  gameSessionReducer,
  type GameSessionState,
  selectAvailableTurnEntries,
  selectTurnOrder,
} from "@/state/gameSession";
import type { TurnOrder } from "@/state/gameDefinition";

const row = (id: string, name: string): TurnOrderRow => ({
  id,
  name,
  color: "#888888",
  playerIndex: null,
  removable: false,
});

const ROWS = [row("a", "Alice"), row("b", "Bob"), row("c", "Carol")];

const names = () =>
  within(screen.getByRole("list", { name: "Turn order" }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-entry-id"));

// Stateful harness so moves re-render like the real page.
function Harness({
  onMove,
  initialRows = ROWS,
  moveWithinEqualValues,
}: {
  onMove?: (id: string, to: number) => void;
  initialRows?: TurnOrderRow[];
  moveWithinEqualValues?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  return (
    <TurnOrderList
      label="Turn order"
      rows={rows}
      activeId="a"
      moveWithinEqualValues={moveWithinEqualValues}
      onMove={(id, to) => {
        onMove?.(id, to);
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== id);
          next.splice(to, 0, prev.find((r) => r.id === id)!);
          return next;
        });
      }}
    />
  );
}

describe("TurnOrderList keyboard reordering", () => {
  it("moves a row with the arrow keys on its handle and announces it", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const handle = screen.getByRole("button", {
      name: "Reorder Carol, position 3 of 3",
    });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onMove).toHaveBeenLastCalledWith("c", 1);
    expect(names()).toEqual(["a", "c", "b"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carol moved to position 2 of 3. Next up: Carol.",
    );
    // The handle keeps focus as its row moves, and its label updates.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Reorder Carol, position 2 of 3" }),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(names()).toEqual(["c", "a", "b"]);
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(names()).toEqual(["a", "b", "c"]);
  });

  it("ignores moves past either end and unrelated keys", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const top = screen.getByRole("button", { name: /Reorder Alice/ });
    fireEvent.keyDown(top, { key: "ArrowUp" });
    fireEvent.keyDown(top, { key: "a" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks the active row, and only that row", () => {
    render(<Harness />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("is read-only without onMove", () => {
    render(<TurnOrderList label="Turn order" rows={ROWS} activeId="a" />);
    expect(screen.queryByRole("button", { name: /Reorder/ })).toBeNull();
  });
});

describe("TurnOrderList ordered by value", () => {
  const valued = (id: string, name: string, value: number) => ({
    ...row(id, name),
    value,
  });
  const VALUED_ROWS = [
    valued("a", "Alice", 80),
    valued("b", "Bob", 80),
    valued("c", "Carol", 70),
    valued("d", "Dan", 60),
    valued("e", "Eve", 60),
  ];

  it("gives a handle only to rows sharing a value with a neighbour", () => {
    render(<Harness initialRows={VALUED_ROWS} moveWithinEqualValues />);
    for (const name of ["Alice", "Bob", "Dan", "Eve"])
      expect(
        screen.getByRole("button", { name: new RegExp(`^Reorder ${name}`) }),
      ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reorder Carol/ })).toBeNull();
  });

  it("moves a row among its equals and refuses to cross another value", () => {
    const onMove = vi.fn();
    render(
      <Harness
        initialRows={VALUED_ROWS}
        moveWithinEqualValues
        onMove={onMove}
      />,
    );
    const bob = screen.getByRole("button", { name: /^Reorder Bob/ });
    bob.focus();
    fireEvent.keyDown(bob, { key: "ArrowDown" });
    fireEvent.keyDown(bob, { key: "End" });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(bob, { key: "ArrowUp" });
    expect(onMove).toHaveBeenLastCalledWith("b", 0);
    expect(names()).toEqual(["b", "a", "c", "d", "e"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Bob moved to position 1 of 5.",
    );
    const dan = screen.getByRole("button", { name: /^Reorder Dan/ });
    fireEvent.keyDown(dan, { key: "End" });
    expect(onMove).toHaveBeenLastCalledWith("d", 4);
    expect(names()).toEqual(["b", "a", "c", "e", "d"]);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Reorder Dan/ }), {
      key: "Home",
    });
    expect(onMove).toHaveBeenLastCalledWith("d", 3);
    expect(names()).toEqual(["b", "a", "c", "d", "e"]);
  });
});

describe("TurnOrderPanel with a variable turn order", () => {
  const players = [
    { name: "Alice", color: "#E8A33D" },
    { name: "Bob", color: "#2862A1" },
    { name: "Carol", color: "#73AB48" },
  ];

  function Panel({ advance }: { advance?: () => void }) {
    const [state, setState] = useState<GameSessionState>(() =>
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 30,
        players: players.map((p) => ({ name: p.name, metadata: {} })),
        turnOrder: { mode: "variable" },
      }),
    );
    const view = selectTurnOrder(state)!;
    return (
      // Stand-in for the tap-to-advance ring around everything.
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness
      <div onClick={advance}>
        <TurnOrderPanel
          players={players}
          turnOrder={{
            view,
            onMove: (entryId, toIndex) =>
              setState((s) =>
                gameSessionReducer(s, {
                  type: "REORDER_TURN_ENTRY",
                  entryId,
                  toIndex,
                }),
              ),
          }}
        />
      </div>
    );
  }

  it("renders without a score config, open, with no toggle to hide it", () => {
    render(<Panel />);
    expect(names()).toEqual(["seat-0", "seat-1", "seat-2"]);
    expect(screen.queryByRole("button", { name: /turn order$/ })).toBeNull();
  });

  it("keyboard reorder changes who is next without advancing the turn", () => {
    const advance = vi.fn();
    render(<Panel advance={advance} />);
    const carol = screen.getByRole("button", { name: /Reorder Carol/ });
    fireEvent.keyDown(carol, { key: "ArrowUp" });
    expect(names()).toEqual(["seat-0", "seat-2", "seat-1"]);
    fireEvent.click(carol);
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("TurnOrderPanel with several lists and entries to add", () => {
  const players = [
    { name: "Alice", color: "#E8A33D" },
    { name: "Bob", color: "#2862A1" },
  ];
  const turnOrder: TurnOrder = {
    mode: "variable",
    entryKinds: [
      { id: "small", label: "Small" },
      { id: "big", label: "Big" },
    ],
    entries: [
      { id: "s1", label: "Sparrow", kind: "small", inPlay: false },
      { id: "s2", label: "Wren", kind: "small", inPlay: false },
      { id: "b1", label: "Heron", kind: "big", inPlay: false },
    ],
    lists: [
      { id: "people", label: "People", includePlayers: true },
      { id: "birds", label: "Birds", kinds: ["small", "big"] },
    ],
    phases: [
      { id: "p", label: "People phase", list: "people" },
      { id: "b", label: "Bird phase", list: "birds" },
    ],
  };

  function Panel({ advance }: { advance?: () => void }) {
    const [state, setState] = useState<GameSessionState>(() =>
      createInitialGameSessionState({
        initialAverageSeconds: 60,
        expectedTurns: 30,
        players: players.map((p) => ({ name: p.name, metadata: {} })),
        turnOrder,
      }),
    );
    const dispatch = (action: GameSessionAction) =>
      setState((s) => gameSessionReducer(s, action));
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness
      <div onClick={advance}>
        <TurnOrderPanel
          players={players}
          turnOrder={{
            view: selectTurnOrder(state)!,
            onRemove: (entryId) =>
              dispatch({ type: "DEACTIVATE_TURN_ENTRY", entryId }),
            onAdd: (id) =>
              dispatch({ type: "ACTIVATE_TURN_ENTRY", entry: { id } }),
            lists: ["people", "birds"].map((id) => ({
              view: selectTurnOrder(state, id)!,
              available: selectAvailableTurnEntries(state, id),
            })),
          }}
        />
      </div>
    );
  }

  // The turn order is always open.
  const open = () => {
    expect(screen.getByRole("region", { name: "Turn order" })).toBeVisible();
  };
  const birdsList = () => screen.getByRole("list", { name: "Birds" });

  it("shows the running list first and switches lists with the tabs", () => {
    render(<Panel />);
    open();
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("list", { name: "People" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Birds" }));
    expect(birdsList()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Birds" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("adds several entries from a sheet grouped by kind, without advancing", () => {
    const advance = vi.fn();
    render(<Panel advance={advance} />);
    open();
    // The players list has nothing to add.
    expect(screen.queryByRole("button", { name: "Add to People" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Birds" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Birds" }));
    const sheet = screen.getByRole("dialog", { name: "Add to Birds" });
    const small = within(sheet).getByRole("region", { name: "Small" });
    expect(
      within(small)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Sparrow", "Wren"]);
    expect(
      within(within(sheet).getByRole("region", { name: "Big" })).getByRole(
        "button",
        { name: "Add Heron" },
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Wren" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Heron" }));
    // Added entries leave the sheet; it stays open for more.
    expect(
      within(sheet).queryByRole("button", { name: "Add Wren" }),
    ).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      within(birdsList())
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-entry-id")),
    ).toEqual(["s2", "b1"]);
    // A list that is not running marks no row as active.
    for (const item of within(birdsList()).getAllByRole("listitem"))
      expect(item).not.toHaveAttribute("aria-current");
    expect(advance).not.toHaveBeenCalled();
  });

  it("removes an entry back into the sheet", () => {
    render(<Panel />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Birds" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Birds" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Sparrow" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Sparrow from turn order" }),
    );
    expect(within(birdsList()).queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add to Birds" }));
    expect(
      screen.getByRole("button", { name: "Add Sparrow" }),
    ).toBeInTheDocument();
  });
});

describe("TurnOrderList played rows", () => {
  const played = [{ ...row("a", "Alice"), spent: true }, row("b", "Bob")];

  it("announces a played row in its text and its controls", () => {
    render(
      <TurnOrderList
        label="Turn order"
        rows={played}
        activeId="b"
        onMove={vi.fn()}
        onRowActions={vi.fn()}
      />,
    );
    const [alice, bob] = within(
      screen.getByRole("list", { name: "Turn order" }),
    ).getAllByRole("listitem");
    expect(alice).toHaveTextContent("Alice, played this round");
    expect(bob).not.toHaveTextContent(/played/);
    expect(
      screen.getByRole("button", {
        name: "Actions for Alice, played this round",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reorder Alice, played this round, position 1 of 2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for Bob" }),
    ).toBeInTheDocument();
  });
});
