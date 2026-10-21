import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Stepper } from "./Stepper";

function Count({ size }: { size?: "compact" | "wide" }) {
  const [n, setN] = useState(2);
  return (
    <Stepper
      size={size}
      value={n}
      valueLabel={`Players: ${n}`}
      onDecrement={() => setN(n - 1)}
      onIncrement={() => setN(n + 1)}
      canDecrement={n > 1}
      canIncrement={n < 3}
      decrementLabel="Decrease players"
      incrementLabel="Increase players"
    />
  );
}

describe("Stepper", () => {
  it.each([
    "compact",
    "wide",
  ] as const)("steps a %s value within its bounds", async (size) => {
    render(<Count size={size} />);
    const more = screen.getByRole("button", { name: "Increase players" });
    const less = screen.getByRole("button", { name: "Decrease players" });
    await userEvent.click(more);
    expect(screen.getByRole("status", { name: "Players: 3" })).toBeVisible();
    expect(more).toBeDisabled();
    await userEvent.click(less);
    await userEvent.click(less);
    expect(screen.getByRole("status", { name: "Players: 1" })).toBeVisible();
    expect(less).toBeDisabled();
  });

  it("shows what the number belongs to and never reaches the page", async () => {
    const onPage = vi.fn();
    const onIncrement = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the turn-advancing ring
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the turn-advancing ring
      <div onClick={onPage}>
        <Stepper
          value={7}
          onDecrement={vi.fn()}
          onIncrement={onIncrement}
          decrementLabel="Decrease score for Ada"
          incrementLabel="Increase score for Ada"
        >
          Ada
        </Stepper>
      </div>,
    );
    expect(screen.getByText("Ada")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Increase score for Ada" }),
    );
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });
});
