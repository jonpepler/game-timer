import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { navigateToScreen } from "./_setup-helpers";

/*
 * One-off screenshot generator for in-progress visual review. Not a
 * regression suite — these tests render specific UI states and save
 * full-page PNGs to local_docs/screenshots/review-*.png. Run via
 * `npx playwright test e2e/_review-shots.spec.ts` when you want
 * fresh shots for a design review.
 */

const BASE = "/game-timer";
const OUT_DIR = path.resolve(__dirname, "../local_docs/screenshots");

const save = async (page: Page, name: string) =>
  page.screenshot({
    path: path.join(OUT_DIR, `review-${name}.png`),
    fullPage: true,
  });

test.use({ viewport: { width: 1280, height: 900 } });

test("review: milestone dialog at 4 VP", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  const confirm = page.getByRole("button", { name: /^Confirm setup$/ });
  // 4 quick picks in counterclockwise order.
  await page
    .getByRole("button", { name: "Vagabond", exact: true })
    .first()
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Woodland Alliance", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Eyrie Dynasties", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Marquise de Cat", exact: true })
    .click();
  await confirm.click();
  await page.getByRole("button", { name: /^Start Game$/ }).click();
  // Kick the timer running, then pump Marquise (Player 1) to 4 to
  // fire the first milestone dialog.
  await page.locator("main").click();
  await page.locator("main").click();
  // Select Marquise's marker then click + four times.
  await page.evaluate(() => {
    (
      document.querySelector(
        'button[aria-label^="Player 1 score "]',
      ) as HTMLButtonElement | null
    )?.click();
  });
  const inc = page.getByRole("button", {
    name: /Increase score for Player 1/i,
  });
  for (let i = 0; i < 4; i++) await inc.click();
  await expect(
    page.getByRole("button", { name: /^Acknowledge$/ }),
  ).toBeVisible();
  await save(page, "milestone-dialog");
});

test("review: companion no-code shows the new code-entry form", async ({
  page,
}) => {
  await page.goto(`${BASE}/companion`);
  await save(page, "companion-no-code");
});

test("review: timer running with player arcs around the ring", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  const confirm = page.getByRole("button", { name: /^Confirm setup$/ });
  await page
    .getByRole("button", { name: "Vagabond", exact: true })
    .first()
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Woodland Alliance", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Eyrie Dynasties", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Marquise de Cat", exact: true })
    .click();
  await confirm.click();
  await page.getByRole("button", { name: /^Start Game$/ }).click();
  // Click the ring to start the timer running (state.started → true).
  // Wait a moment for the countdown to tick down so the ring fill is
  // visibly partial.
  await page.locator('[class*="timerRingWrapper"]').click();
  await page.waitForTimeout(2000);
  await save(page, "timer-running-with-arcs");
});

test("review: track after fire-once milestone has fired", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  const confirm = page.getByRole("button", { name: /^Confirm setup$/ });
  await page
    .getByRole("button", { name: "Vagabond", exact: true })
    .first()
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Woodland Alliance", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Eyrie Dynasties", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Marquise de Cat", exact: true })
    .click();
  await confirm.click();
  await page.getByRole("button", { name: /^Start Game$/ }).click();
  await page.locator("main").click();
  await page.locator("main").click();
  // Pump Player 1 to 4 and dismiss the dialog so the H marker at 4
  // disappears from the track. 8 and 12 remain.
  await page.evaluate(() => {
    (
      document.querySelector(
        'button[aria-label^="Player 1 score "]',
      ) as HTMLButtonElement | null
    )?.click();
  });
  const inc = page.getByRole("button", {
    name: /Increase score for Player 1/i,
  });
  for (let i = 0; i < 4; i++) await inc.click();
  await page.getByRole("button", { name: /^Acknowledge$/ }).click();
  await save(page, "track-after-milestone-fired");
});
