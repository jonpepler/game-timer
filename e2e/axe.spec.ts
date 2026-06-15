import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";

/*
 * Real-browser accessibility checks. Unlike the jsdom jest-axe tests,
 * these run in Chromium with real layout + computed styles, so axe can
 * evaluate colour-contrast and other style-dependent rules — the gap
 * that let the unreadable connect button (undefined --color-accent /
 * --color-text-inverse tokens) slip through.
 *
 * Scoped to colour-contrast on purpose: it's the regression class we
 * care about here and keeps the gate stable. Broaden the rule set later
 * as other a11y debt (e.g. clickable-div key handlers) gets addressed.
 */
const BASE = "/game-timer";

const contrastScan = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();

test.describe("accessibility — colour contrast (real browser)", () => {
  test.beforeEach(async ({ context }) => {
    // Use the fake peer factory so the timer's share panel opens without
    // touching the network; irrelevant to companion code-entry but cheap.
    await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
  });

  test("companion code-entry screen", async ({ page }) => {
    await page.goto(`${BASE}/companion`);
    await expect(page.getByRole("button", { name: /^Connect$/ })).toBeVisible();
    const { violations } = await contrastScan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("timer setup wizard", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    // Wizard auto-opens on mount.
    await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible({
      timeout: 5000,
    });
    const { violations } = await contrastScan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
