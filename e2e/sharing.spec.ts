import { test, expect } from "@playwright/test";

const BASE = "/game-timer";

// We don't exercise the actual peer broker handshake from e2e — the
// public broker is a flaky network dependency that doesn't belong in
// the deterministic test path. These tests just prove the UI is wired
// up correctly through the visible-state transitions.

test.describe("share session menu", () => {
  test("Share button is rendered in the top-left chrome after game start", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByRole("button", { name: /start game/i }).click();
    await expect(
      page.getByRole("button", { name: /share this session/i }),
    ).toBeVisible();
  });

  test("clicking Share transitions to an opening state", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByRole("button", { name: /start game/i }).click();
    await page
      .getByRole("button", { name: /share this session/i })
      .click();
    // We can't assert on broker success without leaving the test
    // hermetic, but the button must at minimum disappear once clicked
    // (replaced by an opening/open/error state).
    await expect(
      page.getByRole("button", { name: /share this session/i }),
    ).toHaveCount(0);
  });
});
