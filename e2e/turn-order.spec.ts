import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { navigateToScreen, startGame } from "./_setup-helpers";

/*
 * Variable turn order: dragging rows in the expanded score view changes
 * who goes next, on desktop (mouse) and phone (touch), and never counts
 * as a tap-to-advance. Set TURN_ORDER_EVIDENCE_DIR to also save the
 * screenshots used for review.
 */

test.use({ video: "on" });

const EVIDENCE_DIR = process.env.TURN_ORDER_EVIDENCE_DIR;

const snap = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
};

const tapToAdvance = (page: Page) =>
  page.getByRole("button", { name: "Advance turn" }).click();

const turnBanner = (page: Page, name: string) =>
  page.getByText(new RegExp(`^${name}’s turn$`));

const rowOf = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Turn order" })
    .getByRole("listitem")
    .filter({ hasText: name });

const handleOf = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^Reorder ${name},`) });

const rowNames = async (page: Page) =>
  page
    .getByRole("list", { name: "Turn order" })
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map(
        (li) => li.querySelector("[class*='nameText']")?.textContent ?? "",
      ),
    );

const centreOf = async (page: Page, locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

// Start a 4-player variable-order game and play one turn, so Player 2
// is up and Player 3 is next.
const setUp = async (page: Page) => {
  await startGame(page, {
    trackPlayers: true,
    playerCount: 4,
    variableTurnOrder: true,
  });
  await tapToAdvance(page); // starts the clock
  await tapToAdvance(page); // Player 1's turn recorded
  await expect(turnBanner(page, "Player 2")).toBeVisible();
  // The turn order is always open.
  await expect(page.getByRole("region", { name: "Turn order" })).toBeVisible();
  await expect(rowOf(page, "Player 2")).toHaveAttribute("aria-current", "step");
  // Next is the row after the active one.
  await expect
    .poll(() => rowNames(page))
    .toEqual(["Player 1", "Player 2", "Player 3", "Player 4"]);
};

// Player 4 dragged above Player 3 must be next, and nothing advanced.
const expectReordered = async (page: Page) => {
  await expect
    .poll(() => rowNames(page))
    .toEqual(["Player 1", "Player 2", "Player 4", "Player 3"]);
  await expect(turnBanner(page, "Player 2")).toBeVisible();
  await expect(page.getByText(/89\s*turns left/i)).toBeVisible();
  await tapToAdvance(page);
  await expect(turnBanner(page, "Player 4")).toBeVisible();
  await tapToAdvance(page);
  await expect(turnBanner(page, "Player 3")).toBeVisible();
};

test.describe("variable turn order: desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the setup wizard offers the turn-order setting", async ({ page }) => {
    await page.goto("/game-timer/timer");
    await navigateToScreen(page, /Players \(optional\)/i);
    await expect(page.getByLabel(/^Fixed rotation/)).toBeHidden();
    await page.getByLabel(/track individual players/i).check();
    await expect(page.getByLabel(/^Fixed rotation/)).toBeChecked();
    await page.getByLabel(/^Variable \(reorder during play\)/).check();
    await snap(page, "wizard-turn-order-setting");
  });

  test("dragging a row with the mouse changes who goes next", async ({
    page,
  }) => {
    await setUp(page);
    await snap(page, "desktop-expanded-handles");
    // The list scrolls inside the bottom row; bring the last row up.
    await handleOf(page, "Player 4").scrollIntoViewIfNeeded();
    const from = await centreOf(page, handleOf(page, "Player 4"));
    const to = await centreOf(page, rowOf(page, "Player 3"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(from.x, to.y - 10, { steps: 5 });
    await snap(page, "desktop-mid-drag");
    await page.mouse.up();
    await expectReordered(page);
  });

  test("a drag released where it started changes nothing", async ({ page }) => {
    await setUp(page);
    const from = await centreOf(page, handleOf(page, "Player 3"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 8, { steps: 3 });
    await page.mouse.up();
    expect(await rowNames(page)).toEqual([
      "Player 1",
      "Player 2",
      "Player 3",
      "Player 4",
    ]);
    await expect(turnBanner(page, "Player 2")).toBeVisible();
  });

  test("the expanded turn order passes axe contrast and list checks", async ({
    page,
  }) => {
    await setUp(page);
    const { violations } = await new AxeBuilder({ page })
      .include("[aria-label='Turn order']")
      .withRules([
        "color-contrast",
        "list",
        "listitem",
        "button-name",
        "aria-allowed-attr",
      ])
      .analyze();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("keyboard reordering on the handle", async ({ page }) => {
    await setUp(page);
    await handleOf(page, "Player 4").focus();
    await page.keyboard.press("ArrowUp");
    // Scoped by text: the share menu has its own transient status.
    await expect(
      page.getByRole("status").filter({ hasText: "moved to position" }),
    ).toContainText("Player 4 moved to position 3 of 4. Next up: Player 4.");
    await expectReordered(page);
  });

  test("undo after a reorder restores the order of the undone turn", async ({
    page,
  }) => {
    await setUp(page);
    await handleOf(page, "Player 4").focus();
    await page.keyboard.press("ArrowUp");
    await tapToAdvance(page); // Player 2's turn recorded, Player 4 up
    await expect(turnBanner(page, "Player 4")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(turnBanner(page, "Player 2")).toBeVisible();
    await expect
      .poll(() => rowNames(page))
      .toEqual(["Player 1", "Player 2", "Player 4", "Player 3"]);
  });
});

test.describe("variable turn order: phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("dragging a row by touch changes who goes next", async ({ page }) => {
    await setUp(page);
    // The list flows below the ring on a phone; bring it on screen.
    await rowOf(page, "Player 4").scrollIntoViewIfNeeded();
    await snap(page, "phone-expanded-handles");
    const from = await centreOf(page, handleOf(page, "Player 4"));
    const to = await centreOf(page, rowOf(page, "Player 3"));
    // Real touch input through CDP, so the browser derives pointer
    // events (pointerType "touch") the way a phone would.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: from.x, y }],
      });
    await touch("touchStart", from.y);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", from.y + ((to.y - 10 - from.y) * i) / steps);
      if (i === steps / 2) await snap(page, "phone-mid-drag");
    }
    await touch("touchEnd", to.y - 10);
    await expectReordered(page);
  });
});
