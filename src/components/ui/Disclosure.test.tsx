import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Disclosure } from "./Disclosure";

describe("Disclosure", () => {
  it("keeps its content folded until the control is pressed", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="More choices">
        <button type="button">Hidden choice</button>
      </Disclosure>,
    );
    const toggle = screen.getByRole("button", { name: "More choices" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Hidden choice" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Hidden choice" })).toBeVisible();

    await user.click(toggle);
    expect(
      screen.queryByRole("button", { name: "Hidden choice" }),
    ).not.toBeInTheDocument();
  });

  it("follows the open state it is given", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Disclosure label="More choices" open onOpenChange={onOpenChange}>
        <p>Shown</p>
      </Disclosure>,
    );
    expect(screen.getByText("Shown")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More choices" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps its click from reaching the page beneath", async () => {
    const user = userEvent.setup();
    const onPageClick = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the tap-to-advance surface
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the tap-to-advance surface
      <div onClick={onPageClick}>
        <Disclosure label="More choices">
          <p>Shown</p>
        </Disclosure>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "More choices" }));
    expect(onPageClick).not.toHaveBeenCalled();
  });
});
