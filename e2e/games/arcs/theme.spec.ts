import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { navigateToScreen, startGame } from "../../_setup-helpers";

/*
 * The Arcs theme: the neon night sky by default, whatever the device
 * prefers, because the seat colours were made for a dark board; the pale
 * violet page on request.
 */

const NIGHT = "rgb(12, 11, 23)";
const PAGE = "rgb(243, 241, 250)";
const DEFAULT_SURFACE = "rgb(0, 0, 0)";

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const expectBackground = (page: Page, colour: string) =>
  expect.poll(() => background(page)).toBe(colour);

const expectNoContrastViolations = (page: Page) =>
  expect
    .poll(
      async () =>
        (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
          .violations,
      { timeout: 5_000 },
    )
    .toEqual([]);

const tap = async (page: Page, name: string | RegExp) => {
  const target = page.getByRole("button", {
    name,
    exact: typeof name === "string",
  });
  if ((page.viewportSize()?.width ?? 0) < 600) await target.tap();
  else await target.click();
};

/** Walk the open wizard from its Game screen into a two-seat game. */
const setUpArcs = async (page: Page) => {
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /seat players/i);
  for (let i = 4; i > 2; i--) await tap(page, `Remove seat ${i}`);
  await navigateToScreen(page, /^Leader$/);
  await tap(page, /^Skip draft$/);
  for (const leader of ["Elder", "Mystic"]) {
    await page
      .getByRole("button", { name: leader, exact: true })
      .press("Enter");
    await tap(page, /^Confirm setup$/);
  }
  const start = page.getByRole("button", { name: /start game/i });
  for (let i = 0; i < 6; i++) {
    if (await start.isVisible().catch(() => false)) break;
    await tap(page, /^Next/);
  }
  await tap(page, /start game/i);
  await expect(page.getByText(/turns left/i)).toBeVisible({ timeout: 15_000 });
};

const devices = [
  [
    "phone",
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ],
  ["desktop", { viewport: { width: 1440, height: 900 } }],
] as const;

for (const [device, use] of devices) {
  test.describe(`Arcs theme (${device})`, () => {
    test.use({ ...use, colorScheme: "light" });

    test("a light device still opens on the dark night sky, and the table can switch to the rule page", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("/game-timer/timer");
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await expectBackground(page, NIGHT);
      await expect(
        page.getByRole("button", { name: /^Switch to (light|dark) mode$/ }),
      ).toHaveCount(0);

      await setUpArcs(page);
      await expectNoContrastViolations(page);
      await tap(page, "Switch to light mode");
      await expectBackground(page, PAGE);
      await expectNoContrastViolations(page);
    });

    test("cancelling a new setup for this game keeps the running game's look", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await startGame(page);
      await tap(page, "Start a new game");
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await expectBackground(page, NIGHT);
      await tap(page, /^Cancel$/);
      await expectBackground(page, DEFAULT_SURFACE);
    });
  });
}
