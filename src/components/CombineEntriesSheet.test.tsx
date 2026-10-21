import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CombineEntriesSheet } from "./CombineEntriesSheet";

type SheetProps = Parameters<typeof CombineEntriesSheet>[0];

const STAND_INS: SheetProps["extraSources"] = {
  label: "Stand-ins",
  candidates: [
    { id: "p", name: "Partner", color: "#777" },
    { id: "q", name: "Proxy", color: "#999" },
  ],
};

const renderSheet = (
  headings?: SheetProps["headings"],
  extraSources?: SheetProps["extraSources"],
) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const advance = vi.fn();
  render(
    // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
    // biome-ignore lint/a11y/noStaticElementInteractions: test harness
    <div onClick={advance}>
      <CombineEntriesSheet
        label="Combine"
        count={2}
        sources={[
          { id: "n", name: "North Side", color: "#335", value: 80 },
          { id: "f", name: "Field", color: "#353", value: 135 },
          { id: "x", name: "Other", color: "#533", value: 60 },
        ]}
        targets={[
          { id: "u", name: "Group", color: "#a63" },
          { id: "s", name: "Set", color: "#aa3" },
        ]}
        players={[
          { name: "Ann", color: "#f00" },
          { name: "Bo", color: "#0f0" },
        ]}
        value={{
          label: "Value",
          track: [60, 70, 80, 90, 100, 110, 120, 135],
          defaultFor: () => 100,
        }}
        headings={headings}
        extraSources={extraSources}
        initialSourceIds={["n"]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>,
  );
  return { onConfirm, onCancel, advance };
};

const button = (name: RegExp | string) => screen.getByRole("button", { name });
const stepHeading = () => screen.getByRole("heading", { level: 3 });

// The live preview of the combined name, found by the title it ends with.
const preview = (title: string) =>
  screen.getByText(
    (_, el) =>
      el?.tagName === "P" && new RegExp(`${title}$`).test(el.textContent ?? ""),
  );

/** Through the first three steps to the check of the result. */
const toConfirm = async (target = "Group", owner = "Ann") => {
  await userEvent.click(button(/^Field/));
  await userEvent.click(button("Next"));
  await userEvent.click(button(target));
  await userEvent.click(button(owner));
};

describe("CombineEntriesSheet", () => {
  it("asks one thing per step, each heading from the config", async () => {
    renderSheet({
      sources: "Which two?",
      target: "Into what?",
      owner: "Whose?",
      confirm: "Check it",
    });
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(stepHeading()).toHaveTextContent("Which two?");
    expect(button("Next")).toBeDisabled();
    await userEvent.click(button(/^Field/));
    await userEvent.click(button("Next"));
    expect(stepHeading()).toHaveTextContent("Into what?");
    // A single choice moves on by itself.
    await userEvent.click(button("Group"));
    expect(stepHeading()).toHaveTextContent("Whose?");
    expect(stepHeading()).toHaveFocus();
    await userEvent.click(button("Bo"));
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    expect(stepHeading()).toHaveTextContent("Check it");
  });

  it("falls back to generic headings", () => {
    renderSheet();
    expect(stepHeading()).toHaveTextContent("Choose 2");
  });

  it("allows only the declared number of sources", async () => {
    renderSheet();
    await userEvent.click(button(/^Field/));
    expect(button(/^Other/)).toBeDisabled();
  });

  it("offers stand-ins folded away, one at most, named in the result", async () => {
    const { onConfirm } = renderSheet(undefined, STAND_INS);
    expect(
      screen.queryByRole("button", { name: "Partner" }),
    ).not.toBeInTheDocument();
    const section = button("Stand-ins");
    expect(section).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(section);
    await userEvent.click(button("Partner"));
    // North Side and Partner fill both places.
    expect(button("Proxy")).toBeDisabled();
    expect(button(/^Field/)).toBeDisabled();
    await userEvent.click(button("Next"));
    await userEvent.click(button("Group"));
    await userEvent.click(button("Ann"));
    expect(preview("Group")).toHaveTextContent(/^North Side Partner Group$/);
    await userEvent.click(button("Swap name order"));
    expect(preview("Group")).toHaveTextContent(/^Partner North Side Group$/);
    // Back on the first step the section is still open with the choice.
    await userEvent.click(button("Back"));
    await userEvent.click(button("Back"));
    await userEvent.click(button("Back"));
    expect(button("Partner")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button("Next"));
    await userEvent.click(button("Group"));
    await userEvent.click(button("Ann"));
    await userEvent.click(button("Combine"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: ["p", "n"], targetId: "u" }),
    );
  });

  it("never fills every place with stand-ins", async () => {
    renderSheet(undefined, STAND_INS);
    await userEvent.click(button(/^North Side/));
    await userEvent.click(button("Stand-ins"));
    await userEvent.click(button("Partner"));
    expect(button("Proxy")).toBeDisabled();
    expect(button("Next")).toBeDisabled();
  });

  it("names the target with the sources as its lineage, in order, and swaps the source order", async () => {
    renderSheet();
    await toConfirm();
    expect(preview("Group")).toHaveTextContent(/^North Side Field Group$/);
    await userEvent.click(button("Swap name order"));
    expect(preview("Group")).toHaveTextContent(/^Field North Side Group$/);
  });

  it("goes back to change a choice", async () => {
    renderSheet();
    await toConfirm();
    await userEvent.click(button("Back"));
    await userEvent.click(button("Back"));
    await userEvent.click(button("Set"));
    await userEvent.click(button("Next"));
    expect(preview("Set")).toHaveTextContent(/^North Side Field Set$/);
  });

  it("proposes a value and confirms without advancing the turn", async () => {
    const { onConfirm, advance } = renderSheet();
    await toConfirm("Set", "Bo");
    expect(button("100")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button("Swap name order"));
    await userEvent.click(button("90"));
    await userEvent.click(button("Combine"));
    expect(onConfirm).toHaveBeenCalledWith({
      sourceIds: ["f", "n"],
      targetId: "s",
      playerIndex: 1,
      value: 90,
    });
    expect(advance).not.toHaveBeenCalled();
  });

  it("cancels from the first step", async () => {
    const { onCancel } = renderSheet();
    await userEvent.click(button("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
