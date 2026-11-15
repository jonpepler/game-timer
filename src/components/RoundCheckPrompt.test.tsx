import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoundCheckPrompt } from "./RoundCheckPrompt";

const check = {
  afterRound: 2,
  title: "End of round 2",
  body: "Roll the die. The head wins on a 6.",
  endLabel: "Head wins",
  continueLabel: "Play on",
  outcome: { title: "Head holds on" },
};

describe("RoundCheckPrompt", () => {
  it("asks the check's question and reports the answer", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<RoundCheckPrompt check={check} onAnswer={onAnswer} />);
    const prompt = screen.getByRole("alertdialog", { name: "End of round 2" });
    expect(prompt).toHaveTextContent("The head wins on a 6.");
    await user.click(screen.getByRole("button", { name: "Play on" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Head wins" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
  });
});
