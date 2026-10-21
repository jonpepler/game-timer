import { expect, type Page, test } from "@playwright/test";
import {
  box,
  expectFullyInViewport,
  expectHeroRing,
  expectNoHorizontalOverflow,
  LAYOUT_VIEWPORTS,
  overlaps,
  ring,
  ringHitMisses,
  ringPageBox,
} from "./_layout-helpers";
import { navigateToScreen, startGame } from "./_setup-helpers";

/*
 * Timer page layout invariants, per viewport: the ring is the hero,
 * the panels around it never resize, move or cover it, taps on panels
 * never advance a turn, and a phone never scrolls sideways.
 */

const BASE = "/game-timer";

const banner = (page: Page) => page.locator('[class*="activePlayer__"]');

async function startRailways(page: Page) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("railways");
  await navigateToScreen(page, /^Priority$/);
  await page.getByRole("button", { name: "Player 2", exact: true }).click();
  await page.getByRole("button", { name: /start game/i }).click();
  await expect(page.getByRole("button", { name: /^End / })).toBeVisible({
    timeout: 15_000,
  });
}

async function startArcs(page: Page) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  for (const leader of ["Elder", "Mystic", "Upstart", "Rebel"]) {
    await page
      .getByRole("button", { name: leader, exact: true })
      .press("Enter");
    await page.getByRole("button", { name: /^Confirm setup$/ }).click();
  }
  const startBtn = page.getByRole("button", { name: /start game/i });
  for (let i = 0; i < 6; i++) {
    if (await startBtn.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await startBtn.click();
  await expect(page.getByText(/turns left/i)).toBeVisible({ timeout: 15_000 });
}

const GAMES: Record<string, (page: Page) => Promise<void>> = {
  generic: (page) => startGame(page, { trackPlayers: true, playerCount: 4 }),
  arcs: startArcs,
  root: (page) =>
    startGame(page, {
      game: "root",
      playerCount: 3,
      factions: ["Marquise de Cat", "Eyrie Dynasties", "Woodland Alliance"],
    }),
  railways: startRailways,
};

for (const [vpName, device] of Object.entries(LAYOUT_VIEWPORTS)) {
  test.describe(`layout (${vpName})`, () => {
    test.use(device);

    test("generic: the ring is the hero and panels never advance a turn", async ({
      page,
    }) => {
      await startGame(page, { trackPlayers: true, playerCount: 3 });
      await expectHeroRing(page);
      expect(await ringHitMisses(page)).toEqual([]);
      const before = await ringPageBox(page);

      await ring(page).press("Enter"); // start
      // A turn needs a whole second on the clock to show in time share.
      await page.waitForTimeout(1100);
      await ring(page).press("Enter"); // Player 1's turn recorded
      await expect(banner(page)).toContainText("Player 2");
      // The time-share bar appearing after the first turn moves nothing.
      await expect(page.getByText(/time share/i).first()).toBeVisible();
      expect(await ringPageBox(page)).toEqual(before);

      // Panels and the footer swallow their own taps.
      await page.getByRole("button", { name: /pause timer/i }).click();
      await page.getByRole("button", { name: /resume timer/i }).click();
      await page
        .getByText(/time share/i)
        .first()
        .click();
      await expect(banner(page)).toContainText("Player 2");
    });

    test("arcs: the scores sit above the time share, both under the ring and full width", async ({
      page,
    }) => {
      await startArcs(page);
      // The seize control only shows once the clock runs. A press landing
      // as the wizard closes is sometimes dropped, so press again if so.
      await expect(async () => {
        await ring(page).press("Enter");
        await expect(
          page.getByRole("button", { name: /Seize the Initiative/i }),
        ).toBeVisible({ timeout: 1000 });
      }).toPass();
      // A turn needs a whole second on the clock to show in time share.
      await page.waitForTimeout(1500);
      await ring(page).press("Enter");
      const timeShare = page.getByLabel("Time share by player");
      await expect(timeShare).toBeVisible();
      await ring(page).scrollIntoViewIfNeeded();

      const r = await ringPageBox(page);
      /*
       * The panel, not its content: on a short wide screen the bottom row
       * is a fixed height and taller scores scroll inside it.
       */
      const scores = await box(
        page.locator('[data-panel="scores"]', {
          has: page.getByLabel("Scores", { exact: true }),
        }),
      );
      const share = await box(timeShare);
      expect(scores.y + scores.height).toBeLessThanOrEqual(share.y);
      // Page coordinates, so a scrolled phone page compares too.
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scores.y + scrollY).toBeGreaterThanOrEqual(r.y + r.height);
      const width = page.viewportSize()?.width ?? 0;
      const gutters = width >= 1024 ? 48 : 32;
      for (const panel of [scores, share]) {
        expect(panel.width).toBeGreaterThanOrEqual(width - gutters - 1);
      }
    });

    test("railways: the ring keeps its size and place as the turn order and rounds change", async ({
      page,
    }) => {
      await startRailways(page);
      await ring(page).press("Enter");
      const before = await ringPageBox(page);
      const phase = page.getByRole("button", { name: /^End / });
      expect(overlaps(await box(phase), await box(ring(page)))).toBe(false);

      // The turn order is always open, with nothing to hide it: in the
      // right column on a wide screen, in the page's flow on a phone.
      const list = page.getByRole("list", { name: "Players" });
      await expect(list).toBeVisible();
      expect(overlaps(await box(list), await box(ring(page)))).toBe(false);
      expect(await ringHitMisses(page)).toEqual([]);
      await expect(
        page.getByRole("button", { name: /^(Show|Hide) turn order$/ }),
      ).toHaveCount(0);
      const width = page.viewportSize()?.width ?? 0;
      if (width >= 1024) {
        await expect(
          page.locator('[data-column="right"]').getByRole("region", {
            name: "Turn order",
          }),
        ).toBeVisible();
        const r = await box(ring(page));
        expect((await box(list)).x).toBeGreaterThanOrEqual(r.x + r.width);
      }

      // The list's tab switch is not a turn.
      await page
        .getByRole("button", { name: "Companies", exact: true })
        .click();
      await expect(banner(page)).toContainText("Player 2");

      // A new round, with different panels, leaves the ring alone.
      await page.getByRole("button", { name: "End Stock Round" }).click();
      const prompt = page.getByRole("alertdialog");
      await prompt
        .getByRole("button", { name: "Player 3", exact: true })
        .click();
      await prompt
        .getByRole("button", { name: "Operating Round", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "End Operating Round" }),
      ).toBeVisible();
      expect(await ringPageBox(page)).toEqual(before);
    });

    if (vpName === "phone") {
      test("phone: the whole page scrolls, the ring keeps its size and a readout takes over", async ({
        page,
      }) => {
        // A short phone, so the panels run well past the screen.
        await page.setViewportSize({ width: 390, height: 560 });
        await startRailways(page);
        await ring(page).press("Enter");
        const before = await ringPageBox(page);
        const readout = page.getByRole("timer", { name: "Turn time" });
        await expect(readout).toBeHidden();
        const scrollable = await page.evaluate(
          () => document.documentElement.scrollHeight > window.innerHeight,
        );
        expect(scrollable).toBe(true);
        await page.mouse.wheel(0, 2000);
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBeGreaterThan(0);
        // The ring scrolls with the page, at the same size and place on it.
        expect(await ringPageBox(page)).toEqual(before);
        await expect(readout).toBeVisible();
        await expect(readout).toContainText("Player 2’s turn");
        await expect(readout).toContainText(/\d\d:\d\d/);
        // The footer is pinned and the last panel clears it.
        const pause = page.getByRole("button", { name: /pause timer/i });
        await expectFullyInViewport(pause);
        const footerTop = (await box(page.locator('footer[class*="Footer_"]')))
          .y;
        const lastPanel = page.locator("[data-panel]").last();
        const last = await box(lastPanel);
        expect(last.y + last.height).toBeLessThanOrEqual(footerTop);

        await page.mouse.wheel(0, -4000);
        await expect(readout).toBeHidden();
        // The round's button keeps its whole label beside the round's name.
        const end = page.getByRole("button", { name: "End Stock Round" });
        expect(
          await end.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
      });

      for (const [game, start] of Object.entries(GAMES)) {
        test(`${game}: no horizontal overflow at 390px`, async ({ page }) => {
          await start(page);
          await ring(page).press("Enter");
          await ring(page).press("Enter");
          await expectNoHorizontalOverflow(page);
          await expectFullyInViewport(
            page.getByRole("button", { name: /debug/i }).first(),
          );
          const endsAt = page.getByText(/ends at/i);
          if (await endsAt.count()) await expectFullyInViewport(endsAt);
          const show = page.getByRole("button", {
            name: /^Show (other scores|turn order)$/,
          });
          if (await show.count()) {
            await show.first().click();
            await expectNoHorizontalOverflow(page);
          }
        });
      }
    }
  });
}

