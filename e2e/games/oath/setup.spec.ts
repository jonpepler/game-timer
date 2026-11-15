import { expect, test } from "@playwright/test";
import { DEVICES, openOathSetup, press } from "./oath.helpers";

/*
 * Oath: New Foundations, seating: RB p2 (seven player boards; pawns in
 * seven player colours plus the Empire's purple).
 */

for (const [device, use] of DEVICES) {
  test.describe(`Oath setup (${device})`, () => {
    test.use(use);

    test("RB p2: up to seven players can be seated", async ({ page }) => {
      await openOathSetup(page);
      const add = page.getByRole("button", { name: /add seat/i });
      const seats = page.getByLabel(/^Seat \d+ name$/);
      while ((await seats.count()) < 7) await press(page, add);
      await expect(seats).toHaveCount(7);
      await expect(add).toBeDisabled();
    });
  });
}
