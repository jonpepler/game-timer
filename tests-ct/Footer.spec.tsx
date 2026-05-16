import { test, expect } from "@playwright/experimental-ct-react";
import { Footer } from "@/components/timer/Footer";

const noop = () => {};

test("Footer renders running state with remaining turns", async ({
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

  await expect(component).toContainText("42");
  await expect(component).toContainText("turns left");
  await expect(component).toContainText("ends at");
  // The "ends at" timestamp is derived from wall-clock time, mask it to
  // keep the visual baseline stable.
  await expect(component).toHaveScreenshot("footer-running.png", {
    maxDiffPixelRatio: 0.02,
    mask: [page.locator(`text=ends at`)],
  });
});
