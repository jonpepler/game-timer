/*
 * Arcs UI regressions: layout, picker sizing, player colours and
 * setup-step exclusivity. Each describe block pins one reported issue
 * at both a phone and a desktop viewport.
 */
import { test, expect, type Page } from "@playwright/test";
import { navigateToScreen } from "./_setup-helpers";
import {
  box,
  expectHeroRing,
  LAYOUT_VIEWPORTS,
  overlaps,
  ring,
  ringHitMisses,
  ringPageBox,
  visibleBox,
} from "./_layout-helpers";

const BASE = "/game-timer";

const activeBanner = (page: Page) => page.locator('[class*="activePlayer__"]');

const turnActions = (page: Page) =>
  page.getByRole("region", { name: "Turn actions" });

const seizeButton = (page: Page) =>
  turnActions(page).getByRole("button", { name: /Seize the Initiative/i });

/**
 * Walk the host through an Arcs setup with `seats` players and land on
 * the timer view, not yet running. Leader cards are activated with the
 * keyboard so this helper does not depend on the picker layout (that
 * is pinned separately below).
 */
async function startArcs(page: Page, seats: number) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");
  await navigateToScreen(page, /seat players/i);
  for (let i = 4; i > seats; i--) {
    await page.getByRole("button", { name: `Remove seat ${i}` }).click();
  }
  // Initiative starts with a random player; these checks assume Player 1.
  await navigateToScreen(page, /^Initiative$/);
  await page.getByRole("button", { name: "Player 1", exact: true }).click();
  await navigateToScreen(page, /^Leader$/);
  await page.getByRole("button", { name: /^Skip draft$/ }).click();
  const leaders = ["Elder", "Mystic", "Upstart", "Rebel"].slice(0, seats);
  for (const leader of leaders) {
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

for (const [vpName, device] of Object.entries(LAYOUT_VIEWPORTS)) {
  test.describe(`arcs ui (${vpName})`, () => {
    test.use(device);

    test("the seize control coming and going never moves the ring", async ({
      page,
    }) => {
      await startArcs(page, 4);
      // The region is declared from the start; the control is not
      // offered until the clock runs.
      await expect(turnActions(page)).toBeAttached();
      await expect(seizeButton(page)).toBeHidden();
      const before = await ringPageBox(page);
      await expectHeroRing(page);

      await ring(page).press("Enter");
      await expect(seizeButton(page)).toBeVisible();
      expect(await ringPageBox(page)).toEqual(before);

      // The control's content fits inside its own box.
      const clipped = await seizeButton(page).evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
      );
      expect(clipped).toBe(false);
      // It never sits over the ring.
      expect(
        overlaps(await box(seizeButton(page)), await box(ring(page))),
      ).toBe(false);

      // Pressing it records nothing and keeps the same player active.
      await seizeButton(page).click();
      await expect(seizeButton(page)).toBeHidden();
      await expect(activeBanner(page)).toContainText("Player 1");
      expect(await ringPageBox(page)).toEqual(before);
    });

    test("expanding the scores never resizes, moves or covers the ring", async ({
      page,
    }) => {
      await startArcs(page, 4);
      await ring(page).press("Enter");
      // The control only shows once the clock runs, so this proves the
      // press started it.
      await expect(seizeButton(page)).toBeVisible();
      const before = await ringPageBox(page);
      expect(await ringHitMisses(page)).toEqual([]);

      await page.getByRole("button", { name: /show other scores/i }).click();
      await expect(
        page.getByRole("group", { name: "Other player scores" }),
      ).toBeVisible();

      expect(await ringPageBox(page)).toEqual(before);
      /*
       * The expanded panel is taller than the bottom row, so it scrolls
       * there and its own box reaches up past the row. What can cover
       * the ring is the part the row shows.
       */
      const scores = await visibleBox(page.locator('[aria-label="Scores"]'));
      expect(overlaps(scores, await visibleBox(ring(page)))).toBe(false);
      // Every point of the ring's disc hit-tests to the ring itself.
      expect(await ringHitMisses(page)).toEqual([]);

      // Score buttons never count as a turn.
      await page
        .getByRole("button", { name: /Increase score for Player 2/i })
        .first()
        .click();
      await expect(activeBanner(page)).toContainText("Player 1");

      // Real pointer taps anywhere on the disc advance the turn.
      await ring(page).scrollIntoViewIfNeeded();
      const r = await box(ring(page));
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const tap = (x: number, y: number) =>
        device === LAYOUT_VIEWPORTS.phone
          ? page.touchscreen.tap(x, y)
          : page.mouse.click(x, y);
      await tap(cx, cy + r.height * 0.4);
      await expect(activeBanner(page)).toContainText("Player 2");
      await tap(cx - r.width * 0.4, cy);
      await expect(activeBanner(page)).toContainText("Player 3");
    });

    test("leader picker shows full-size cards, not a squeezed row", async ({
      page,
    }) => {
      await page.goto(`${BASE}/timer`);
      await page.getByLabel(/^Game$/).selectOption("arcs");
      await navigateToScreen(page, /^Leader$/);

      for (const mode of ["draft", "full pool"] as const) {
        if (mode === "full pool") {
          await page.getByRole("button", { name: /^Skip draft$/ }).click();
        }
        // Let the staggered card entrance animation finish.
        await page.waitForTimeout(800);
        const cards = page.locator('[class*="heroCard__"]');
        const count = await cards.count();
        expect(count).toBeGreaterThan(1);
        const boxes = [];
        for (let i = 0; i < count; i++) boxes.push(await box(cards.nth(i)));
        for (const b of boxes) {
          // Readable minimum width, and the 5:7 card shape is kept.
          expect(b.width).toBeGreaterThanOrEqual(120);
          expect(b.height / b.width).toBeGreaterThan(1.3);
          expect(b.height / b.width).toBeLessThan(1.5);
        }
        // No two cards overlap.
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(overlaps(boxes[i], boxes[j])).toBe(false);
          }
        }
        // The last card is reachable and clickable with a real pointer.
        await cards.nth(count - 1).click();
        await expect(
          page.getByRole("button", { name: /^Confirm setup$/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: /^Back$/ })
          .first()
          .click();
      }
    });
  });
}

