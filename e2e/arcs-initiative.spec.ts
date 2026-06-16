/*
 * Arcs lead-relative turn order — end-to-end.
 *
 * Covers the two genuinely new runtime paths:
 *   1) Round-end picker (host-only): a round closes with nobody having
 *      seized, so the table is asked "Who took the initiative?".
 *   2) Companion seize (multi-screen): the active seat seizes from a
 *      companion device, the host validates + dispatches, and the lead
 *      auto-advances to the seizer at round end (no picker).
 *
 * Uses the same BroadcastChannel peer fake as companion-multiscreen.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";

const BASE = "/game-timer";

async function installTestPeer(context: BrowserContext) {
  await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
}

// Advance the turn via the ring's keyboard affordance (Enter). A real
// tap works too, but the score-panel overlay can sit over the lower
// ring and intercept pointer clicks in a 2-player Arcs game; the
// keyboard path drives the same handler without the occlusion.
const tapRing = (page: Page) =>
  page.getByRole("button", { name: "Advance turn" }).press("Enter");

// The active-player banner container (not its child text spans, which
// also carry an activePlayer* class — the trailing "__" pins the match
// to the CSS-module container class).
const activeBanner = (page: Page) => page.locator('[class*="activePlayer__"]');

const roundEndPicker = (page: Page) =>
  page.getByRole("alertdialog", { name: /Who took the initiative/i });

// Walk the host through an Arcs setup: 2 seats, default initiative
// (Player 1), two distinct leaders via the full pool (Skip draft), then
// start the game. Leaves the host on the timer view, not yet running.
async function startArcs2p(page: Page) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");

  // Seating: Arcs defaults to 4 — drop to 2.
  await navigateToScreen(page, /seat players/i);
  await page.getByRole("button", { name: /Remove seat 4/ }).click();
  await page.getByRole("button", { name: /Remove seat 3/ }).click();

  // Leader pick: skip the dealt draft to expose the full pool, then
  // pick two distinct leaders (reverse seat order — seat 2 picks first).
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  for (const leader of ["Elder", "Mystic"]) {
    await page.getByRole("button", { name: leader, exact: true }).click();
    await page.getByRole("button", { name: /^Confirm setup$/ }).click();
  }

  // Two info steps (Set up your Leader, Court & action cards) then the
  // submit button. Click Next until Start Game is reachable.
  const startBtn = page.getByRole("button", { name: /start game/i });
  for (let i = 0; i < 4; i++) {
    if (await startBtn.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await startBtn.click();
  await expect(page.getByText(/turns left/i)).toBeVisible({ timeout: 15_000 });
}

function readSessionCode(page: Page): Promise<string> {
  const chip = page.getByRole("button", { name: /^Sharing session / });
  return chip
    .waitFor({ timeout: 5000 })
    .then(() => chip.getAttribute("aria-label"))
    .then((label) => {
      const code = (/Sharing session (\S+),/.exec(label ?? "") ?? [])[1];
      if (!code) throw new Error(`no session code in: ${label}`);
      return code;
    });
}

async function openCompanion(
  context: BrowserContext,
  code: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/companion?code=${encodeURIComponent(code)}`);
  await expect(page.getByText(new RegExp(`Connected to ${code}`))).toBeVisible({
    timeout: 5000,
  });
  return page;
}

test.describe("arcs lead-relative initiative", () => {
  test.beforeEach(async ({ context }) => {
    await installTestPeer(context);
  });

  test("round ending with no seize prompts the table for the next lead", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startArcs2p(page);

    // tap 1 starts the timer; taps 2 and 3 record one turn each — a
    // full 2-seat round. No seize, so the round-end picker fires.
    await tapRing(page); // start
    await tapRing(page); // Player 1's turn recorded → Player 2 active
    await expect(activeBanner(page)).toContainText("Player 2");
    await tapRing(page); // Player 2's turn recorded → round complete

    await expect(roundEndPicker(page)).toBeVisible({ timeout: 5000 });

    // Pick Player 1 as the seat that took the initiative; the picker
    // closes and Player 1 leads the next round.
    await roundEndPicker(page)
      .getByRole("button", { name: /^Player 1$/ })
      .click();
    await expect(roundEndPicker(page)).toBeHidden();
    await expect(activeBanner(page)).toContainText("Player 1");
  });

  test("companion at the active seat seizes; the lead auto-advances to it", async ({
    context,
  }) => {
    test.setTimeout(120_000);
    const host = await context.newPage();
    await startArcs2p(host);

    // Advance so Player 2 (seat index 1) is the active seat and one
    // turn is on record (so the companion's gameStarted gate is met).
    await tapRing(host); // start
    await tapRing(host); // → Player 2 active, 1 turn recorded
    await expect(activeBanner(host)).toContainText("Player 2");

    const code = await readSessionCode(host);
    const companion = await openCompanion(context, code);

    // Claim Player 2 (the active seat) on the companion.
    await expect(companion.getByText(/claim a player/i)).toBeVisible({
      timeout: 15_000,
    });
    await companion.locator('[class*="claimRow"]').nth(1).click();

    // The companion offers the seize action (label sourced from the
    // Arcs definition) because it holds the active seat.
    const seize = companion.getByRole("button", {
      name: /Seize the Initiative/i,
    });
    await expect(seize).toBeVisible({ timeout: 10_000 });
    await seize.click();

    // Round-trip proof: the host validated + dispatched, and the echoed
    // STATE flips canSeize false, so the companion's button disappears.
    await expect(seize).toBeHidden({ timeout: 5000 });

    // Close the round on the host. Because Player 2 seized, the lead
    // auto-advances to it with NO round-end picker.
    await tapRing(host); // Player 2's turn recorded → round complete
    await expect(roundEndPicker(host)).toBeHidden();
    await expect(activeBanner(host)).toContainText("Player 2");
  });
});