test.describe("the ring never overlaps the turn title", () => {
  for (const width of [320, 390, 480, 600, 768, 1024, 1280, 1440, 1920, 2560]) {
    test(`at ${width}px wide`, async ({ page }) => {
      const height = width < 1024 ? 800 : Math.round((width * 9) / 16);
      await page.setViewportSize({ width, height });
      await startGame(page, { trackPlayers: true, playerCount: 3 });
      const title = await box(banner(page));
      const r = await box(ring(page));
      expect(title.y + title.height).toBeLessThanOrEqual(r.y + 0.5);
    });
  }
});

test.describe("wizard on a phone", () => {
  test.use(LAYOUT_VIEWPORTS.phone);

  test("the wizard card and its Next button fit the screen", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("arcs");
    for (let i = 0; i < 3; i++) {
      const next = page.getByRole("button", { name: /^Next/ });
      await expectFullyInViewport(next);
      await expectFullyInViewport(page.locator("dialog form"));
      await expectNoHorizontalOverflow(page);
      await next.click();
    }
  });
});

test.describe("a short wide screen", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  for (const game of ["root", "arcs"] as const) {
    test(`${game}: the collapsed scores fit the bottom row without scrolling`, async ({
      page,
    }) => {
      await GAMES[game](page);
      await ring(page).press("Enter");
      await page.waitForTimeout(1500);
      await ring(page).press("Enter");
      const timeShare = page.getByLabel("Time share by player");
      await expect(timeShare).toBeVisible();

      const scores = page.locator('[data-panel="scores"]');
      const overflow = await scores.evaluate(
        (el) => el.scrollHeight - el.clientHeight,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expectFullyInViewport(
        page.getByRole("button", { name: "Show other scores" }),
      );
      await expectFullyInViewport(page.locator('[aria-label="Scores"]'));
      await expectFullyInViewport(timeShare);
      expect(overlaps(await box(scores), await box(ring(page)))).toBe(false);
    });
  }
});
