import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { valueStepChoices } from "@/hooks/useTurnEntryControls";
import type { EntryValues } from "@/state/gameDefinition";
import { ValueStepPrompt } from "./ValueStepPrompt";

const VALUES: EntryValues = {
  label: "Value",
  track: [0, 10, 20, 70, 80, 90, 100, 120, 135],
  steps: [
    { id: "gone", label: "Gone", hint: "Out of play", effect: "remove" },
    { id: "down", label: "Down", effect: "move", spaces: -1 },
    { id: "same", label: "Same", effect: "move", spaces: 0 },
    { id: "up", label: "Up", effect: "move", spaces: 1 },
    { id: "up2", label: "Up two", effect: "move", spaces: 2 },
  ],
};

const renderPrompt = (value = 100) => {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  const advance = vi.fn();
  render(
    // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
    // biome-ignore lint/a11y/noStaticElementInteractions: test harness
    <div onClick={advance}>
      <ValueStepPrompt
        entryName="Alpha"
        entryColor="#336699"
        ownerName="Player 2"
        valueLabel="Value"
        value={value}
        steps={valueStepChoices(VALUES, value)}
        onChoose={onChoose}
        onCancel={onCancel}
      />
    </div>,
  );
  return { onChoose, onCancel, advance };
};

describe("ValueStepPrompt", () => {
  it("names the entry and its owner and shows the current value", () => {
    renderPrompt();
    const dialog = screen.getByRole("dialog", { name: "End Alpha’s turn" });
    expect(within(dialog).getByText("Player 2")).toBeInTheDocument();
    expect(within(dialog).getByText(/Value now/)).toHaveTextContent(
      "Value now 100",
    );
  });

  it("shows where each step lands along a non-uniform track", () => {
    renderPrompt();
    for (const name of [
      "Down, Value 90",
      "Same, Value 100",
      "Up, Value 120",
      "Up two, Value 135",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Removing has no resulting value, only its hint.
    expect(screen.getByRole("button", { name: "Gone" })).toHaveTextContent(
      "Out of play",
    );
  });

  it("clamps at the top of the track", () => {
    renderPrompt(135);
    expect(
      screen.getByRole("button", { name: "Up two, Value 135" }),
    ).toBeInTheDocument();
  });

  it("reports the chosen step without advancing the turn underneath", () => {
    const { onChoose, advance } = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Down, Value 90" }));
    expect(onChoose).toHaveBeenCalledWith("down");
    expect(advance).not.toHaveBeenCalled();
  });

  it("picks an icon from what each step does", () => {
    renderPrompt();
    const icon = (name: string) =>
      screen
        .getByRole("button", { name })
        .querySelector("svg")
        ?.getAttribute("class");
    expect(icon("Gone")).toMatch(/ban/);
    expect(icon("Down, Value 90")).toMatch(/arrow-down/);
    expect(icon("Same, Value 100")).toMatch(/equal/);
    expect(icon("Up, Value 120")).toMatch(/arrow-up/);
    expect(icon("Up two, Value 135")).toMatch(/chevrons-up/);
  });

  it("cancels with its button or Escape", () => {
    const { onCancel } = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("ValueStepPrompt steps heading", () => {
  it("heads and names the answers with the configured label", () => {
    render(
      <ValueStepPrompt
        entryName="Alpha"
        valueLabel="Value"
        stepsLabel="Value change (steps)"
        value={100}
        steps={valueStepChoices(VALUES, 100)}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Value change (steps)" }),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Value change (steps)" });
    expect(
      within(list).getByRole("button", { name: "Up, Value 120" }),
    ).toBeInTheDocument();
  });

  it("names the answers after the value without a heading", () => {
    renderPrompt();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getByRole("list", { name: "New Value" })).toBeInTheDocument();
  });
});
