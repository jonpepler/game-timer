import { test, expect } from "@playwright/experimental-ct-react";
import { Footer } from "@/components/timer/Footer";

const noop = () => {};

const baseProps = {
  remainingTurns: 42,
  setExpectedTurns: noop,
  setPreventClickCapture: noop,
  paused: false,
  pause: noop,
  unpause: noop,
  averageTime: 120,
  undo: noop,
};

test("Footer renders running state with remaining turns + disabled undo", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        color: "white",
      }}
    >
      <Footer {...baseProps} canUndo={false} />
    </div>,
  );

  await expect(component).toContainText("42");
  await expect(component).toContainText("turns left");
  await expect(component).toContainText("ends at");
  await expect(component.getByRole("button", { name: /undo/i })).toBeDisabled();
  // Mask the wall-clock "ends at" timestamp so the baseline stays stable.
  await expect(component).toHaveScreenshot("footer-running.png", {
    maxDiffPixelRatio: 0.02,
    mask: [page.locator(`text=ends at`)],
  });
});

test("Footer enables the undo button when canUndo is true", async ({
  mount,
}) => {
  const component = await mount(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        color: "white",
      }}
    >
      <Footer {...baseProps} canUndo />
    </div>,
  );
  await expect(component.getByRole("button", { name: /undo/i })).toBeEnabled();
});
