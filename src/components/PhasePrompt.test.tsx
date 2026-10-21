import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhasePrompt, type PhasePromptPhase } from "./PhasePrompt";
import { PhaseBar } from "./timer/PhaseBar";

const PHASES: PhasePromptPhase[] = [
  { id: "p", label: "Player phase", firstEntryPrompt: "Who goes first?" },
  { id: "o1", label: "Round 1" },
  { id: "o2", label: "Round 2" },
  { id: "x", label: "Extra round" },
];

const ENTRIES = [
  { id: "seat-0", name: "Ann", color: "#f00" },
  { id: "seat-1", name: "Ben", color: "#0f0" },
];

const renderPrompt = (
  overrides: Partial<Parameters<typeof PhasePrompt>[0]>,
) => {
  const props = {
    title: "Round 1 complete",
    phases: PHASES,
    currentId: "o1",
    defaultNextId: "o2",
    entriesFor: (id: string) => (id === "p" ? ENTRIES : []),
    onStart: vi.fn(),
    onDismiss: vi.fn(),
    dismissLabel: "Keep playing Round 1",
    ...overrides,
  };
  render(<PhasePrompt {...props} />);
  return props;
};

describe("PhasePrompt", () => {
  it("offers the default next phase first and focuses it", () => {
    const { onStart } = renderPrompt({});
    expect(
      screen.getByRole("alertdialog", { name: "Round 1 complete" }),
    ).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "Round 2" });
    expect(primary).toHaveFocus();
    fireEvent.click(primary);
    expect(onStart).toHaveBeenCalledWith("o2");
  });

  it("names every choice exactly as the game names its phases", () => {
    renderPrompt({});
    const choices = screen.getAllByRole("button").map((b) => b.textContent);
    expect(choices).toEqual([
      "Round 2",
      "Player phase",
      "Round 1 again",
      "Extra round",
      "Keep playing Round 1",
    ]);
    expect(screen.queryByText(/choose/i)).not.toBeInTheDocument();
  });

  it("lists the other phases, the current one as a repeat", () => {
    const { onStart } = renderPrompt({});
    expect(
      screen.getByRole("button", { name: "Round 1 again" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Extra round" }));
    expect(onStart).toHaveBeenCalledWith("x");
  });

  it("asks who goes first for a phase that wants it, with a way back", () => {
    const { onStart } = renderPrompt({ defaultNextId: "p" });
    fireEvent.click(screen.getByRole("button", { name: "Player phase" }));
    expect(
      screen.getByRole("alertdialog", { name: "Who goes first?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Player phase" }));
    fireEvent.click(screen.getByRole("button", { name: "Ben" }));
    expect(onStart).toHaveBeenCalledWith("p", "seat-1");
  });

  it("skips the question when there is only one entry to choose", () => {
    const { onStart } = renderPrompt({
      defaultNextId: "p",
      entriesFor: () => ENTRIES.slice(0, 1),
    });
    fireEvent.click(screen.getByRole("button", { name: "Player phase" }));
    expect(onStart).toHaveBeenCalledWith("p");
  });

  it("dismisses with its button or Escape", () => {
    const { onDismiss } = renderPrompt({});
    fireEvent.click(
      screen.getByRole("button", { name: "Keep playing Round 1" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("does not let clicks reach a turn-advancing ancestor", () => {
    const advance = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness
      <div onClick={advance}>
        <PhasePrompt
          title="T"
          phases={PHASES}
          currentId="o1"
          defaultNextId="o2"
          entriesFor={() => []}
          onStart={() => {}}
          onDismiss={() => {}}
          dismissLabel="Cancel"
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Round 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("PhaseBar", () => {
  it("shows the phase and ends it without advancing", () => {
    const advance = vi.fn();
    const onEnd = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness
      <div onClick={advance}>
        <PhaseBar phaseLabel="Round 1" onEnd={onEnd} />
      </div>,
    );
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End Round 1" }));
    expect(onEnd).toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("is a plain indicator without onEnd", () => {
    render(<PhaseBar phaseLabel="Round 1" />);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
