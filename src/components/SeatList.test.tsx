import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlayersSheet } from "./PlayersSheet";
import { SeatList, type SeatListSeat } from "./SeatList";

const SEATS: SeatListSeat[] = [
  { id: "a", name: "Ada", colorId: "red" },
  { id: "b", name: "Bo", colorId: "blue" },
  { id: "c", name: "Cy" },
];
const COLORS = [
  { id: "red", label: "Red", color: "#f00" },
  { id: "blue", label: "Blue", color: "#00f" },
];

describe("SeatList", () => {
  it("shows names without any controls when given no edits", () => {
    render(<SeatList seats={SEATS} label="Seats" />);
    const list = screen.getByRole("list", { name: "Seats" });
    expect(list).toHaveTextContent("Ada");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sends nothing while typing, then the trimmed name once on Enter", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SeatList seats={SEATS} label="Seats" onRename={onRename} />);
    const field = screen.getByRole("textbox", { name: "Seat 2 name" });
    await user.clear(field);
    await user.type(field, "Bea ");
    expect(onRename).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(1, "Bea");
    expect(field).not.toHaveFocus();
  });

  it("sends the name once on leaving the field", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SeatList seats={SEATS} label="Seats" onRename={onRename} />);
    const field = screen.getByRole("textbox", { name: "Seat 1 name" });
    await user.type(field, "na");
    await user.tab();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(0, "Adana");
  });

  it("keeps what was typed through an echo until it is sent", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const { rerender } = render(
      <SeatList seats={SEATS} label="Seats" onRename={onRename} />,
    );
    const field = screen.getByRole("textbox", { name: "Seat 2 name" });
    await user.type(field, "b");
    // Another screen renames the seat while this one is mid-edit.
    rerender(
      <SeatList
        seats={SEATS.map((s) => (s.id === "b" ? { ...s, name: "Bea" } : s))}
        label="Seats"
        onRename={onRename}
      />,
    );
    expect(field).toHaveValue("Bob");
  });

  it("puts the stored name back on Escape and sends nothing", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SeatList seats={SEATS} label="Seats" onRename={onRename} />);
    const field = screen.getByRole("textbox", { name: "Seat 3 name" });
    await user.type(field, "rus");
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("Cy");
    await user.tab();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("sends nothing for a cleared or unchanged name", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SeatList seats={SEATS} label="Seats" onRename={onRename} />);
    const field = screen.getByRole("textbox", { name: "Seat 1 name" });
    await user.clear(field);
    await user.tab();
    expect(field).toHaveValue("Ada");
    await user.click(field);
    await user.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("offers name and colour edits only on the seats it may edit", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onColor = vi.fn();
    render(
      <SeatList
        seats={SEATS}
        label="Seats"
        colorOptions={COLORS}
        onRename={onRename}
        onColor={onColor}
        canEdit={(i) => i === 1}
      />,
    );
    expect(screen.getAllByRole("textbox")).toEqual([
      screen.getByRole("textbox", { name: "Seat 2 name" }),
    ]);
    expect(screen.getAllByRole("radiogroup")).toEqual([
      screen.getByRole("radiogroup", { name: "Bo colour" }),
    ]);
    expect(screen.getByRole("list", { name: "Seats" })).toHaveTextContent(
      "Ada",
    );
    await user.click(screen.getByRole("radio", { name: "Red" }));
    expect(onColor).toHaveBeenCalledWith(1, "red");
  });

  it("moves, removes and adds seats within the bounds", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const onAdd = vi.fn();
    render(
      <SeatList
        seats={SEATS}
        label="Seats"
        minPlayers={2}
        maxPlayers={3}
        onMove={onMove}
        onRemove={onRemove}
        canRemove={(i) => i !== 1}
        onAdd={onAdd}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Move seat 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move seat 3 down" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move seat 3 up" }));
    expect(onMove).toHaveBeenCalledWith(2, 1);
    expect(
      screen.queryByRole("button", { name: "Remove seat 2" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove seat 3" }));
    expect(onRemove).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Add seat" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("picks a colour per seat", async () => {
    const user = userEvent.setup();
    const onColor = vi.fn();
    render(
      <SeatList
        seats={SEATS}
        label="Seats"
        colorOptions={COLORS}
        onColor={onColor}
      />,
    );
    const ada = screen.getByRole("radiogroup", { name: "Ada colour" });
    expect(within(ada).getByRole("radio", { name: "Red" })).toBeChecked();
    const cy = screen.getByRole("radiogroup", { name: "Cy colour" });
    await user.click(within(cy).getByRole("radio", { name: "Blue" }));
    expect(onColor).toHaveBeenCalledWith(2, "blue");
  });
});

describe("PlayersSheet", () => {
  it("renames players without the taps reaching the timer behind it", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onClose = vi.fn();
    const advance = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the tap-to-advance timer
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the tap-to-advance timer
      <div onClick={advance}>
        <PlayersSheet
          players={[{ name: "Ada" }, { name: "Bo" }]}
          onRename={onRename}
          onClose={onClose}
        />
      </div>,
    );
    const sheet = screen.getByRole("dialog", { name: "Players" });
    const field = screen.getByRole("textbox", { name: "Seat 2 name" });
    await user.click(field);
    await user.type(field, "b");
    expect(onRename).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRename).toHaveBeenCalledWith(1, "Bob");
    expect(onClose).toHaveBeenCalled();
    expect(sheet).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it("lets a player edit only the rows it may edit", () => {
    render(
      <PlayersSheet
        players={[{ name: "Ada" }, { name: "Bo" }]}
        onRename={vi.fn()}
        canEdit={(i) => i === 0}
        onClose={vi.fn()}
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "Players" });
    expect(within(sheet).getAllByRole("textbox")).toEqual([
      within(sheet).getByRole("textbox", { name: "Seat 1 name" }),
    ]);
    expect(sheet).toHaveTextContent("Bo");
  });
});
