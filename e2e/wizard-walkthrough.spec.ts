import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

/*
 * Drives the multi-screen setup wizard end-to-end with the Root
 * definition, capturing one screenshot per screen into
 * `local_docs/screenshots/wizard-*.png` (gitignored).
 *
 * Doubles as the ADSET-order smoke test: each screen is asserted
 * against an expectation drawn from the canonical advanced-setup
 * sequence on therootdatabase.com/law/advanced-setup/en/.
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

  // ── 1. Game pick ─────────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: /pick a game/i }),
  ).toBeVisible();
  await page.getByLabel(/^Game$/).selectOption("root");
  await save(page, "01-game-root");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 2. Expected turns ────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: /how long is this game/i }),
  ).toBeVisible();
  await save(page, "02-expected-turns");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 3. Expansions (multi-toggle) ─────────────────────────
  await expect(
    page.getByRole("heading", { name: /expansions in this game/i }),
  ).toBeVisible();
  // Default: Base only is checked.
  const baseToggle = page.getByLabel("Base game", { exact: false });
  await expect(baseToggle).toBeChecked();
  // Turn on Riverfolk + Marauders so downstream steps reveal those options.
  await page.getByLabel("Riverfolk Expansion").check();
  await page.getByLabel("Marauder Expansion").check();
  await save(page, "03-expansions");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 4. Map (select-one) ──────────────────────────────────
  await expect(page.getByRole("heading", { name: /^Map$/ })).toBeVisible();
  // Underworld + Homeland maps should be hidden (those expansions are off).
  await expect(page.getByRole("button", { name: /Autumn/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Lake/ })).toHaveCount(0);
  await save(page, "04-map");
  await page.getByRole("button", { name: /Winter/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 5. Deck (select-one) ─────────────────────────────────
  await expect(page.getByRole("heading", { name: /^Deck$/ })).toBeVisible();
  // Exiles is Riverfolk (visible); Squires is Marauders (visible).
  await expect(
    page.getByRole("button", { name: /Exiles and Partisans/ }),
  ).toBeVisible();
  await save(page, "05-deck");
  await page.getByRole("button", { name: /Exiles and Partisans/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 6. Landmarks (select-count) ──────────────────────────
  await expect(
    page.getByRole("heading", { name: /^Landmarks$/ }),
  ).toBeVisible();
  await save(page, "06-landmarks");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 7. Seat players (seat-players) ───────────────────────
  await expect(
    page.getByRole("heading", { name: /seat players/i }),
  ).toBeVisible();
  // Default count is 4 per the definition.
  await page.getByLabel(/Seat 1 name/).fill("Jon");
  await page.getByLabel(/Seat 2 name/).fill("Alex");
  await page.getByLabel(/Seat 3 name/).fill("Sam");
  await page.getByLabel(/Seat 4 name/).fill("Riley");
  // Reorder: nudge seat 2 up to seat 1.
  await page.getByLabel(/Move seat 2 up/).click();
  await save(page, "07-seating");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 8. Hirelings (deal-random) ───────────────────────────
  await expect(
    page.getByRole("heading", { name: /^Hirelings$/ }),
  ).toBeVisible();
  await save(page, "08-hirelings-default-skipped");
  // Shuffle in 3 (random Marauder + Riverfolk pool since those expansions are on).
  await page.getByRole("button", { name: /Shuffle/ }).click();
  await save(page, "09-hirelings-dealt");
  // The shuffled hirelings might exclude some factions via matchingHireling.
  // For a deterministic faction-picker screenshot below, skip them out
  // before advancing.
  await page.getByRole("button", { name: /^Skip$/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 9. Draft factions (toggle) ───────────────────────────
  await expect(
    page.getByRole("heading", { name: /draft factions/i }),
  ).toBeVisible();
  await save(page, "10-draft");
  await page.getByRole("button", { name: /^Next/ }).click();

  // ── 10. Faction picker (player-pick) ─────────────────────
  await expect(page.getByRole("heading", { name: /^Faction$/ })).toBeVisible();
  // Picker header reflects active seat.
  await expect(page.locator(":text('choose a faction')").first()).toBeVisible();
  // Reveal ADSET text for one faction via its unique test id.
  await page.getByTestId("faction-adset-toggle-marquise").click();
  await expect(page.getByText("Place your Keep")).toBeVisible();
  await save(page, "11-faction-picker-with-adset");

  // Pick factions for all four seats via stable test ids on the cards.
  // Auto-advance handles the seat pointer between clicks.
  await page.getByTestId("faction-card-marquise").click();
  await page.getByTestId("faction-card-eyrie").click();
  await page.getByTestId("faction-card-alliance").click();
  await page.getByTestId("faction-card-riverfolk").click();
  await save(page, "12-faction-picker-all-picked");

  // ── 11. Start Game (no confirmation screen per ADSET — players
  //        perform their setup immediately on pick) ──────────────
  await page.getByRole("button", { name: /start game/i }).click();
  // Modal closes; timer page shows the active-player banner.
  await expect(
    page.getByRole("heading", { name: /game setup/i }),
  ).toHaveCount(0);
  await save(page, "13-timer-after-start");
});

test("Root faction draft — draft toggle dishes n+1 cards and re-shuffles", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  // Game → Turns → Expansions → Map → Deck → Landmarks → Seating →
  // Hirelings → Draft → Faction. Default Marauder is off; turn on so
  // the wizard reaches the picker with a meaningful pool.
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("Marauder Expansion").check();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  // Hirelings — leave skipped.
  await page.getByRole("button", { name: /^Next/ }).click();
  // Draft → ON.
  await page.getByLabel(/Enabled|Disabled/).check();
  await save(page, "draft-01-toggle-on");
  await page.getByRole("button", { name: /^Next/ }).click();
  // Faction picker with draft on: n+1 cards visible. With 4 seats →
  // 5 dealt cards out of the legal pool.
  await expect(page.getByText(/Drafting 5 cards/)).toBeVisible();
  await save(page, "draft-02-faction-pool");
});

test("Hireling demotion — three dealt, two demoted at 4 players", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("Marauder Expansion").check();
  // Map / Deck / Landmarks / Seating (default 4)
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  // Now Hirelings — shuffle.
  await page.getByRole("button", { name: /Shuffle/ }).click();
  await expect(page.getByText(/2 of 3 start demoted at 4 players/)).toBeVisible();
  await save(page, "hirelings-demoted-4p");
});

test("Generic flow — collapses to Game / Turns / Players", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  // Generic is the default. The wizard shows only Game / Turns / Players.
  await expect(
    page.getByRole("heading", { name: /pick a game/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(
    page.getByRole("heading", { name: /how long is this game/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(
    page.getByRole("heading", { name: /Players \(optional\)/i }),
  ).toBeVisible();
  await save(page, "generic-01-players");
});
