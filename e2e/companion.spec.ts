import { test, expect } from "@playwright/test";

const BASE = "/game-timer";

// The full host↔companion handshake involves the public peerjs broker
// and is intentionally not exercised here (flaky network dep). These
// tests verify the page wiring: routing, query-param parsing, status
// surfaces.

test.describe("companion route", () => {
  test("missing host code surfaces a code-entry form", async ({ page }) => {
    await page.goto(`${BASE}/companion`);
    await expect(
      page.getByText(/enter the session code below/i),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /session code/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Connect$/ }),
    ).toBeVisible();
  });

  test("with a host code, surfaces the Connecting status", async ({ page }) => {
    await page.goto(`${BASE}/companion?code=fake-host`);
    // The attempt fails because there's no real host, but we should
    // first see the connecting state.
    await expect(page.getByText(/connecting to/i)).toBeVisible();
    await expect(page.getByText(/fake-host/)).toBeVisible();
  });
});
