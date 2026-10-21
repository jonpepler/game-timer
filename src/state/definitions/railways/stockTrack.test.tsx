import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ValueStepPrompt } from "@/components/ValueStepPrompt";
import { valueStepChoices } from "@/hooks/useTurnEntryControls";
import { railwaysDefinition } from "../railways";

/*
 * Railways of the Lost Atlas, 2nd edition rulebook: the stock track
 * (p2), starting prices (p10) and how distributing earnings moves the
 * share price (p15). Page numbers are the printed ones.
 */

const values = railwaysDefinition.turnOrder?.entryValues;
if (!values) throw new Error("Railways declares no share prices");

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stepLabel = (id: string) => {
  const step = values.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step "${id}"`);
  return step.label;
};

const renderPrompt = (price: number) => {
  const onChoose = vi.fn();
  render(
    <ValueStepPrompt
      entryName="Express"
      ownerName="Player 1"
      valueLabel={values.label}
      value={price}
      steps={valueStepChoices(values, price)}
      onChoose={onChoose}
      onCancel={() => {}}
    />,
  );
  return { onChoose };
};

const stepButton = (id: string) =>
  screen.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(stepLabel(id))}(,|$)`),
  });

describe("Railways stock track", () => {
  it("p2: the stock track is printed 0 (closed), 10 to 120 by tens, then 135 up to 500", () => {
    expect(values.track).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180,
      200, 220, 245, 270, 300, 330, 360, 400, 450, 500,
    ]);
  });

  it("p10 and p16: initial stock prices range 60 to 135, every one a track space", () => {
    expect(values.startValues).toEqual([60, 70, 80, 90, 100, 110, 120, 135]);
    for (const price of values.startValues ?? [])
      expect(values.track).toContain(price);
  });

  // [price, withheld, paid less than price, paid at least price, at least double]
  it.each([
    [60, 50, 60, 70, 80],
    [110, 100, 110, 120, 135],
    [120, 110, 120, 135, 150],
    [135, 120, 135, 150, 165],
    [180, 165, 180, 200, 220],
    [245, 220, 245, 270, 300],
    [400, 360, 400, 450, 500],
  ])("p15: from %i the price prompt lands on %i withheld, %i below the price, %i at the price, %i at double", (price, down, same, up, up2) => {
    renderPrompt(price);
    expect(
      screen.getByText(`${values.label} now`, { exact: false }),
    ).toHaveTextContent(String(price));
    expect(stepButton("down")).toHaveTextContent(new RegExp(`${down}$`));
    expect(stepButton("same")).toHaveTextContent(new RegExp(`${same}$`));
    expect(stepButton("up")).toHaveTextContent(new RegExp(`${up}$`));
    expect(stepButton("up2")).toHaveTextContent(new RegExp(`${up2}$`));
  });

  it.each([
    ["down", "Total payout zero / revenue withheld: drop by one increment"],
    [
      "same",
      "Total payout < current stock value: move to bottom of same stock price column",
    ],
    ["up", "Total payout >= current stock value: increase by one increment"],
    [
      "up2",
      "Total payout >= 2x current stock value: increase by two increments",
    ],
  ])("p2 stock track legend: the %s step reads as the board prints it", (id, hint) => {
    renderPrompt(100);
    expect(stepButton(id)).toHaveTextContent(hint);
  });

  it("Landmarks p9 Record Gains!: a payout of at least triple rises three increments, 100 to 135", () => {
    renderPrompt(100);
    expect(stepButton("up3")).toHaveTextContent(/135$/);
  });

  it("p11: withholding at 10 lands on 0, where the company is dissolved", () => {
    renderPrompt(10);
    expect(stepButton("down")).toHaveTextContent(/0$/);
    expect(stepButton("down")).not.toHaveTextContent(/10$/);
  });

  it("p17: a bankrupt president's company leaves the track, so that choice shows no landing price", async () => {
    const user = userEvent.setup();
    const { onChoose } = renderPrompt(90);
    expect(stepButton("bankrupt")).not.toHaveTextContent(/\d/);
    await user.click(stepButton("bankrupt"));
    expect(onChoose).toHaveBeenCalledWith("bankrupt");
  });
});
