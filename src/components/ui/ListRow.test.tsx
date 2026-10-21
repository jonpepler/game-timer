import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { Disc } from "./Disc";
import { ChoiceGrid, ListRow } from "./ListRow";
import { Toggle } from "./Toggle";

describe("ListRow", () => {
  it("acts as one button named by its label", async () => {
    const onClick = vi.fn();
    render(
      <ListRow
        lead={<Disc color="red" />}
        label="Up one"
        hint="Paid out"
        trailing={80}
        onClick={onClick}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Up one/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a toggle only when it stays chosen", () => {
    render(
      <>
        <ListRow label="Short game" pressed />
        <ListRow label="Act now" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Short game" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Act now" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });
});

describe("Toggle", () => {
  it("is a checkbox named by its label and described by its detail", async () => {
    render(<Toggle label="Optional rules" description="Adds a fifth round" />);
    const box = screen.getByRole("checkbox", { name: "Optional rules" });
    expect(box).toHaveAccessibleDescription("Adds a fifth round");
    await userEvent.click(screen.getByText("Optional rules"));
    expect(box).toBeChecked();
  });

  it("has no structural accessibility problems", async () => {
    const { container } = render(
      <fieldset>
        <legend>Turn order</legend>
        <Toggle type="radio" name="order" label="Fixed" />
        <Toggle type="radio" name="order" label="Variable" />
      </fieldset>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ChoiceGrid", () => {
  it("lists its choices, each still one button", async () => {
    const onClick = vi.fn();
    render(
      <ChoiceGrid aria-label="New value">
        <li>
          <ListRow
            layout="adaptive"
            label="Up one"
            trailing={90}
            onClick={onClick}
          />
        </li>
        <li>
          <ListRow layout="adaptive" label="Down one" trailing={70} />
        </li>
      </ChoiceGrid>,
    );
    const list = screen.getByRole("list", { name: "New value" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /^Up one/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
