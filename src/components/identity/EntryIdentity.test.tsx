import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TurnEntry } from "@/state/gameSession";
import { entryToRow, TurnOrderList } from "../TurnOrderList";
import { TurnEntryBanner } from "./EntryBanner";

const combined: TurnEntry = {
  id: "group",
  label: "North Side Field Group",
  kind: "big",
  color: "#d88f5e",
  identity: { typeStyle: "wide", symbol: "magnet" },
  nameParts: { title: "Group", lineage: ["North Side", "Field"] },
  playerIndex: 1,
  value: 80,
};

const plain: TurnEntry = {
  id: "field",
  label: "Field",
  kind: "small",
  color: "#536e54",
  identity: { typeStyle: "condensed", symbol: "sunrise" },
  playerIndex: 0,
  value: 70,
};

const players = [
  { name: "Ann", color: "#f00" },
  { name: "Bo", color: "#0f0" },
];

// An element whose whole text reads `text`, however it is split up.
const reading = (text: string) =>
  screen.getByText(
    (_, el) =>
      el?.textContent === text &&
      Array.from(el.children).every((c) => c.textContent !== text),
  );

describe("turn banner for an entry", () => {
  const banner = (entry: TurnEntry) =>
    render(
      <TurnEntryBanner
        entry={entry}
        prominentKinds={["big"]}
        fallbackColor="#fff"
        subheading="Bo"
      />,
    );

  it("reads a combined name naturally, lineage first, then the owner", () => {
    banner(combined);
    const group = screen.getByRole("group", { name: "Whose turn" });
    expect(reading("North Side Field Group’s turn")).toBeVisible();
    // The lineage line above the title has no joiner between the names.
    expect(reading("North Side Field")).toBeInTheDocument();
    expect(within(group).getByText("Bo")).toBeVisible();
  });

  it("follows the lineage order it was given", () => {
    banner({
      ...combined,
      nameParts: { title: "Group", lineage: ["Field", "North Side"] },
    });
    expect(reading("Field North Side Group’s turn")).toBeVisible();
  });

  it("sets the title in the entry's type style and draws its symbol", () => {
    const { container } = banner(combined);
    expect(screen.getByText("Group")).toHaveAttribute(
      "data-type-style",
      "wide",
    );
    expect(container.querySelector('[data-symbol="magnet"]')).not.toBeNull();
  });

  it("names a plain entry on its own", () => {
    banner(plain);
    expect(reading("Field’s turn")).toBeVisible();
    // The banner always uses the type style, prominent kind or not.
    expect(screen.getByText("Field")).toHaveAttribute(
      "data-type-style",
      "condensed",
    );
  });
});

describe("turn order rows for entries", () => {
  const list = () =>
    render(
      <TurnOrderList
        label="Things"
        rows={[combined, plain].map((e) =>
          entryToRow(e, players, { big: "Big", small: "Small" }),
        )}
        activeId="group"
        onRowActions={() => {}}
      />,
    );

  it("names a combined row naturally for its actions", () => {
    list();
    expect(
      screen.getByRole("button", {
        name: "Actions for North Side Field Group",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Actions for Field" }),
    ).toBeVisible();
  });

  it("draws each title in its type style, keeps the lineage for assistive tech only, and puts the owner beneath", () => {
    list();
    const [first, second] = within(
      screen.getByRole("list", { name: "Things" }),
    ).getAllByRole("listitem");
    expect(within(first).getByText("Group")).toHaveAttribute(
      "data-type-style",
      "wide",
    );
    expect(within(second).getByText("Field")).toHaveAttribute(
      "data-type-style",
      "condensed",
    );
    // Read in full, but the lineage is not drawn in a list.
    expect(first).toHaveTextContent("North Side Field Group");
    expect(within(first).getByText(/North Side Field/)).toHaveClass(/srOnly/);
    expect(within(first).getByText("Bo")).toBeVisible();
    // Rows carry no kind label.
    expect(first).not.toHaveTextContent("Big");
  });

  it("turns a played entry's token face down", () => {
    const { container } = render(
      <TurnOrderList
        label="Things"
        rows={[{ ...entryToRow(plain, players, {}), spent: true }]}
        activeId={null}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Field, played this round",
    );
    const token = container.querySelector('[data-symbol="sunrise"]');
    expect(token).toHaveAttribute("data-face-down", "true");
    expect(token?.querySelector("svg")).toBeNull();
  });
});
