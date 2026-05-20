import { test, expect } from "@playwright/test";
import path from "node:path";
import { navigateToScreen } from "./_setup-helpers";

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
  await navigateToScreen(page, /Players \(optional\)/i);
  await page.getByRole("button", { name: /start game/i }).click();
  await page.locator("main").click();
  await page.waitForTimeout(1500);
  await save(page, "04-timer-default");
});

test("timer view baseline (with players, Generic)", async ({ page }) => {
  await page.goto(`${BASE}/timer`);
  await navigateToScreen(page, /Players \(optional\)/i);
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
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  // Counterclockwise pick order — click in reverse so seat 1 = Marquise.
  const factionCard = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const confirmButton = page.getByRole("button", { name: /^Confirm setup$/ });
  await factionCard("Vagabond").click();
  await confirmButton.click();
  await factionCard("Woodland Alliance").click();
  await confirmButton.click();
  await factionCard("Eyrie Dynasties").click();
  await confirmButton.click();
  await factionCard("Marquise de Cat").click();
  await confirmButton.click();
  // The fourth Confirm auto-submits + auto-starts the timer.

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
