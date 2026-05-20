import { test, expect } from "@playwright/experimental-ct-react";
import { VictoryBanner } from "@/components/VictoryBanner";

// Visual smoke for the wreath + head-icon alignment. Useful while
// dialling in the inner-circle ratio against a real laurel asset —
// re-run with `npm run test:ct:update` to refresh the baseline.

const wrap = (children: React.ReactNode) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "#0e0e10",
      color: "white",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}
  >
    {children}
  </div>
);

test("VictoryBanner with laurel + Marquise head", async ({ mount }) => {
  const component = await mount(
    wrap(
      <VictoryBanner
        victor={{
          name: "Marquise de Cat",
          color: "#E8A33D",
          // CT mounts under /, not /game-timer/, so paths need to be
          // relative-to-public.
          iconSrc: "/games/root/heads/marquise.png",
        }}
        laurelSrc="/games/root/vp/laurel.png"
      />,
    ),
  );
  await expect(component.getByRole("status")).toBeVisible();
  await expect(component).toHaveScreenshot("victory-marquise-laurel.png", {
    maxDiffPixelRatio: 0.02,
  });
});

test("VictoryBanner with no laurel asset — fallback ring + crown", async ({
  mount,
}) => {
  const component = await mount(
    wrap(
      <VictoryBanner
        victor={{
          name: "Eyrie Dynasties",
          color: "#2862A1",
        }}
      />,
    ),
  );
  await expect(component.getByRole("status")).toBeVisible();
  await expect(component).toHaveScreenshot("victory-fallback-ring.png", {
    maxDiffPixelRatio: 0.02,
  });
});

test("VictoryBanner short name fits inside the laurel cleanly", async ({
  mount,
}) => {
  const component = await mount(
    wrap(
      <VictoryBanner
        victor={{
          name: "Jon",
          color: "#7BE847",
          iconSrc: "/games/root/heads/alliance.png",
        }}
        laurelSrc="/games/root/vp/laurel.png"
      />,
    ),
  );
  await expect(component.getByRole("status")).toBeVisible();
  await expect(component).toHaveScreenshot("victory-short-name.png", {
    maxDiffPixelRatio: 0.02,
  });
});
