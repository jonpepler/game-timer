import { appendFile } from "node:fs/promises";
import path from "node:path";
import { type Page, test } from "@playwright/test";
import {
  endStockRound,
  endTurnWithPriceChange,
  foundCompanies,
  startRailways,
} from "./games/railways/railways.helpers";
import { navigateToScreen, startGame } from "./_setup-helpers";

/*
 * Evidence generator for the timer page layout. Not a regression suite:
 * it renders the reviewed states at each viewport and theme, saves
 * screenshots (and a phone scrolling video) to $LAYOUT_EVIDENCE_DIR
 * tagged with $LAYOUT_EVIDENCE_TAG ("before" or "after"), and appends
 * the ring's diameter in each state to ring-sizes-<tag>.jsonl there.
 * Skipped unless LAYOUT_EVIDENCE_DIR is set.
 */

const BASE = "/game-timer";
const OUT_DIR = process.env.LAYOUT_EVIDENCE_DIR;
const TAG = process.env.LAYOUT_EVIDENCE_TAG ?? "after";

test.skip(!OUT_DIR, "set LAYOUT_EVIDENCE_DIR to capture evidence");
test.describe.configure({ timeout: 120_000 });
test.use({ video: OUT_DIR ? "on" : "off" });

const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const VIEWPORTS = {
  phone,
  "480": { viewport: { width: 480, height: 800 }, hasTouch: true },
  "1280": { viewport: { width: 1280, height: 800 } },
  "1440": { viewport: { width: 1440, height: 900 } },
  "1920": { viewport: { width: 1920, height: 1080 } },
  "2560": { viewport: { width: 2560, height: 1440 } },
} as const;

const DESKTOP = ["1280", "1440", "1920", "2560"] as const;

const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );

const ring = (page: Page) => page.getByRole("button", { name: "Advance turn" });

const out = (name: string) => path.join(OUT_DIR ?? ".", name);

const shot = async (page: Page, name: string) => {
  // Drop the keyboard focus ring the Enter presses leave on the timer.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(0, 0);
  await settle(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out(`${name}-${TAG}.png`) });
};

const recordRing = async (page: Page, state: string, vp: string) => {
  await settle(page);
  const diameter = await ring(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().width),
  );
  await appendFile(
    out(`ring-sizes-${TAG}.jsonl`),
    `${JSON.stringify({ vp, state, diameter })}\n`,
  );
};

async function startArcs(page: Page) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  for (const leader of ["Elder", "Mystic", "Upstart", "Rebel"]) {
    await page
      .getByRole("button", { name: leader, exact: true })
      .press("Enter");
    await page.getByRole("button", { name: /^Confirm setup$/ }).click();
  }
  const startBtn = page.getByRole("button", { name: /start game/i });
  for (let i = 0; i < 6; i++) {
    if (await startBtn.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await startBtn.click();
  await page.getByText(/turns left/i).waitFor({ timeout: 15_000 });
}

/** An Operating Round two companies into it, so the value chart has a history. */
async function railwaysWithChart(page: Page) {
  await startRailways(page);
  await foundCompanies(page, [
    ["Northern Port", 80, "Player 1"],
    ["Agricultural", 80, "Player 2"],
    ["Tunneling", 70, "Player 3"],
  ]);
  await endStockRound(page, "Player 2");
  await endTurnWithPriceChange(page, "down");
  await endTurnWithPriceChange(page, "up2");
  await page.getByTestId("value-history-chart").waitFor();
}

const rootGame = (page: Page) =>
  startGame(page, {
    game: "root",
    playerCount: 3,
    factions: ["Marquise de Cat", "Eyrie Dynasties", "Woodland Alliance"],
  });

for (const scheme of ["light", "dark"] as const) {
  for (const [vp, device] of Object.entries(VIEWPORTS)) {
    test.describe(`lost atlas ${scheme} ${vp}`, () => {
      test.use({ ...device, colorScheme: scheme });

      test("railways stock round, then an operating round with the chart", async ({
        page,
      }) => {
        await startRailways(page);
        await recordRing(page, `railways-stock-${scheme}`, vp);
        await shot(page, `railways-stock-${scheme}-${vp}`);
        await foundCompanies(page, [
          ["Northern Port", 80, "Player 1"],
          ["Agricultural", 80, "Player 2"],
          ["Tunneling", 70, "Player 3"],
        ]);
        await endStockRound(page, "Player 2");
        await endTurnWithPriceChange(page, "down");
        await endTurnWithPriceChange(page, "up2");
        await page.getByTestId("value-history-chart").waitFor();
        await recordRing(page, `railways-chart-${scheme}`, vp);
        await shot(page, `railways-chart-${scheme}-${vp}`);
        if (vp === "phone") {
          await page.mouse.wheel(0, 900);
          await shot(page, `railways-chart-${scheme}-${vp}-scrolled`);
          await page.mouse.wheel(0, -900);
        }
        await recordRing(page, `railways-turn-order-${scheme}`, vp);
        await shot(page, `railways-turn-order-${scheme}-${vp}`);
      });
    });
  }
}

for (const [vp, device] of Object.entries(VIEWPORTS)) {
  if (vp === "480") continue;
  test.describe(`default theme ${vp}`, () => {
    test.use(device);

    test("root mid-game", async ({ page }) => {
      await rootGame(page);
      await ring(page).press("Enter");
      await page.waitForTimeout(1100);
      await ring(page).press("Enter");
      await recordRing(page, "root", vp);
      await shot(page, `root-default-${vp}`);
    });
  });
}

for (const vp of DESKTOP) {
  test.describe(`arcs dark ${vp}`, () => {
    test.use({ ...VIEWPORTS[vp], colorScheme: "dark" });

    test("arcs mid-game", async ({ page }) => {
      await startArcs(page);
      await ring(page).press("Enter");
      await page.waitForTimeout(1100);
      await ring(page).press("Enter");
      await recordRing(page, "arcs", vp);
      await shot(page, `arcs-dark-${vp}`);
    });
  });
}

test.describe("phone share panel", () => {
  test.use({ ...phone, colorScheme: "light" });

  test("the wizard's sharing session panel", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("railways");
    await page.getByRole("button", { name: "Copy companion URL" }).waitFor();
    await shot(page, "share-panel-light-phone");
  });
});

test.describe("phone scrolling video", () => {
  test.use({ ...phone, colorScheme: "light" });

  test("scrolling an operating round", async ({ page }) => {
    await railwaysWithChart(page);
    await page.waitForTimeout(800);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 150);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(2000);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -150);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1000);
    const video = page.video();
    await page.close();
    await video?.saveAs(out(`phone-scroll-${TAG}.webm`));
  });
});
