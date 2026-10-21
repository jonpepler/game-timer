import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Control } from "@/state/gameDefinition";
import { TurnActions } from "./TurnActions";

const CONTROLS: Control[] = [
  { id: "a", label: "Claim the lead", effect: { type: "claim-next-lead" } },
  { id: "b", label: "Second action", effect: { type: "claim-next-lead" } },
];

describe("TurnActions", () => {
  it("renders nothing when the definition declares no controls", () => {
    const { container } = render(
      <TurnActions controls={[]} availableIds={[]} onTrigger={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers only the available controls, keeping a slot for the rest", () => {
    render(
      <TurnActions
        controls={CONTROLS}
        availableIds={["b"]}
        onTrigger={vi.fn()}
      />,
    );
    const region = screen.getByRole("region", { name: "Turn actions" });
    expect(region.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Second action" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Claim the lead" }),
    ).not.toBeInTheDocument();
  });

  it("triggers by id and never lets the click reach the page", () => {
    const onTrigger = vi.fn();
    const onPageClick = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for a turn-advancing ancestor
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for a turn-advancing ancestor
      <div onClick={onPageClick}>
        <TurnActions
          controls={CONTROLS}
          availableIds={["a", "b"]}
          onTrigger={onTrigger}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim the lead" }));
    expect(onTrigger).toHaveBeenCalledWith("a");
    expect(onPageClick).not.toHaveBeenCalled();
  });
});
