import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "./Button";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it("runs its action and keeps the click from reaching the page", async () => {
    const onClick = vi.fn();
    const onPage = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the turn-advancing ring
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the turn-advancing ring
      <div onClick={onPage}>
        <Button onClick={onClick}>Start game</Button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Add
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is a plain button, so it never submits a form by accident", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("draws a link as a button for navigation", () => {
    render(<ButtonLink href="/timer">Start a game</ButtonLink>);
    expect(screen.getByRole("link", { name: "Start a game" })).toHaveAttribute(
      "href",
      "/timer",
    );
  });
});

describe("IconButton", () => {
  it("is named by its label, not its glyph", async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Pause timer" onClick={onClick}>
        <svg aria-hidden />
      </IconButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("describes itself with a tooltip that says more than its name", () => {
    render(
      <IconButton label="Undo" tooltip="Undo the last action">
        <svg aria-hidden />
      </IconButton>,
    );
    expect(
      screen.getByRole("button", { name: "Undo" }),
    ).toHaveAccessibleDescription("Undo the last action");
  });

  it("keeps a tooltip that repeats its name out of the reading", () => {
    render(
      <IconButton label="New game">
        <svg aria-hidden />
      </IconButton>,
    );
    expect(
      screen.getByRole("button", { name: "New game" }),
    ).not.toHaveAccessibleDescription();
  });

  it("has no structural accessibility problems", async () => {
    const { container } = render(
      <>
        <Button variant="primary">Start game</Button>
        <IconButton label="Close" shape="square">
          <svg aria-hidden />
        </IconButton>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
