import { test, expect } from "@playwright/experimental-ct-react";
import { ScorePanel } from "@/components/ScorePanel";

// Visual smoke for the score-track layout: adder above the track,
// head icons rendered directly without a circular container,
// heading/adder/track packed close together. Animations disabled
// via reduced-motion so the baseline is deterministic.
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
      flexDirection: "column",
      justifyContent: "flex-end",
      padding: "24px",
    }}
  >
    {children}
  </div>
);

const ROOT_PLAYERS = [
  {
    name: "Marquise de Cat",
    color: "#E8A33D",
    headIconSrc: "/games/root/heads/marquise.png",
  },
  {
    name: "Eyrie Dynasties",
    color: "#2862A1",
    headIconSrc: "/games/root/heads/eyrie.png",
  },
  {
    name: "Woodland Alliance",
    color: "#73AB48",
    headIconSrc: "/games/root/heads/alliance.png",
  },
  {
    name: "Vagabond",
    color: "#EBEBEB",
    headIconSrc: "/games/root/heads/vagabond.png",
  },
];

const ROOT_CONFIG = {
  displayStyle: "linearTrack" as const,
  min: 0,
  max: 30,
  increment: 1,
  victory: { type: "firstToMax" as const },
};

const noop = () => {};

test("ScorePanel — Root track, four distinct scores, Marquise active", async ({
  mount,
}) => {
  const component = await mount(
    wrap(
      <ScorePanel
        players={ROOT_PLAYERS}
        scores={{ 0: 7, 1: 3, 2: 12, 3: 0 }}
        scoreConfig={ROOT_CONFIG}
        onIncrement={noop}
        activePlayerIndex={0}
      />,
    ),
  );
  await expect(component).toHaveScreenshot("score-panel-root-track.png", {
    maxDiffPixelRatio: 0.02,
  });
});

test("ScorePanel — Root track, two players sharing the same score", async ({
  mount,
}) => {
  // Eyrie + Vagabond both at 5 — should cluster vertically with a
  // single shared "5" label below; Marquise (12) and Alliance (3)
  // get their own labels.
  const component = await mount(
    wrap(
      <ScorePanel
        players={ROOT_PLAYERS}
        scores={{ 0: 12, 1: 5, 2: 3, 3: 5 }}
        scoreConfig={ROOT_CONFIG}
        onIncrement={noop}
        activePlayerIndex={1}
      />,
    ),
  );
  await expect(component).toHaveScreenshot("score-panel-root-cluster.png", {
    maxDiffPixelRatio: 0.02,
  });
});

test("ScorePanel — Root track, three-player cluster + active sway scaled", async ({
  mount,
}) => {
  // Three players at 0, fourth pulling ahead. Tests both end-of-
  // track behaviour and the active-marker scale 1.3 + sway.
  const component = await mount(
    wrap(
      <ScorePanel
        players={ROOT_PLAYERS}
        scores={{ 0: 0, 1: 0, 2: 28, 3: 0 }}
        scoreConfig={ROOT_CONFIG}
        onIncrement={noop}
        activePlayerIndex={2}
      />,
    ),
  );
  await expect(component).toHaveScreenshot(
    "score-panel-root-triple-cluster.png",
    {
      maxDiffPixelRatio: 0.02,
    },
  );
});
