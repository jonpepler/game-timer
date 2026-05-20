/*
 * Multi-page Playwright tests for the host ↔ companion(s) flow during
 * the setup wizard.
 *
 * Uses a BroadcastChannel-based fake of the PeerJS layer (injected via
 * `addInitScript` — see `_peer-test-injection.ts`) so multiple pages on
 * the same origin can talk to each other without contacting the real
 * broker. Real PeerJS / WebRTC is exercised separately in unit tests;
 * here we only care that the host's wizard, the host's peer plumbing,
 * and the companion screens cohere when wired together.
 *
 * Host flow we lean on:
 *   1) /timer mounts → wizard auto-opens
 *   2) Cancel the wizard so the Share button is reachable
 *   3) Click Share → host peer opens (test fake resolves instantly)
 *   4) Read the session code off the Share chip
 *   5) Open companion page(s) with that code
 *   6) Click "New game" → wizard re-opens → seating broadcast fires
 *
 * From there each test exercises a different aspect of the protocol.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";

const BASE = "/game-timer";

// Inject the BroadcastChannel fake into every page born from this
// context (host + companions). Must be installed before any page-level
// JS runs so `window.__PEER_TEST_FACTORY` is in place when the React
// hooks call `createHost` / `connectToHost`.
async function installTestPeer(context: BrowserContext) {
  await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
}

// Open the host's /timer page and return the user-visible session
// code. The wizard auto-opens, which in turn auto-fires
// sessionHost.open() — with the test peer factory installed this
// resolves instantly, so the SharePanel inside the wizard's side
// pane shows the code immediately. We dismiss the wizard after
// reading so the rest of the test can interact with the chrome.
async function startHostAndShare(page: Page): Promise<string> {
  await page.goto(`${BASE}/timer`);
  // Wait for the SharePanel (rendered inside the wizard's modal as
  // the side pane) to have an actual code visible — the test peer
  // resolves the open state synchronously, so this is fast.
  const chip = page.getByRole("button", { name: /^Sharing session / });
  await chip.waitFor({ timeout: 5000 });
  const ariaLabel = (await chip.getAttribute("aria-label")) ?? "";
  const match = /Sharing session (\S+),/.exec(ariaLabel);
  if (!match) throw new Error(`couldn't find code in: ${ariaLabel}`);
  // Dismiss the wizard so the rest of the test can click "New game"
  // on the chrome to reopen it (mirrors the production flow of
  // claiming seats, then bumping into the wizard repeatedly).
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  return match[1];
}

// Click "New game" in the host chrome to re-open the wizard so the
// seating broadcast fires for connected companions.
async function openNewGameWizard(page: Page) {
  await page.getByRole("button", { name: /start a new game/i }).click();
  await page.getByRole("heading", { name: /Game Setup/i }).waitFor();
}

// Open a companion screen in a fresh page within the same context, with
// the given host session code attached as a query param.
async function openCompanion(
  context: BrowserContext,
  hostCode: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/companion?code=${encodeURIComponent(hostCode)}`);
  // Wait for the connection to settle so subsequent assertions don't
  // race against the fake-peer ACK.
  await expect(
    page.getByText(new RegExp(`Connected to ${hostCode}`)),
  ).toBeVisible({ timeout: 5000 });
  return page;
}

test.describe("companion multi-screen — setup-time seating", () => {
  test.beforeEach(async ({ context }) => {
    await installTestPeer(context);
  });

  test("companion that joins mid-wizard sees the seat list and can claim a seat", async ({
    context,
  }) => {
    const host = await context.newPage();
    const code = await startHostAndShare(host);
    const companion = await openCompanion(context, code);

    // Re-open the wizard from the host. Default definition is
    // Generic, which has no seat-players step → switch to Root so the
    // seating broadcast fires.
    await openNewGameWizard(host);
    await host.getByLabel(/^Game$/).selectOption("root");

    // Companion should now render a "Take a seat" panel populated
    // from the host wizard's default seat list (Root defaults to 4).
    await expect(companion.getByText(/take a seat/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(
      companion.getByRole("button", { name: /^Claim seat 1$/ }),
    ).toBeVisible();
    await expect(
      companion.getByRole("button", { name: /^Claim seat 4$/ }),
    ).toBeVisible();

    // Claim seat 1 from the companion.
    await companion.getByRole("button", { name: /^Claim seat 1$/ }).click();

    // Companion now renders the rename input for its claimed seat —
    // proof the host accepted the claim and the round-trip
    // SETUP_SEATING reached us.
    await expect(
      companion.getByRole("textbox", { name: /Rename seat 1/i }),
    ).toBeVisible({ timeout: 3000 });
  });

  test("two companions can claim different seats and see each other's claims", async ({
    context,
  }) => {
    const host = await context.newPage();
    const code = await startHostAndShare(host);
    const c1 = await openCompanion(context, code);
    const c2 = await openCompanion(context, code);

    await openNewGameWizard(host);
    await host.getByLabel(/^Game$/).selectOption("root");

    // Each companion claims its own seat.
    await c1.getByRole("button", { name: /^Claim seat 1$/ }).click();
    await c2.getByRole("button", { name: /^Claim seat 2$/ }).click();

    // c1 sees its own seat as a rename input, and c2's seat as
    // claimed-by-someone-else (i.e. a "Seat 2 taken" disabled
    // button via the aria-label projection).
    await expect(
      c1.getByRole("textbox", { name: /Rename seat 1/i }),
    ).toBeVisible({ timeout: 3000 });
    await expect(
      c1.getByRole("button", { name: /^Seat 2 taken$/ }),
    ).toBeVisible();

    // Symmetric for c2.
    await expect(
      c2.getByRole("textbox", { name: /Rename seat 2/i }),
    ).toBeVisible({ timeout: 3000 });
    await expect(
      c2.getByRole("button", { name: /^Seat 1 taken$/ }),
    ).toBeVisible();
  });

  test("companion rename propagates to other companions", async ({
    context,
  }) => {
    const host = await context.newPage();
    const code = await startHostAndShare(host);
    const c1 = await openCompanion(context, code);
    const c2 = await openCompanion(context, code);

    await openNewGameWizard(host);
    await host.getByLabel(/^Game$/).selectOption("root");

    await c1.getByRole("button", { name: /^Claim seat 1$/ }).click();
    await c1.getByRole("textbox", { name: /Rename seat 1/i }).fill("Alice");

    // c2 should see seat 1's text change to include "Alice". The
    // remaining-seat buttons render text "Seat N — <name>" inside
    // the (aria-labelled) button; c2's view of seat 1 isn't a claim
    // button (because c1 holds it) so we match the visible text.
    await expect(c2.getByText(/Seat 1 — Alice/i)).toBeVisible({
      timeout: 3000,
    });

    // And the host's wizard reflects the rename via the seat-name
    // input on the seating screen. Root's seating step is reached
    // by navigating past Expansions/Map/Deck/Landmarks.
    await navigateToScreen(host, /seat players/i);
    await expect(host.getByLabel(/^Seat 1 name$/)).toHaveValue("Alice", {
      timeout: 3000,
    });
  });

  test("companion add seat extends the host wizard's seating list", async ({
    context,
  }) => {
    const host = await context.newPage();
    const code = await startHostAndShare(host);
    const companion = await openCompanion(context, code);

    await openNewGameWizard(host);
    await host.getByLabel(/^Game$/).selectOption("root");

    // Initial state: Root defaults to 4 seats — no seat 5.
    await expect(
      companion.getByRole("button", { name: /^Claim seat 4$/ }),
    ).toBeVisible();
    await expect(
      companion.getByRole("button", { name: /^Claim seat 5$/ }),
    ).toHaveCount(0);

    // Add a seat from the companion.
    await companion.getByRole("button", { name: /\+ Add seat/i }).click();

    // Companion now sees seat 5.
    await expect(
      companion.getByRole("button", { name: /^Claim seat 5$/ }),
    ).toBeVisible({ timeout: 3000 });
  });
});

test.describe("companion multi-screen — identity-bound picks", () => {
  test.beforeEach(async ({ context }) => {
    await installTestPeer(context);
  });

  test("companion claimed at the active picker seat gets SETUP_TURN and can pick its faction", async ({
    context,
  }) => {
    const host = await context.newPage();
    const code = await startHostAndShare(host);
    const companion = await openCompanion(context, code);

    await openNewGameWizard(host);
    await host.getByLabel(/^Game$/).selectOption("root");

    // Companion claims the LAST seat — Root's pick order goes
    // counterclockwise starting from the last seat (ADSET A.8.3),
    // so the companion will be the first picker.
    await companion.getByRole("button", { name: /^Claim seat 4$/ }).click();
    await expect(
      companion.getByRole("textbox", { name: /Rename seat 4/i }),
    ).toBeVisible({ timeout: 3000 });

    // Host walks the wizard to the faction picker. Draft is ON by
    // default — the picker IS the draft: a dealt hand of N+1 cards
    // gets handed to the seated companion via SETUP_TURN. There's
    // no separate "draft step then pick step" — both happen on this
    // one screen.
    await navigateToScreen(host, /^Faction$/);

    // Companion's picker overlay renders the dealt hand. The deal
    // is random per run, so we can't pin to a specific faction —
    // we scope the locator to the picker region (a labelled
    // region so it doesn't catch the page's chrome buttons), pick
    // the first dealt card, and verify the host wizard registers
    // that same faction against seat 4.
    const pickerPanel = companion.getByRole("region", {
      name: /Your turn to pick a faction/i,
    });
    await expect(pickerPanel).toBeVisible({ timeout: 5000 });
    const firstCard = pickerPanel.getByRole("button").first();
    const pickedLabel = (await firstCard.innerText()).trim();
    await firstCard.click();

    // Host's wizard records the pick against seat 4. The picker
    // summary at the bottom of the faction screen shows
    // "Player 4 — <faction>" once a pick lands.
    await expect(
      host.getByText(new RegExp(`Player 4.*${pickedLabel}`)),
    ).toBeVisible({ timeout: 3000 });
  });
});

test.describe("companion multi-screen — game-time interaction", () => {
  test.beforeEach(async ({ context }) => {
    await installTestPeer(context);
  });

  test("Generic + no-tracking: companion's Next-turn taps advance the host timer", async ({
    context,
  }) => {
    const host = await context.newPage();
    await host.goto(`${BASE}/timer`);

    // Walk the host through the Generic wizard with tracking OFF so
    // the timer runs without per-player slots. There's no seating to
    // broadcast in this flow — companion will see a "nothing to
    // claim here" message and a Next-turn button.
    await host.getByRole("button", { name: /^Next/ }).click(); // Game → Turns
    await host.getByRole("button", { name: /^Next/ }).click(); // Turns → Players
    await host.getByRole("button", { name: /start game/i }).click();

    // Wait for the wizard dialog to close and the timer-view footer
    // to mount so the tap-to-advance click handler is wired up. The
    // Hourglass + "turns left" combo lives in the footer; "90 turns
    // left" is the Generic default before any taps.
    await expect(host.getByText(/90\s*turns left/i)).toBeVisible();

    // Tap twice — the first tap *starts* the timer (no turn
    // recorded), the second records turn 1 → 89 remaining.
    await host.locator("main").click();
    await host.locator("main").click();
    await expect(host.getByText(/89\s*turns left/i)).toBeVisible();

    // Read the session code off the now-visible chrome chip. The
    // share session was auto-opened when the wizard mounted, so by
    // the time we reach the timer view the chip is already in
    // open state.
    const chip = host.getByRole("button", { name: /^Sharing session / });
    await chip.waitFor();
    const code = (/Sharing session (\S+),/.exec(
      (await chip.getAttribute("aria-label")) ?? "",
    ) ?? [])[1];
    if (!code) throw new Error("no session code");

    const companion = await openCompanion(context, code);

    // Generic + no-tracking: companion shows the "nothing to claim"
    // message AND a Next turn button. Tap it; host's remaining-turns
    // should decrement.
    await expect(
      companion.getByText(/nothing to claim or score from here/i),
    ).toBeVisible({ timeout: 5000 });
    await companion.getByRole("button", { name: /^Next turn$/ }).click();
    // Companion's tap advances the host timer → 88 remaining.
    await expect(host.getByText(/88\s*turns left/i)).toBeVisible({
      timeout: 3000,
    });
  });
});
