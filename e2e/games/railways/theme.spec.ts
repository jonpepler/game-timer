import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { startGame } from "../../_setup-helpers";
import {
  DEVICES,
  press,
  startRailways,
  startRailwaysWithCompanions,
} from "./railways.helpers";

/*
 * The Lost Atlas theme: paper and ink by day, navy cloth and foil by
 * night. It follows the device's scheme until the table picks one, and
 * reaches a seated phone through the host's game.
 */

const PAPER = "rgb(241, 231, 207)";
const CLOTH = "rgb(22, 33, 43)";
const DEFAULT_SURFACE = "rgb(0, 0, 0)";

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const expectBackground = (page: Page, colour: string) =>
  expect.poll(() => background(page)).toBe(colour);

const schemeSwitch = (page: Page) =>
  page.getByRole("button", { name: /^Switch to (light|dark) mode$/ });

const contrastViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
    .violations;

/** Polled, so controls still easing between schemes settle first. */
const expectNoContrastViolations = (page: Page) =>
  expect.poll(() => contrastViolations(page), { timeout: 5_000 }).toEqual([]);

for (const [device, use] of DEVICES) {
  test.describe(`Lost Atlas theme (${device})`, () => {
    test.use({ ...use, colorScheme: "light" });

    test("picking the game in setup dresses the page in paper, and the scheme switch waits until setup closes", async ({
      page,
    }) => {
      await page.goto("/game-timer/timer");
      await expectBackground(page, DEFAULT_SURFACE);
      await page.getByLabel(/^Game$/).selectOption("railways");
      await expectBackground(page, PAPER);
      await expect(schemeSwitch(page)).toHaveCount(0);
      await expectNoContrastViolations(page);
    });

    test("the table switches between paper and cloth, and the choice holds after a reload", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await startRailways(page);
      await expectBackground(page, PAPER);
      await expectNoContrastViolations(page);

      await press(
        page,
        page.getByRole("button", { name: "Switch to dark mode" }),
      );
      await expectBackground(page, CLOTH);
      await expectNoContrastViolations(page);

      await page.reload();
      await expectBackground(page, CLOTH);
      await expect(
        page.getByRole("button", { name: "Switch to light mode" }),
      ).toBeVisible();
    });

    test("cancelling a new setup for this game keeps the running game's look", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await startGame(page);
      await expectBackground(page, DEFAULT_SURFACE);
      await press(page, page.getByRole("button", { name: "Start a new game" }));
      await page.getByLabel(/^Game$/).selectOption("railways");
      await expectBackground(page, PAPER);
      await press(page, page.getByRole("button", { name: /^Cancel$/ }));
      await expectBackground(page, DEFAULT_SURFACE);
      await expect(schemeSwitch(page)).toHaveCount(0);
    });
  });
}

test.describe("Lost Atlas on a seated phone", () => {
  test.use({ colorScheme: "dark", hasTouch: true });

  test("the phone takes the host's game theme and its own scheme", async ({
    context,
  }) => {
    test.setTimeout(120_000);
    const { host, phones } = await startRailwaysWithCompanions(context, {
      seats: [1],
    });
    const phone = phones[1];
    await expectBackground(host, CLOTH);
    await expectBackground(phone, CLOTH);
    await expectNoContrastViolations(phone);

    await press(
      phone,
      phone.getByRole("button", { name: "Switch to light mode" }),
    );
    await expectBackground(phone, PAPER);
    await expectNoContrastViolations(phone);
  });
});
