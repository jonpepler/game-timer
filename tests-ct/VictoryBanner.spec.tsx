import { test, expect } from "@playwright/experimental-ct-react";
import { VictoryBanner } from "@/components/VictoryBanner";

// Visual smoke for the wreath + head-icon alignment. The component
// has a staged entry animation + an infinite sway loop — both are
// suppressed for the screenshot via `prefers-reduced-motion: reduce`
// (the CSS media query gates every animation rule on it) so the
// baselines render the resting state deterministically.
test.use({ colorScheme: "dark" });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

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

test("VictoryBanner with no laurel asset — name-led layout", async ({
  mount,
}) => {
  const component = await mount(
    wrap(
      <VictoryBanner
        victor={{
          name: "Jon",
          color: "#7BE847",
        }}
      />,
    ),
  );
  await expect(component.getByRole("status")).toBeVisible();
  await expect(component).toHaveScreenshot("victory-name-only.png", {
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
