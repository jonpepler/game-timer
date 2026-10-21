import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Prompt, Sheet } from "./Sheet";

describe("Sheet", () => {
  it("is a named modal dialog that takes focus as it opens", () => {
    render(
      <Sheet title="Add to list" onDismiss={vi.fn()}>
        <Button>First</Button>
        <Button>Second</Button>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Add to list" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("closes on Escape when it can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<Sheet title="Players" onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes only the newest of two stacked sheets on Escape", async () => {
    const closeUnder = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Sheet title="Under" onDismiss={closeUnder} />
        <Sheet title="On top" onDismiss={closeTop} />
      </>,
    );
    await userEvent.keyboard("{Escape}");
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeUnder).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the card", async () => {
    render(
      <>
        <button type="button">Behind</button>
        <Sheet title="Choose" actions={<Button>Done</Button>}>
          <Button>Option</Button>
        </Sheet>
      </>,
    );
    expect(screen.getByRole("button", { name: "Option" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Option" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("gives focus back to what opened it", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Sheet
              title="Details"
              onDismiss={() => setOpen(false)}
              actions={<Button onClick={() => setOpen(false)}>Close</Button>}
            />
          )}
        </>
      );
    }
    render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("keeps every tap inside from reaching the page", async () => {
    const onPage = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the turn-advancing ring
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the turn-advancing ring
      <div onClick={onPage}>
        <Sheet title="Players">
          <p>Some text</p>
        </Sheet>
      </div>,
    );
    await userEvent.click(screen.getByText("Some text"));
    expect(onPage).not.toHaveBeenCalled();
  });
});

describe("Prompt", () => {
  it("is an alert dialog with no way out but its answers", async () => {
    const onPick = vi.fn();
    render(
      <Prompt title="Who goes first?">
        <Button onClick={onPick}>Player 1</Button>
      </Prompt>,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Who goes first?" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Player 1" }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("has no structural accessibility problems", async () => {
    const { container } = render(
      <Prompt title="Round complete" subtitle="What comes next?">
        <Button variant="primary">Start the next round</Button>
      </Prompt>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
