import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { navigateToScreen } from "./_setup-helpers";

/*
 * Drives the multi-screen setup wizard end-to-end with the Root
 * definition, capturing one screenshot per screen into
 * `local_docs/screenshots/wizard-*.png` (gitignored).
 *
 * Doubles as the ADSET-order smoke test: each screen is asserted
 * against an expectation drawn from the canonical advanced-setup
 * sequence on therootdatabase.com/law/advanced-setup/en/.
 *
 * Selectors prefer accessible queries (role + name, label) over
 * data-testid. Screens are reached by polling for their heading
 * rather than counting Next clicks.
 */

const BASE = "/game-timer";
const OUT_DIR = path.resolve(__dirname, "../local_docs/screenshots");

const save = (page: Page, name: string) =>
  page.screenshot({
    path: path.join(OUT_DIR, `wizard-${name}.png`),
    fullPage: true,
  });

test.use({ viewport: { width: 1280, height: 900 } });

test("Root setup wizard — full ADSET walkthrough with screenshots", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);

  // ── Game pick ────────────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: /pick a game/i }),
  ).toBeVisible();
  await page.getByLabel(/^Game$/).selectOption("root");
  await save(page, "01-game-root");

  // ── Expansions ───────────────────────────────────────────
  await navigateToScreen(page, /expansions in this game/i);
  // All expansions checked by default.
  await expect(page.getByLabel("Base game", { exact: false })).toBeChecked();
  await expect(page.getByLabel("Riverfolk Expansion")).toBeChecked();
  await expect(page.getByLabel("Marauder Expansion")).toBeChecked();
  // Turn two off to verify the downstream filter still works.
  await page.getByLabel("Homeland Expansion").uncheck();
  await page.getByLabel("Underworld Expansion").uncheck();
  await save(page, "03-expansions");

  // ── Map ──────────────────────────────────────────────────
  await navigateToScreen(page, /^Map$/);
  await expect(page.getByRole("button", { name: /^Autumn$/ })).toBeVisible();
  // Underworld + Homeland maps should be hidden.
  await expect(page.getByRole("button", { name: /^Lake$/ })).toHaveCount(0);
  await save(page, "04-map");
  await page.getByRole("button", { name: /^Winter$/ }).click();

  // ── Deck ─────────────────────────────────────────────────
  await navigateToScreen(page, /^Deck$/);
  await expect(
    page.getByRole("button", { name: /Exiles and Partisans/ }),
  ).toBeVisible();
  await save(page, "05-deck");
  await page.getByRole("button", { name: /Exiles and Partisans/ }).click();

  // ── Landmarks ────────────────────────────────────────────
  await navigateToScreen(page, /^Landmarks$/);
  await save(page, "06-landmarks");

  // ── Seat players ─────────────────────────────────────────
  await navigateToScreen(page, /seat players/i);
  await page.getByLabel(/^Seat 1 name$/).fill("Jon");
  await page.getByLabel(/^Seat 2 name$/).fill("Alex");
  await page.getByLabel(/^Seat 3 name$/).fill("Sam");
  await page.getByLabel(/^Seat 4 name$/).fill("Riley");
  // Reorder: nudge seat 2 up so Alex becomes seat 1.
  await page.getByRole("button", { name: /Move seat 2 up/ }).click();
  await save(page, "07-seating");

  // ── Hirelings ────────────────────────────────────────────
  await navigateToScreen(page, /^Hirelings$/);
  await save(page, "08-hirelings-default-skipped");
  await page.getByRole("button", { name: /Shuffle/ }).click();
  await save(page, "09-hirelings-dealt");
  // Skip them out so the faction picker pool is deterministic.
  await page.getByRole("button", { name: /^Skip$/ }).click();

  // ── Faction picker (last screen) ─────────────────────────
  await navigateToScreen(page, /^Faction$/);
  await expect(page.locator(":text('choose a faction')").first()).toBeVisible();
  await save(page, "10-faction-picker-draft");
  // Switch out of draft mode for the screenshot below.
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  // Reveal ADSET text on Marquise via its labelled toggle.
  await page
    .getByRole("button", { name: /Show setup for Marquise de Cat/ })
    .click();
  await expect(page.getByText("Place your Keep")).toBeVisible();
  await save(page, "11-faction-picker-with-adset");

  // Pick factions for all four seats. Picking counts down from the
  // last seat (ADSET A.8.3), so click in reverse. `exact: true` so
  // the substring match doesn't trip on "Show setup for X" toggles.
  const factionCard = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await factionCard("Riverfolk Company").click();
  await factionCard("Woodland Alliance").click();
  await factionCard("Eyrie Dynasties").click();
  await factionCard("Marquise de Cat").click();
  await save(page, "12-faction-picker-all-picked");

  // Start the timer.
  await page.getByRole("button", { name: /start game/i }).click();
  await expect(
    page.getByRole("heading", { name: /game setup/i }),
  ).toHaveCount(0);
  await save(page, "13-timer-after-start");
});

test("Root faction draft — picker deals n+1 cards by default", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  // The picker defaults to draft mode, so just walking to it shows
  // a dealt hand of (seats + 1) cards. Default seats = 4 → 5 cards.
  await navigateToScreen(page, /^Faction$/);
  await expect(page.getByText(/Drafting 5 cards/)).toBeVisible();
  await save(page, "draft-02-faction-pool");
});

test("Hireling demotion — three dealt, two demoted at 4 players", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Hirelings$/);
  await page.getByRole("button", { name: /Shuffle/ }).click();
  await expect(
    page.getByText(/2 of 3 start demoted at 4 players/),
  ).toBeVisible();
  await save(page, "hirelings-demoted-4p");
});

test("Generic flow — collapses to Game / Turns / Players", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await expect(
    page.getByRole("heading", { name: /pick a game/i }),
  ).toBeVisible();
  await navigateToScreen(page, /how long is this game/i);
  await navigateToScreen(page, /Players \(optional\)/i);
  await save(page, "generic-01-players");
});
