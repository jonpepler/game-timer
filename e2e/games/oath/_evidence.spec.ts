import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { navigateToScreen } from "../../_setup-helpers";
import {
  changeRole,
  DEVICES,
  endDiePrompt,
  endTurns,
  gameOverScreen,
  LABEL,
  openOathSetup,
  press,
  startOath,
} from "./oath.helpers";

/*
 * Review evidence for the Oath config, not a regression suite: screenshots
 * of each rule and interaction and a short walkthrough video, saved to
 * $OATH_EVIDENCE_DIR. Skipped unless that is set.
 */

const OUT = process.env.OATH_EVIDENCE_DIR;
test.skip(!OUT, "set OATH_EVIDENCE_DIR to capture evidence");
test.describe.configure({ timeout: 120_000 });

for (const [device, use] of DEVICES) {
  test.describe(`Oath evidence (${device})`, () => {
    test.use(use);

    // Sheets and banners animate in (the end screen's label lands at about
    // 1.25s); let them land before the capture.
    const shot = async (page: Page, name: string, fullPage = false) => {
      await page.waitForTimeout(1600);
      await page.screenshot({
        path: path.join(OUT ?? ".", `${name}-${device}.png`),
        fullPage,
      });
    };

    test("setup", async ({ page }) => {
      await openOathSetup(page);
      await shot(page, "01-seating");
      await navigateToScreen(page, /^Chancellor$/);
      await press(page, page.getByRole("button", { name: "Player 2" }));
      await shot(page, "02-chancellor");
      await navigateToScreen(page, /^Citizens$/);
      await press(page, page.getByRole("checkbox", { name: "Player 3" }));
      await shot(page, "03-citizens");
      await press(page, page.getByRole("button", { name: /^Back/ }));
      await press(page, page.getByRole("button", { name: "No Chancellor" }));
      await navigateToScreen(page, /^First player$/);
      await shot(page, "04-first-player");
    });

    test("play", async ({ browser }) => {
      const context = await browser.newContext({
        ...use,
        baseURL: test.info().project.use.baseURL,
        recordVideo: {
          dir: path.join(OUT ?? ".", "video"),
          size: use.viewport,
        },
      });
      const page = await context.newPage();
      await startOath(page, {
        players: 4,
        chancellor: "Player 1",
        citizens: ["Player 2"],
      });
      await shot(page, "05-chancellor-turn");
      await endTurns(page, 1);
      await shot(page, "06-citizen-turn");
      await endTurns(page, 1);
      await shot(page, "07-exile-turn");
      await press(
        page,
        page
          .getByRole("region", { name: "Turn actions" })
          .getByRole("button", { name: LABEL.changeRoles }),
      );
      await shot(page, "08-change-roles");
      await press(page, page.getByRole("button", { name: LABEL.done }));
      await changeRole(page, "Player 3", "Citizen");
      await shot(page, "09-after-role-change");
      await endTurns(page, 18);
      await expect(endDiePrompt(page, 5)).toBeVisible();
      await shot(page, "10-end-die-prompt");
      await press(
        page,
        endDiePrompt(page, 5).getByRole("button", {
          name: LABEL.chancellorWins,
        }),
      );
      await shot(page, "11-stable-regime");
      const video = page.video();
      await context.close();
      await video?.saveAs(path.join(OUT ?? ".", `walkthrough-${device}.webm`));
    });

    test("war exhaustion", async ({ page }) => {
      await startOath(page, { players: 2 });
      await endTurns(page, 14);
      await shot(page, "12-last-round");
      await endTurns(page, 2);
      await expect(gameOverScreen(page)).toBeVisible();
      await shot(page, "13-war-exhaustion");
    });

    test("light", async ({ page }) => {
      await startOath(page, { players: 4, chancellor: "Player 1" });
      await press(
        page,
        page.getByRole("button", { name: "Switch to light mode" }),
      );
      await shot(page, "14-light");
    });
  });
}
