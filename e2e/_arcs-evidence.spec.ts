import path from "node:path";
import { test, type Page } from "@playwright/test";
import { navigateToScreen } from "./_setup-helpers";

/*
 * One-off evidence generator for the Arcs UI fixes. Not a regression
 * suite: it renders the states behind each reported issue and saves
 * screenshots to $ARCS_EVIDENCE_DIR with the given $ARCS_EVIDENCE_TAG
 * ("before" or "after") in each file name. Skipped unless
 * ARCS_EVIDENCE_DIR is set.
 */

const BASE = "/game-timer";
const OUT_DIR = process.env.ARCS_EVIDENCE_DIR;
const TAG = process.env.ARCS_EVIDENCE_TAG ?? "after";

test.skip(!OUT_DIR, "set ARCS_EVIDENCE_DIR to capture evidence");

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

const shot = (page: Page, name: string, viewport: string) =>
  page.screenshot({
    path: path.join(OUT_DIR ?? ".", `${name}-${TAG}-${viewport}.png`),
  });

async function startArcs(page: Page, seats: number) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /seat players/i);
  for (let i = 4; i > seats; i--) {
    await page.getByRole("button", { name: `Remove seat ${i}` }).click();
  }
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  const leaders = ["Elder", "Mystic", "Upstart", "Rebel"].slice(0, seats);
  for (const leader of leaders) {
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

const ring = (page: Page) => page.getByRole("button", { name: "Advance turn" });

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`evidence ${vpName}`, () => {
    test.use({ viewport });

    test("1 seize", async ({ page }) => {
      await startArcs(page, 4);
      await shot(page, "1-seize-idle", vpName);
      await ring(page).press("Enter");
      await page.waitForTimeout(400);
      await shot(page, "1-seize", vpName);
    });

    test("2 score panel expanded", async ({ page }) => {
      await startArcs(page, 4);
      await ring(page).press("Enter");
      await page.getByRole("button", { name: /show other scores/i }).click();
      await page.waitForTimeout(300);
      await shot(page, "2-score-expanded", vpName);
    });

    test("3 leader picker", async ({ page }) => {
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await navigateToScreen(page, /^Leader$/);
      await page.waitForTimeout(500);
      await shot(page, "3-leaders-draft", vpName);
      await page.getByRole("button", { name: /^Skip draft$/ }).click();
      await page.waitForTimeout(500);
      await shot(page, "3-leaders", vpName);
    });

    test("3 root faction picker (shared card row)", async ({ page }) => {
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("root");
      await navigateToScreen(page, /^Faction$/);
      await page.waitForTimeout(800);
      await shot(page, "3-root-factions-draft", vpName);
    });

    test("4 seating colours", async ({ page }) => {
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await navigateToScreen(page, /seat players/i);
      await shot(page, "4-colours-seating", vpName);
      await startArcs(page, 4);
      await shot(page, "4-colours-timer", vpName);
    });

    test("5 modules", async ({ page }) => {
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await page.getByRole("button", { name: /^Next/ }).click();
      await shot(page, "5-steps-modules", vpName);
    });
  });
}

/**
 * Full walkthrough recorded as video: setup with colours (when the
 * seating screen offers them), leader picks, a few turns with real
 * pointer taps on the ring, a seize, and the round end.
 */
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`evidence video ${vpName}`, () => {
    test("walkthrough", async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({
        viewport,
        recordVideo: { dir: testInfo.outputPath("video"), size: viewport },
      });
      const page = await context.newPage();
      const pause = () => page.waitForTimeout(700);
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await pause();
      await navigateToScreen(page, /seat players/i);
      await page.getByRole("button", { name: "Remove seat 4" }).click();
      await pause();
      const colours = page.getByRole("radiogroup", { name: "Player 1 colour" });
      if (await colours.isVisible().catch(() => false)) {
        await colours.getByRole("radio", { name: "White" }).click();
        await pause();
      }
      await navigateToScreen(page, /^Leader$/);
      await pause();
      for (let i = 0; i < 3; i++) {
        const card = page
          .locator('[class*="heroCard__"]:not([aria-disabled="true"])')
          .first();
        // Real click when the card is on screen; keyboard otherwise (the
        // pre-fix picker pushes cards outside the phone viewport).
        await card.click({ timeout: 2000 }).catch(() => card.press("Enter"));
        await pause();
        await page.getByRole("button", { name: /^Confirm setup$/ }).click();
        await pause();
      }
      const startBtn = page.getByRole("button", { name: /start game/i });
      for (let i = 0; i < 6; i++) {
        if (await startBtn.isVisible().catch(() => false)) break;
        await page.getByRole("button", { name: /^Next/ }).click();
        await pause();
      }
      await startBtn.click();
      await page.getByText(/turns left/i).waitFor();
      await pause();
      await page.getByRole("button", { name: /show other scores/i }).click();
      await pause();
      const tap = async () => {
        const r = await ring(page).boundingBox();
        if (!r) throw new Error("no ring");
        await page.mouse.click(r.x + r.width / 2, r.y + r.height * 0.85);
        await pause();
      };
      await tap();
      await tap();
      // Pre-fix, the taps above can land on the score panel instead of
      // the ring, so the game may not have started; keep recording.
      await page
        .getByRole("button", { name: /Seize the Initiative/i })
        .click({ timeout: 3000 })
        .catch(() => {});
      await pause();
      await tap();
      await tap();
      await pause();
      await page.screenshot({
        path: path.join(OUT_DIR ?? ".", `video-end-${TAG}-${vpName}.png`),
      });
      const video = page.video();
      await context.close();
      await video?.saveAs(
        path.join(OUT_DIR ?? ".", `walkthrough-${TAG}-${vpName}.webm`),
      );
    });
  });
}
