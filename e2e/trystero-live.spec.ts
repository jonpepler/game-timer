import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { navigateToScreen } from "./_setup-helpers";

/*
 * LIVE transport check — intentionally does NOT inject the
 * BroadcastChannel fake, so it drives the real selected transport
 * over real public Nostr relays. Trystero is the default transport, so a
 * plain dev server uses it. Not part of the normal suite.
 *
 *   npm run dev                                 # (separate terminal)
 *   TRYSTERO_LIVE=1 npx playwright test e2e/trystero-live.spec.ts
 */

const BASE = "/game-timer";
const HANDSHAKE_TIMEOUT = 40_000;

const collect = (page: Page, tag: string, sink: string[]) => {
  page.on("console", (m: ConsoleMessage) => {
    sink.push(`[${tag}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    sink.push(`[${tag}] PAGEERROR: ${e.message}`);
  });
};

const hasLog = (logs: string[], needle: string) =>
  logs.some((l) => l.includes(needle));

test("trystero: companion connects to host, then reconnects after a fresh join", async ({
  browser,
}) => {
  // Opt-in only: hits real public Nostr relays and assumes the dev
  // server runs with NEXT_PUBLIC_USE_TRYSTERO=true, so it must not run
  // as part of the normal e2e suite.
  test.skip(
    process.env.TRYSTERO_LIVE !== "1",
    "live relay test — run with TRYSTERO_LIVE=1 against a trystero dev server",
  );
  test.setTimeout(150_000);
  const logs: string[] = [];

  const hostCtx = await browser.newContext();
  const compCtx = await browser.newContext();
  let comp2Ctx: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  try {
    // --- Host device ---
    const host = await hostCtx.newPage();
    collect(host, "host", logs);
    await host.goto(`${BASE}/timer`);

    const shareBtn = host.getByRole("button", { name: /^Sharing session / });
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });
    const label = (await shareBtn.getAttribute("aria-label")) ?? "";
    const code = label.match(/Sharing session\s+([A-Z0-9]{4})/i)?.[1] ?? "";
    expect(code, `code from "${label}"`).toMatch(/^[A-Z0-9]{4}$/);

    // --- Companion device ---
    const comp = await compCtx.newPage();
    collect(comp, "comp", logs);
    await comp.goto(`${BASE}/companion?code=${code}`);

    await expect
      .poll(() => hasLog(logs, "host identified — connected"), {
        timeout: HANDSHAKE_TIMEOUT,
      })
      .toBe(true);
    await expect
      .poll(() => hasLog(logs, "companion joined"), {
        timeout: HANDSHAKE_TIMEOUT,
      })
      .toBe(true);

    // --- Reconnect: close the companion browser, rejoin fresh ---
    await compCtx.close();
    await host.waitForTimeout(1_500);
    const reconnectMarker = logs.length;

    comp2Ctx = await browser.newContext();
    const comp2 = await comp2Ctx.newPage();
    collect(comp2, "comp2", logs);
    await comp2.goto(`${BASE}/companion?code=${code}`);

    await expect
      .poll(
        () =>
          logs
            .slice(reconnectMarker)
            .some((l) => l.includes("host identified — connected")),
        { timeout: HANDSHAKE_TIMEOUT },
      )
      .toBe(true);
  } finally {
    // Always surface the transport-relevant logs for diagnosis.
    const relevant = logs.filter((l) =>
      /peer-trystero|peer\]|nostr|relay|websocket|PAGEERROR|RTC|ICE/i.test(l),
    );
    console.log(`\n===== TRANSPORT LOGS =====\n${relevant.join("\n")}`);
    await hostCtx.close().catch(() => {});
    await compCtx.close().catch(() => {});
    if (comp2Ctx) await comp2Ctx.close().catch(() => {});
  }
});

test("trystero: companion at the active seat seizes the initiative, live", async ({
  browser,
}) => {
  test.skip(
    process.env.TRYSTERO_LIVE !== "1",
    "live relay test — run with TRYSTERO_LIVE=1 against a trystero dev server",
  );
  test.setTimeout(180_000);
  const logs: string[] = [];

  const hostCtx = await browser.newContext();
  const compCtx = await browser.newContext();

  try {
    // --- Host: a 2-player Arcs game (lead-relative turn order) ---
    const host = await hostCtx.newPage();
    collect(host, "host", logs);
    await host.goto(`${BASE}/timer`);
    await host.getByLabel(/^Game$/).selectOption("arcs");

    await navigateToScreen(host, /seat players/i);
    await host.getByRole("button", { name: /Remove seat 4/ }).click();
    await host.getByRole("button", { name: /Remove seat 3/ }).click();

    await navigateToScreen(host, /^Leader$/);
    await host.getByRole("button", { name: /^Skip draft$/ }).click();
    for (const leader of ["Elder", "Mystic"]) {
      await host.getByRole("button", { name: leader, exact: true }).click();
      await host.getByRole("button", { name: /^Confirm setup$/ }).click();
    }
    const startBtn = host.getByRole("button", { name: /start game/i });
    for (let i = 0; i < 4; i++) {
      if (await startBtn.isVisible().catch(() => false)) break;
      await host.getByRole("button", { name: /^Next/ }).click();
    }
    await startBtn.click();
    await expect(host.getByText(/turns left/i)).toBeVisible({
      timeout: 15_000,
    });

    // Read the live session code.
    const shareBtn = host.getByRole("button", { name: /^Sharing session / });
    const label = (await shareBtn.getAttribute("aria-label")) ?? "";
    const code = label.match(/Sharing session\s+([A-Z0-9]{4})/i)?.[1] ?? "";
    expect(code, `code from "${label}"`).toMatch(/^[A-Z0-9]{4}$/);

    // Advance so Player 2 (seat index 1) is active with a turn recorded
    // (keyboard avoids the score-panel overlay intercepting ring taps).
    // Focus the ring and wait for the start press to register before
    // advancing — pressing Enter twice in a row can land while the ring
    // is still mounting, so the first press only focuses it and the
    // advance is swallowed, leaving Player 1 active.
    const ring = host.getByRole("button", { name: "Advance turn" });
    const banner = host.locator('[class*="activePlayer__"]');
    await ring.focus();
    await ring.press("Enter"); // start
    await expect(banner).toContainText("Player 1"); // start registered
    await ring.focus();
    await ring.press("Enter"); // record Player 1's turn → Player 2 active
    await expect(banner).toContainText("Player 2");

    // --- Companion joins over the live transport and claims seat 2 ---
    const comp = await compCtx.newPage();
    collect(comp, "comp", logs);
    await comp.goto(`${BASE}/companion?code=${code}`);
    await expect
      .poll(() => hasLog(logs, "companion joined"), {
        timeout: HANDSHAKE_TIMEOUT,
      })
      .toBe(true);

    await expect(comp.getByText(/claim a player/i)).toBeVisible({
      timeout: HANDSHAKE_TIMEOUT,
    });
    await comp.locator('[class*="claimRow"]').nth(1).click();

    // The companion holds the active seat → it gets the seize action.
    const seize = comp.getByRole("button", { name: /Seize the Initiative/i });
    await expect(seize).toBeVisible({ timeout: 15_000 });
    await seize.click();

    // Live round-trip: SEIZE travels companion → host over Trystero, the
    // host validates + dispatches, and the echoed STATE flips canSeize
    // false — so the companion's button disappears.
    await expect(seize).toBeHidden({ timeout: 15_000 });

    // Close the round on the host: because Player 2 seized, the lead
    // auto-advances to it with NO round-end picker.
    await ring.press("Enter");
    await expect(
      host.getByRole("alertdialog", { name: /Who took the initiative/i }),
    ).toBeHidden();
    await expect(banner).toContainText("Player 2");
  } finally {
    const relevant = logs.filter((l) =>
      /peer-trystero|peer\]|state\]|nostr|relay|websocket|PAGEERROR|RTC|ICE|SEIZE|seiz|STATE|REQUEST|reconnect/i.test(
        l,
      ),
    );
    console.log(`\n===== TRANSPORT LOGS =====\n${relevant.join("\n")}`);
    await hostCtx.close().catch(() => {});
    await compCtx.close().catch(() => {});
  }
});
