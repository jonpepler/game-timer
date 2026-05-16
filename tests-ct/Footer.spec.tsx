import { test, expect } from "@playwright/experimental-ct-react";
import { Footer } from "@/components/timer/Footer";

const noop = () => {};

test("Footer renders pause state with remaining turns", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#111",
        color: "white",
        fontFamily: "monospace",
      }}
    >
      <Footer
        remainingTurns={42}
        setExpectedTurns={noop}
        setPreventClickCapture={noop}
        paused={false}
        pause={noop}
        unpause={noop}
        averageTime={120}
      />
    </div>,
  );

  await expect(component).toContainText("Remaining Turns: 42");
  await expect(component).toContainText("Predicted game finish:");
  // The predicted-finish text is derived from wall-clock time, so mask it
  // to keep the visual baseline stable.
  await expect(component).toHaveScreenshot("footer-running.png", {
    maxDiffPixelRatio: 0.02,
    mask: [page.locator("text=Predicted game finish")],
  });
});
