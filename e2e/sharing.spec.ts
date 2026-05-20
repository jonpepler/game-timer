import { test, expect } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";

const BASE = "/game-timer";

// We don't exercise the real PeerJS broker from e2e — it's a flaky
// network dependency. Instead, every test in this file installs the
// BroadcastChannel-based fake peer factory so the share session
// opens instantly and the UI transitions are deterministic.

test.describe("share session menu", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
  });

  test("share session auto-opens when the setup wizard mounts", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    // Wizard auto-opens on first mount AND auto-fires sessionHost.open()
    // so the SharePanel can render alongside the first screen. The
    // chrome's Share button is therefore never in idle state — it
    // jumps straight to the "open" chip showing the session code.
    await expect(
      page.getByRole("button", { name: /^Sharing session / }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("button", { name: /^Share this session$/i }),
    ).toHaveCount(0);
  });

  test("user can opt out of sharing via Stop sharing in the side panel", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    // The SharePanel renders alongside the Game-picker screen and
    // exposes a Stop sharing button once the session is open.
    await page
      .getByRole("button", { name: /^Stop sharing$/ })
      .click({ timeout: 5000 });
    // After Stop, dismissing the wizard surfaces the idle "Share
    // this session" button in the chrome so the user can opt back in.
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(
      page.getByRole("button", { name: /^Share this session$/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});
