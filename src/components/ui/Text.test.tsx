import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field, SelectField } from "./Field";
import { Heading } from "./Heading";
import { SectionLabel } from "./SectionLabel";

describe("Heading", () => {
  it("is a real heading at its level, whatever size it is drawn", () => {
    render(
      <>
        <Heading level={2} size={3}>
          New game
        </Heading>
        <Heading level={3} size={2}>
          How long is this game?
        </Heading>
      </>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "New game" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "How long is this game?" }),
    ).toBeVisible();
  });
});

describe("SectionLabel", () => {
  it("names a fieldset when drawn as its legend", () => {
    render(
      <fieldset>
        <SectionLabel as="legend">Owner</SectionLabel>
        <button type="button">Ada</button>
      </fieldset>,
    );
    expect(screen.getByRole("group", { name: "Owner" })).toBeVisible();
  });

  it("labels a field when drawn as its label", async () => {
    render(
      <>
        <SectionLabel as="label" htmlFor="turns">
          Expected turns
        </SectionLabel>
        <Field id="turns" type="number" defaultValue="12" />
      </>,
    );
    const field = screen.getByRole("spinbutton", { name: "Expected turns" });
    await userEvent.clear(field);
    await userEvent.type(field, "20");
    expect(field).toHaveValue(20);
  });
});

describe("SelectField", () => {
  it("chooses an option", async () => {
    render(
      <SelectField aria-label="Game" defaultValue="a">
        <option value="a">First</option>
        <option value="b">Second</option>
      </SelectField>,
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Game" }),
      "b",
    );
    expect(screen.getByRole("combobox", { name: "Game" })).toHaveValue("b");
  });
});
