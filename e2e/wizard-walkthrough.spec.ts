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
  // The hero picker is identity-bound — the prompt names the
  // active picker seat ("choose your faction").
  await expect(page.getByText(/choose your faction/i)).toBeVisible();
  await save(page, "10-faction-picker-draft");
  // Switch out of draft mode for the screenshot below.
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  // ADSET steps are now PERMANENTLY rendered on each card (no
  // toggle) — the hero treatment shows them inline, so we just
  // assert the marquise's setup text is visible somewhere.
  await expect(page.getByText("Place your Keep").first()).toBeVisible();
  await save(page, "11-faction-picker-with-adset");

  // Pick factions for all four seats. Each pick is two-step now
  // (click card → preview opens → press Confirm). Picking counts
  // down from the last seat (ADSET A.8.3), so click in reverse.
  const factionCard = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const confirmButton = page.getByRole("button", { name: /^Confirm setup$/ });
  await factionCard("Riverfolk Company").click();
  await confirmButton.click();
  await factionCard("Woodland Alliance").click();
  await confirmButton.click();
  await factionCard("Eyrie Dynasties").click();
  await confirmButton.click();
  await factionCard("Marquise de Cat").click();
  await confirmButton.click();
  // Faction is no longer the final wizard step — A.10 "Choose
  // Starting Hands" follows it. The fourth Confirm advances the
  // wizard to that info screen; clicking Start Game commits.
  await expect(
    page.getByRole("heading", { name: /Choose Starting Hands/i }),
  ).toBeVisible();
  await save(page, "12b-choose-starting-hands");
  await page.getByRole("button", { name: /^Start Game$/ }).click();
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
  // We assert by counting the dealt card buttons in the hero row:
  // each card is a `role="button"` keyed by its faction label, and
  // exactly N+1 of them render in draft mode (vs the full legal
  // pool in skip-draft mode).
  await navigateToScreen(page, /^Faction$/);
  // The picker prompt always names the active seat, so this proves
  // we're on the hero picker screen.
  await expect(page.getByText(/choose your faction/i)).toBeVisible();
  // Count the dealt cards — Root has 14+ legal factions, so 5 ≠
  // the full pool.
  const cards = page
    .getByRole("region", { name: /faction picker/i })
    .or(page.locator('[class*="heroCardRow"]'))
    .first()
    .getByRole("button");
  await expect(cards).toHaveCount(5);
  await save(page, "draft-02-faction-pool");
});

// Regression: toggling Skip-draft → Back-to-draft used to wipe the
// dealt hand, generating a fresh n+1 set every time. The dealt list
// now persists across draft toggles so the player can free-pick a
// faction and return to the same draft.
test("Root faction draft — Skip + Back preserves the dealt hand", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);

  const cards = page
    .locator('[class*="heroCardRow"]')
    .first()
    .getByRole("button");
  // Capture the initial dealt hand by accessible label.
  const initial = await cards.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  );
  await expect(cards).toHaveCount(5);

  // Skip draft → full legal pool. Then come back to draft. The
  // dealt list should still be the same five faction labels in
  // the same order.
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  await page.getByRole("button", { name: /^Back to draft$/ }).click();

  const restored = await cards.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  );
  expect(restored).toEqual(initial);
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

// Regression: the LAST seat to confirm a pick used to lose its
// metadata because submit() captured stale closure state before
// React committed the applyPick setContext. The score-panel head
// icon for the last-picked seat would render as the positional
// fallback swatch instead of the faction's head-icon image.
test("Root faction picker — last seat keeps its metadata", async ({
  page,
}) => {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("root");
  await navigateToScreen(page, /^Faction$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  // Counterclockwise pick order — seat 4 first, seat 1 last.
  const confirm = page.getByRole("button", { name: /^Confirm setup$/ });
  await page.getByRole("button", { name: "Vagabond", exact: true }).click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Woodland Alliance", exact: true })
    .click();
  await confirm.click();
  await page
    .getByRole("button", { name: "Eyrie Dynasties", exact: true })
    .click();
  await confirm.click();
  // Marquise de Cat is seat 1 — the LAST to confirm, which is the
  // case that broke previously.
  await page
    .getByRole("button", { name: "Marquise de Cat", exact: true })
    .click();
  await confirm.click();
  // Faction is no longer the final wizard step (A.10 Choose
  // Starting Hands follows). Hit Start Game on the info screen so
  // the timer actually mounts and the score panel renders.
  await page.getByRole("button", { name: /^Start Game$/ }).click();

  // After auto-start the score panel renders per-player markers
  // keyed by SEAT name (default "Player N"). The marker for the
  // last-picked seat must surface the faction's head icon image —
  // if the metadata was lost, ScorePanel falls back to a colored
  // chip with no <img>. Player 1 = seat 1 = LAST to confirm (Root
  // picks counterclockwise from the highest seat number), so it's
  // the marker we have to check.
  const marker = page.getByRole("button", {
    name: /Player 1 score \d+/,
  });
  await expect(marker).toBeVisible();
  await expect(marker.locator("img")).toBeVisible();
});
