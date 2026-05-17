import { test, expect } from "@playwright/test";

const BASE = "/game-timer";

// The full host↔companion handshake involves the public peerjs broker
// and is intentionally not exercised here (flaky network dep). These
// tests verify the page wiring: routing, query-param parsing, status
// surfaces.

test.describe("companion route", () => {
  test("missing host code shows an instructional error", async ({ page }) => {
    await page.goto(`${BASE}/companion`);
    await expect(page.getByText(/no host code in the url/i)).toBeVisible();
  });

  test("with a host code, surfaces the Connecting status", async ({ page }) => {
    await page.goto(`${BASE}/companion?code=fake-host`);
    // The attempt fails because there's no real host, but we should
    // first see the connecting state.
    await expect(page.getByText(/connecting to/i)).toBeVisible();
    await expect(page.getByText(/fake-host/)).toBeVisible();
  });
});
