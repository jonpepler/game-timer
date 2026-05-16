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
