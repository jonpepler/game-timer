import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { StepSheet } from "./StepSheet";

function Flow({
  onDismiss,
  onFinish,
}: {
  onDismiss: () => void;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(false);
  return (
    <StepSheet
      title="Plan"
      index={index}
      onIndexChange={setIndex}
      onDismiss={onDismiss}
      finish={
        <Button variant="primary" onClick={onFinish}>
          Done
        </Button>
      }
      steps={[
        {
          id: "pick",
          title: "Pick one",
          ready: picked,
          content: <Button onClick={() => setPicked(true)}>This one</Button>,
        },
        { id: "check", title: "Check it", ready: true, content: "All set" },
      ]}
    />
  );
}

describe("StepSheet", () => {
  it("walks one decision per step, with Back, then the finish action", async () => {
    const onFinish = vi.fn();
    render(<Flow onDismiss={() => {}} onFinish={onFinish} />);
    expect(screen.getByRole("dialog", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pick one" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "This one" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Check it" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Pick one" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("cancels from the first step and on Escape", async () => {
    const onDismiss = vi.fn();
    render(<Flow onDismiss={onDismiss} onFinish={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
