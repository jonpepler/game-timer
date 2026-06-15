import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/*
 * LIVE transport check — intentionally does NOT inject the
 * BroadcastChannel fake, so it drives the real selected transport
 * (Trystero when the dev server runs with NEXT_PUBLIC_USE_TRYSTERO=true)
 * over real public Nostr relays. Not part of the normal suite.
 *
 *   NEXT_PUBLIC_USE_TRYSTERO=true npm run dev   # (separate terminal)
 *   npx playwright test e2e/trystero-live.spec.ts
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
    console.log("\n===== TRANSPORT LOGS =====\n" + relevant.join("\n"));
    await hostCtx.close().catch(() => {});
    await compCtx.close().catch(() => {});
    if (comp2Ctx) await comp2Ctx.close().catch(() => {});
  }
});
