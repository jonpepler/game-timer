import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScorePanel } from "./ScorePanel";
import type { ScoreConfig } from "@/state/gameDefinition";

const PLAYERS = [
  { name: "Alice", color: "#E8A33D" },
  { name: "Bob", color: "#2862A1" },
  { name: "Carol", color: "#73AB48" },
];

const CONFIG: ScoreConfig = {
  displayStyle: "linearTrack",
  min: 0,
  max: 30,
  increment: 1,
  victory: { type: "firstToMax" },
};

describe("ScorePanel — catch-up stack", () => {
  it("hides the others stack by default and reveals it on toggle", () => {
    render(
      <ScorePanel
        players={PLAYERS}
        scores={{ 0: 5, 1: 2, 2: 0 }}
        scoreConfig={CONFIG}
        onIncrement={() => {}}
        activePlayerIndex={0}
      />,
    );
    // Toggle starts collapsed.
    const toggle = screen.getByRole("button", { name: /show other scores/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("group", { name: /other player scores/i }),
    ).toBeNull();

    fireEvent.click(toggle);
    expect(
      screen.getByRole("group", { name: /other player scores/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hide other scores/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("bumps a non-active player's score from the stack", () => {
    const onIncrement = vi.fn();
    render(
      <ScorePanel
        players={PLAYERS}
        scores={{ 0: 5, 1: 2, 2: 0 }}
        scoreConfig={CONFIG}
        onIncrement={onIncrement}
        activePlayerIndex={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show other scores/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /increase score for Bob/i }),
    );
    expect(onIncrement).toHaveBeenCalledWith(1, 1);
  });

  it("omits the active player from the stack", () => {
    render(
      <ScorePanel
        players={PLAYERS}
        scores={{ 0: 5, 1: 2, 2: 0 }}
        scoreConfig={CONFIG}
        onIncrement={() => {}}
        activePlayerIndex={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show other scores/i }));
    const group = screen.getByRole("group", { name: /other player scores/i });
    // Active player Bob isn't in the stack; the other two are.
    expect(group).not.toHaveTextContent(/Bob/);
    expect(group).toHaveTextContent(/Alice/);
    expect(group).toHaveTextContent(/Carol/);
  });

  it("does not render the toggle when read-only", () => {
    render(
      <ScorePanel
        players={PLAYERS}
        scores={{ 0: 5, 1: 2, 2: 0 }}
        scoreConfig={CONFIG}
        readOnly
        activePlayerIndex={0}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /show other scores/i }),
    ).toBeNull();
  });
});
