import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { DEVICES, endTurn, expectTurn, press, startOath } from "./oath.helpers";

/*
 * The Oath theme: each role plays on its own board's ground (the
 * Chancellor's plum, the Citizens' violet, the Exiles' ochre), in the
 * dark scheme by default and the light one on request. Every ground
 * keeps the page readable.
 */

const expectNoContrastViolations = (page: Page) =>
  expect
    .poll(
      async () =>
        (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
          .violations,
      { timeout: 5_000 },
    )
    .toEqual([]);

const ground = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.ground ?? null);

/** One turn on each role's ground, checked for contrast. */
const walkGrounds = async (page: Page) => {
  await expectTurn(page, "Player 1");
  await expect.poll(() => ground(page)).toBe("chancellor");
  await expectNoContrastViolations(page);
  await endTurn(page);
  await expectTurn(page, "Player 2");
  await expect.poll(() => ground(page)).toBe("citizen");
  await expectNoContrastViolations(page);
  await endTurn(page);
  await expectTurn(page, "Player 3");
  await expect.poll(() => ground(page)).toBe("exile");
  await expectNoContrastViolations(page);
};

for (const [device, use] of DEVICES) {
  test.describe(`Oath theme (${device})`, () => {
    test.use({ ...use, colorScheme: "light" });

    test("every role's ground passes contrast, dark by default and light on request", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await startOath(page, {
        players: 3,
        chancellor: "Player 1",
        citizens: ["Player 2"],
      });
      await walkGrounds(page);

      await press(
        page,
        page.getByRole("button", { name: "Switch to light mode" }),
      );
      await endTurn(page);
      await walkGrounds(page);
    });
  });
}