test.describe("arcs player colours", () => {
  test("each seat picks a colour and the timer uses it", async ({ page }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption("arcs");
    await navigateToScreen(page, /seat players/i);

    const seat1 = page.getByRole("radiogroup", { name: "Player 1 colour" });
    const seat2 = page.getByRole("radiogroup", { name: "Player 2 colour" });
    await expect(seat1).toBeVisible({ timeout: 3000 });
    // Seats start with distinct colours from the definition's palette.
    await expect(seat1.getByRole("radio", { name: "Red" })).toBeChecked();
    await expect(seat2.getByRole("radio", { name: "Blue" })).toBeChecked();
    await expect(seat1.getByRole("radio")).toHaveCount(5);
    await expect(seat1.getByRole("radio", { name: "Pink" })).toBeVisible();

    // Taking another seat's colour swaps the two, so colours stay unique.
    await seat1.getByRole("radio", { name: "Blue" }).click();
    await expect(seat1.getByRole("radio", { name: "Blue" })).toBeChecked();
    await expect(seat2.getByRole("radio", { name: "Red" })).toBeChecked();

    for (let i = 4; i > 2; i--) {
      await page.getByRole("button", { name: `Remove seat ${i}` }).click();
    }
    // Initiative starts with a random player; these checks assume Player 1.
    await navigateToScreen(page, /^Initiative$/);
    await page.getByRole("button", { name: "Player 1", exact: true }).click();
    await navigateToScreen(page, /^Leader$/);
    await page.getByRole("button", { name: /^Skip draft$/ }).click();
    for (const leader of ["Elder", "Mystic"]) {
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

    // Player 1 leads with the blue they picked; the leader stays as
    // the subheading.
    await expect(activeBanner(page)).toContainText("Player 1");
    await expect(activeBanner(page)).toContainText("Mystic");
    await expect(activeBanner(page)).toHaveCSS("color", "rgb(74, 139, 224)");
  });
});

/**
 * Walk every wizard screen for Arcs with the "Play with Leaders & Lore"
 * toggle set to `leadersLore` and the Leaders & Lore Pack module set to
 * `pack`, returning the screen labels in order plus all visible step text.
 */
async function walkArcsSteps(page: Page, leadersLore: boolean, pack = true) {
  await page.goto(`${BASE}/timer`);
  await page.getByLabel(/^Game$/).selectOption("arcs");
  const crumbs = page.locator('[class*="crumbs"]');
  const title = page.locator("#screen-title");
  const startBtn = page.getByRole("button", { name: /start game/i });
  const labels: string[] = [];
  let text = "";
  for (let i = 0; i < 20; i++) {
    const heading = ((await title.textContent()) ?? "").trim();
    if (heading === "Modules") {
      await page
        .getByRole("checkbox", { name: /^Leaders & Lore Pack/ })
        .setChecked(pack);
    }
    if (heading === "Initiative") {
      // Initiative starts with a random player; these checks assume Player 1.
      await page.getByRole("button", { name: "Player 1", exact: true }).click();
    }
    if (heading === "Play with Leaders & Lore") {
      await page
        .locator("dialog")
        .getByRole("checkbox")
        .setChecked(leadersLore);
    }
    const crumb = (await crumbs.textContent()) ?? "";
    labels.push(crumb.split("·").slice(1).join("·").trim());
    text += ` ${await page.locator("dialog").innerText()}`;
    if (await startBtn.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  return { labels, text };
}

test.describe("arcs leaders & lore setup steps", () => {
  test("with Leaders & Lore, only its setup steps show", async ({ page }) => {
    const { labels, text } = await walkArcsSteps(page, true);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Lay out Leaders & Lore",
        "Leader",
        "Set up your Leader",
      ]),
    );
    expect(labels).not.toContain("Place starting pieces");
    // The core placement instructions conflict with the Leader card's
    // own placement, so they must not appear anywhere in this flow.
    expect(text).not.toMatch(/starting ships, city, and starport/i);
  });

  test("without Leaders & Lore, the core setup shows instead", async ({
    page,
  }) => {
    const { labels } = await walkArcsSteps(page, false, false);
    expect(labels).toContain("Place starting pieces");
    for (const hidden of [
      "Lay out Leaders & Lore",
      "Leader",
      "Set up your Leader",
    ]) {
      expect(labels).not.toContain(hidden);
    }
  });

  test("the Pack with Leaders & Lore off is harmless", async ({ page }) => {
    const { labels } = await walkArcsSteps(page, false, true);
    expect(labels).toContain("Place starting pieces");
    for (const hidden of [
      "Lay out Leaders & Lore",
      "Leader",
      "Set up your Leader",
    ]) {
      expect(labels).not.toContain(hidden);
    }
  });

  test("without Leaders & Lore, players still get distinct colours", async ({
    page,
  }) => {
    await walkArcsSteps(page, false);
    await page.getByRole("button", { name: /start game/i }).click();
    await expect(page.getByText(/turns left/i)).toBeVisible();
    // Seat 1 defaults to red and no leader subheading is shown.
    await expect(activeBanner(page)).toHaveCSS("color", "rgb(226, 90, 68)");
  });
});
