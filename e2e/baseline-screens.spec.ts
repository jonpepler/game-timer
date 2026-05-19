import { test, expect } from "@playwright/test";
import path from "node:path";

// Visual baselines for the landing page + key timer states.
// Output goes to local_docs/screenshots/ (gitignored). The wizard
// screenshots live in wizard-walkthrough.spec.ts.

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

// Walk the wizard to default (Generic, no tracking) and screenshot the timer.
test("timer view baseline (no players, mid-session)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  // Click Next through the three Generic wizard screens (Game → Turns → Players)
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /start game/i }).click();
  await page.locator("main").click();
  await page.waitForTimeout(1500);
  await save(page, "04-timer-default");
});

test("timer view baseline (with players, Generic)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel(/track individual players/i).check();
  await page.getByLabel(/^Player 1 colour$/).waitFor();
  await page.getByRole("button", { name: /start game/i }).click();
  await page.locator("main").click();
  await page.waitForTimeout(1500);
  await page.locator("main").click();
  await page.waitForTimeout(1000);
  await page.locator("main").click();
  await page.waitForTimeout(800);
  await save(page, "05-timer-with-players");
});

test("timer view baseline (Root, scores in play)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  // Game: switch to Root.
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByRole("button", { name: /^Next/ }).click();
  // Expected turns
  await page.getByRole("button", { name: /^Next/ }).click();
  // Expansions (defaults to base only — leave as-is)
  await page.getByRole("button", { name: /^Next/ }).click();
  // Map (default Autumn)
  await page.getByRole("button", { name: /^Next/ }).click();
  // Deck (default Base)
  await page.getByRole("button", { name: /^Next/ }).click();
  // Landmarks
  await page.getByRole("button", { name: /^Next/ }).click();
  // Seating — leave defaults
  await page.getByRole("button", { name: /^Next/ }).click();
  // Hirelings (skipped by default)
  await page.getByRole("button", { name: /^Next/ }).click();
  // Draft
  await page.getByRole("button", { name: /^Next/ }).click();
  // Faction picker — pick 4 in turn order.
  await page.getByTestId("faction-card-marquise").click();
  await page.getByTestId("faction-card-eyrie").click();
  await page.getByTestId("faction-card-alliance").click();
  await page.getByTestId("faction-card-vagabond").click();
  await page.getByRole("button", { name: /^Next/ }).click();
  // ADSET confirmation → Start.
  await page.getByRole("button", { name: /start game/i }).click();

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
  // Score buttons key off player.name now. The default seating names
  // are "Player 1".."Player 4" since the test doesn't rename them.
  await selectMarker("Player 1");
  for (let i = 0; i < 7; i++) await inc("Player 1").click();
  await selectMarker("Player 2");
  for (let i = 0; i < 4; i++) await inc("Player 2").click();
  await selectMarker("Player 3");
  for (let i = 0; i < 12; i++) await inc("Player 3").click();
  await save(page, "06-timer-with-scores");
});
