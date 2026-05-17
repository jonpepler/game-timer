import { test, expect } from "@playwright/test";
import path from "node:path";

// Captures baseline screenshots of every key surface for the UI overhaul.
// Outputs go to local_docs/screenshots/ (gitignored). The spec also acts
// as a smoke test — every screen must render without throwing.

const BASE = "/game-timer";
const OUT_DIR = path.resolve(__dirname, "../local_docs/screenshots");

const save = async (
  page: import("@playwright/test").Page,
  name: string,
) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });

test.use({ viewport: { width: 1280, height: 800 } });

test("landing screen baseline", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("link", { name: /new game/i })).toBeVisible();
  await save(page, "01-landing");
});

test("setup modal baseline (default)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await expect(
    page.getByRole("heading", { name: /game setup/i }),
  ).toBeVisible();
  await save(page, "02-setup-default");
});

test("setup modal baseline (with player tracking enabled)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill("4");
  await save(page, "03-setup-players");
});

test("setup modal baseline (Root definition picked)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill("4");
  await save(page, "03b-setup-root");
});

test("timer view baseline (no players, mid-session)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByRole("button", { name: /start game/i }).click();
  // Start the timer (first tap on container) and let a beat pass so the
  // countdown is visibly running.
  await page.locator("main").click();
  await page.waitForTimeout(1500);
  await save(page, "04-timer-default");
});

test("timer view baseline (with players)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill("3");
  await page.getByRole("button", { name: /start game/i }).click();
  await page.locator("main").click();
  await page.waitForTimeout(1500);
  // Advance a few turns so PlayerTimeShare has data
  await page.locator("main").click();
  await page.waitForTimeout(1000);
  await page.locator("main").click();
  await page.waitForTimeout(800);
  await save(page, "05-timer-with-players");
});

test("timer view baseline (Root with scores in play)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/number of players/i).fill("4");
  await page.getByRole("button", { name: /start game/i }).click();
  // Score-panel markers at identical scores stack on top of each other,
  // so the screenshot fixture selects via a synthetic click on the
  // exact element rather than relying on hit-testing.
  const selectMarker = (name: string) =>
    page.evaluate((n) => {
      const btn = document.querySelector(
        `button[aria-label^="${n} score "]`,
      ) as HTMLButtonElement | null;
      btn?.click();
    }, name);
  const inc = (name: string) =>
    page.getByRole("button", {
      name: new RegExp(`Increase score for ${name}`, "i"),
    });
  await selectMarker("Marquise de Cat");
  for (let i = 0; i < 7; i++) await inc("Marquise de Cat").click();
  await selectMarker("Eyrie Dynasties");
  for (let i = 0; i < 4; i++) await inc("Eyrie Dynasties").click();
  await selectMarker("Woodland Alliance");
  for (let i = 0; i < 12; i++) await inc("Woodland Alliance").click();
  await save(page, "06-timer-with-scores");
});
