import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimerRing } from "./TimerRing";

describe("TimerRing", () => {
  it("shows the countdown during a timed turn", () => {
    render(
      <TimerRing value={50} text="01:15" paused={false} overtimeOpacity={0} />,
    );
    expect(screen.getByText("01:15")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replaces the time with the untimed label", () => {
    render(
      <TimerRing
        value={50}
        text="01:15"
        paused={false}
        overtimeOpacity={0.4}
        untimedLabel="Everyone acts"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Everyone acts");
    expect(screen.queryByText("01:15")).not.toBeInTheDocument();
  });
});
