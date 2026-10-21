import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";
import { expectCompanies } from "./games/railways/railways.helpers";

/*
 * Railways of the Lost Atlas: a Stock Round of player turns ended from
 * the phase bar (priority, then the next round kind), companies founded
 * with a share price and president, an Operating Round in share-price
 * order with a price move after each company, a merge with the name
 * swap, and the share price chart. Runs on a phone (touch) and on
 * desktop (mouse). Set RAILWAYS_EVIDENCE_DIR to also save screenshots
 * and the walkthrough video for review.
 */

const EVIDENCE_DIR = process.env.RAILWAYS_EVIDENCE_DIR;

// Slowed down when recording evidence so the video can be followed.
test.use({
  video: "on",
  launchOptions: { slowMo: EVIDENCE_DIR ? 250 : 0 },
});

const prefixFor = (page: Page) =>
  (page.viewportSize()?.width ?? 0) < 600 ? "phone" : "desktop";

const snap = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  // Let entrance animations settle so overlays are captured at rest.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${prefixFor(page)}-${name}.png`),
  });
};

const ring = (page: Page) => page.getByRole("button", { name: "Advance turn" });

// Tap the top of the ring, where a hand reaches first.
const tapRing = async (page: Page) => {
  const box = await ring(page).boundingBox();
  if (!box) throw new Error("ring not visible");
  await ring(page).click({ position: { x: box.width / 2, y: box.height / 5 } });
};

const banner = (page: Page, name: string) =>
  page.getByText(new RegExp(`^${name}’s turn$`));

const phaseStatus = (page: Page) =>
  page.getByRole("button", { name: /^End / }).locator("..");

const companies = (page: Page) => page.getByRole("list", { name: "Companies" });

/**
 * Walk the setup wizard: Railways, the chosen Landmarks modules, four
 * seats, Player 2 with priority.
 */
const startRailways = async (page: Page, landmarks: boolean) => {
  await page.goto("/game-timer/timer");
  await page.getByLabel(/^Game$/).selectOption("railways");
  await snap(page, "setup-01-game");
  await navigateToScreen(page, /^Modules$/);
  await expect(page.getByLabel("Base game")).toBeChecked();
  if (landmarks) {
    for (const module of [
      "Landmarks: Landmark tiles",
      "Landmarks: Metropolitan Transit Department",
      "Landmarks: Events",
    ]) {
      await page.getByLabel(module).check();
    }
  }
  await snap(page, "setup-02-modules");
  await navigateToScreen(page, /^Seat players$/i);
  await snap(page, "setup-03-seats");
  await navigateToScreen(page, /^Priority$/);
  await page.getByRole("button", { name: "Player 2", exact: true }).click();
  await snap(page, "setup-04-priority");
  await page.getByRole("button", { name: /start game/i }).click();
  await expect(
    page.getByRole("button", { name: "End Stock Round" }),
  ).toBeVisible({ timeout: 15_000 });
};

const openAddSheet = async (page: Page) => {
  await page.getByRole("button", { name: "Companies", exact: true }).click();
  await page.getByRole("button", { name: "Add to Companies" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to Companies" });
  await expect(sheet).toBeVisible();
  return sheet;
};

// Found a company from the open add sheet with its price and president.
const found = async (
  page: Page,
  name: string,
  price: number,
  president: string,
  shot?: string,
) => {
  await page
    .getByRole("dialog", { name: "Add to Companies" })
    .getByRole("button", { name: `Add ${name}` })
    .click();
  const details = page.getByRole("dialog", { name: `Add ${name}` });
  const confirm = details.getByRole("button", { name: `Add ${name}` });
  await expect(confirm).toBeDisabled();
  await details
    .getByRole("button", { name: String(price), exact: true })
    .click();
  await details.getByRole("button", { name: president, exact: true }).click();
  if (shot) await snap(page, shot);
  await confirm.click();
  await expect(details).toBeHidden();
};

// End the acting company's turn with a share price move.
const operate = async (page: Page, step: RegExp) => {
  await tapRing(page);
  const prompt = page.getByRole("dialog", { name: /^End .*’s turn$/ });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: step }).click();
  await expect(prompt).toBeHidden();
};

const walkthrough = async (page: Page) => {
  await startRailways(page, true);

  // Stock Round: the priority player opens; no turn budget, only the model's estimate, no cycle.
  await expect(phaseStatus(page)).toHaveText(/^Stock Round/);
  await expect(banner(page, "Player 2")).toBeVisible();
  await expect(page.getByText(/^\d+(\.5)? cycles? left$/)).toBeVisible();
  await snap(page, "sr-01-before-start");
  await tapRing(page); // starts the clock
  await tapRing(page); // Player 2 acted
  await expect(banner(page, "Player 3")).toBeVisible();
  await snap(page, "sr-02-player-turns");

  // Three companies launch: each needs a price and a president.
  await openAddSheet(page);
  await snap(page, "found-01-add-sheet");
  await found(page, "Northern Port", 80, "Player 1", "found-02-details");
  await found(page, "Agricultural", 80, "Player 2");
  await found(page, "Tunneling", 70, "Player 3");
  await page
    .getByRole("dialog", { name: "Add to Companies" })
    .getByRole("button", { name: "Done" })
    .click();
  // Equal prices stack in launch order.
  await expectCompanies(page, [
    "Northern Port 80",
    "Agricultural 80",
    "Tunneling 70",
  ]);
  // A value-ordered list has no drag handles.
  await expect(page.getByRole("button", { name: /^Reorder / })).toHaveCount(0);
  // Founding is not a turn.
  await expect(banner(page, "Player 3")).toBeVisible();
  await snap(page, "found-03-companies-listed");

  // End the Stock Round: priority first, then the next round kind.
  await page.getByRole("button", { name: "End Stock Round" }).click();
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName(
    "Who has priority now?",
  );
  await snap(page, "sr-03-who-has-priority");
  await page.getByRole("button", { name: "Player 4", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName(
    "End Stock Round?",
  );
  await expect(
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Operating Round", exact: true }),
  ).toBeFocused();
  await snap(page, "sr-04-next-round-kind");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Operating Round", exact: true })
    .click();

  // Operating Round: highest price first, president as the subheading.
  await expect(phaseStatus(page)).toHaveText(/^Operating Round/);
  await expect(banner(page, "Northern Port")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Whose turn" })
      .getByText("Player 1", { exact: true }),
  ).toBeVisible();
  await snap(page, "or-01-president-subheading");

  await tapRing(page);
  await expect(
    page.getByRole("dialog", { name: "End Northern Port’s turn" }),
  ).toBeVisible();
  await snap(page, "or-02-price-prompt");
  await page.getByRole("button", { name: "−1, Share price 70" }).click();
  await expectCompanies(page, [
    "Agricultural 80",
    "Tunneling 70",
    "Northern Port 70*",
  ]);
  await expect(banner(page, "Agricultural")).toBeVisible();
  await snap(page, "or-03-after-first-move");

  await operate(page, /^−1,/);
  // The bottom of the 70 stack, below the company that already played.
  await expectCompanies(page, [
    "Tunneling 70",
    "Northern Port 70*",
    "Agricultural 70*",
  ]);
  await expect(banner(page, "Tunneling")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Whose turn" })
      .getByText("Player 3", { exact: true }),
  ).toBeVisible();
  await snap(page, "or-04-muted-rows");

  await operate(page, /^\+2,/);
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName(
    "Operating Round complete",
  );
  // Two Operating Rounds in a row is the usual run.
  await expect(
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Operating Round", exact: true }),
  ).toBeFocused();
  await snap(page, "or-05-round-complete");

  // The table picks a Merger Round instead (an unforeseen event).
  await page.getByRole("button", { name: "Merger Round", exact: true }).click();
  await expect(phaseStatus(page)).toHaveText(/^Merger Round/);
  await expectCompanies(page, [
    "Tunneling 90",
    "Northern Port 70",
    "Agricultural 70",
  ]);

  // Merge Northern Port and Agricultural into a Union.
  await page.getByRole("button", { name: "Actions for Northern Port" }).click();
  await snap(page, "merge-01-actions");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  const merge = page.getByRole("dialog", { name: "Merge" });
  await merge.getByRole("button", { name: /^Agricultural/ }).click();
  await merge.getByRole("button", { name: "Next" }).click();
  await merge.getByRole("button", { name: "Union", exact: true }).click();
  await merge.getByRole("button", { name: "Player 2", exact: true }).click();
  await expect(
    merge.getByText("Northern Port Agricultural Union"),
  ).toBeVisible();
  await merge.getByRole("button", { name: "Swap name order" }).click();
  await expect(
    merge.getByText("Agricultural Northern Port Union"),
  ).toBeVisible();
  // The merged price defaults to the average, rounded down.
  await expect(
    merge.getByRole("button", { name: "70", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await snap(page, "merge-02-name-swap");
  await merge.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(merge).toBeHidden();
  await expectCompanies(page, [
    "Tunneling 90",
    "Agricultural Northern Port Union 70",
  ]);
  await snap(page, "merge-03-merged");

  // The share price chart sits where a score track would.
  await expect(page.getByTestId("value-history-chart")).toBeVisible();
  await expect(
    page.getByRole("figure", { name: "Share price over the game" }),
  ).toBeVisible();
  await page.getByTestId("value-history-chart").scrollIntoViewIfNeeded();
  await snap(page, "chart-01-share-prices");

  // An out-of-turn price change reorders at once.
  await page.getByRole("button", { name: /^Actions for Agricultural/ }).click();
  await page.getByRole("button", { name: "Up to 80" }).click();
  await expectCompanies(page, [
    "Tunneling 90",
    "Agricultural Northern Port Union 80",
  ]);
  // And undo takes it back.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectCompanies(page, [
    "Tunneling 90",
    "Agricultural Northern Port Union 70",
  ]);

  // End the Merger Round mid-turn: the next Stock Round starts from the
  // priority player chosen earlier.
  await page.getByRole("button", { name: "End Merger Round" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Stock Round", exact: true })
    .click();
  await expect(phaseStatus(page)).toHaveText(/^Stock Round/);
  await expect(banner(page, "Player 4")).toBeVisible();
  await snap(page, "sr-05-next-stock-round");
};

const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const desktop = { viewport: { width: 1280, height: 800 } };

const saveVideo = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  const video = page.video();
  await page.close();
  await video?.saveAs(path.join(EVIDENCE_DIR, `${name}.webm`));
};

for (const [name, device] of [
  ["phone", phone],
  ["desktop", desktop],
] as const) {
  test.describe(`railways: ${name}`, () => {
    test.use(device);

    test("stock round, founding, an operating round by share price, a merge, the chart", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await walkthrough(page);
      await saveVideo(page, `${name}-walkthrough`);
    });
  });
}

/**
 * End a company's turn, answer the price question, undo once: the same
 * company is acting again at its old price, unplayed, and ending its
 * turn asks the same question.
 */
const undoPriceAnswer = async (page: Page) => {
  await startRailways(page, false);
  await tapRing(page);
  await openAddSheet(page);
  await found(page, "Northern Port", 90, "Player 1");
  await found(page, "Tunneling", 70, "Player 3");
  await page
    .getByRole("dialog", { name: "Add to Companies" })
    .getByRole("button", { name: "Done" })
    .click();
  await page.getByRole("button", { name: "End Stock Round" }).click();
  await page.getByRole("button", { name: "Player 1", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Operating Round", exact: true })
    .click();
  await expect(banner(page, "Northern Port")).toBeVisible();
  await snap(page, "undo-01-before");

  await tapRing(page);
  const prompt = page.getByRole("dialog", { name: "End Northern Port’s turn" });
  await expect(prompt).toBeVisible();
  await expect(
    prompt.getByRole("heading", { name: "Share price change (increments)" }),
  ).toBeVisible();
  await snap(page, "undo-02-price-prompt");
  await prompt.getByRole("button", { name: "−1, Share price 80" }).click();
  await expect(banner(page, "Tunneling")).toBeVisible();
  await expectCompanies(page, ["Northern Port 80*", "Tunneling 70"]);
  await expect(
    page.getByRole("button", {
      name: "Actions for Northern Port, played this round",
    }),
  ).toBeVisible();
  await snap(page, "undo-03-answered");
  if (EVIDENCE_DIR)
    await companies(page).screenshot({
      path: path.join(EVIDENCE_DIR, `${prefixFor(page)}-played-rows.png`),
    });

  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(banner(page, "Northern Port")).toBeVisible();
  await expectCompanies(page, ["Northern Port 90", "Tunneling 70"]);
  await snap(page, "undo-04-undone");

  await tapRing(page);
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText(/Share price now/)).toHaveText(
    "Share price now 90",
  );
  await snap(page, "undo-05-asked-again");
  await prompt.getByRole("button", { name: "+1, Share price 100" }).click();
  await expect(banner(page, "Tunneling")).toBeVisible();
};

for (const [name, device] of [
  ["phone", phone],
  ["desktop", desktop],
] as const) {
  test.describe(`railways undo: ${name}`, () => {
    test.use(device);

    test("ending a turn and its price answer undo as one, and the question is asked again", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await undoPriceAnswer(page);
      await saveVideo(page, `${name}-undo-price-answer`);
    });
  });
}

test.describe("railways: prompts", () => {
  test.use(desktop);

  test("the Metropolitan joins at the highest price, above that column, with no questions", async ({
    page,
  }) => {
    await startRailways(page, true);
    await openAddSheet(page);
    await found(page, "Express", 90, "Player 2");
    await found(page, "Tunneling", 70, "Player 3");
    await page
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: /^Add Metropolitan/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: /^Add Metropolitan/ }),
    ).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: "Done" })
      .click();
    await expectCompanies(page, [
      "Metropolitan 90",
      "Express 90",
      "Tunneling 70",
    ]);
  });

  test("without Landmarks there is no Metropolitan, but every company is offered", async ({
    page,
  }) => {
    await startRailways(page, false);
    const sheet = await openAddSheet(page);
    await expect(
      sheet.getByRole("button", { name: "Add Tunneling" }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Add Twin Cities" }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Metropolitan/ }),
    ).toHaveCount(0);
  });

  test("the price prompt can be cancelled without ending the turn", async ({
    page,
  }) => {
    await startRailways(page, false);
    await tapRing(page);
    await openAddSheet(page);
    await found(page, "Suburban", 60, "Player 1");
    await page
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: "Done" })
      .click();
    await page.getByRole("button", { name: "End Stock Round" }).click();
    await page.getByRole("button", { name: "Player 1", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Operating Round", exact: true })
      .click();
    await tapRing(page);
    await page.getByRole("button", { name: "Keep playing" }).click();
    await expect(banner(page, "Suburban")).toBeVisible();
    await tapRing(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(banner(page, "Suburban")).toBeVisible();
  });

  test("the new dialogs pass axe checks", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startRailways(page, true);
    await tapRing(page);
    await openAddSheet(page);
    await page
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: "Add Express" })
      .click();
    const scan = async (selector: string) => {
      const result = await new AxeBuilder({ page }).include(selector).analyze();
      expect(result.violations, JSON.stringify(result.violations)).toEqual([]);
    };
    const details = page.getByRole("dialog", { name: "Add Express" });
    await expect(details).toBeVisible();
    await scan("[role='dialog']");
    await details.getByRole("button", { name: "90", exact: true }).click();
    await details
      .getByRole("button", { name: "Player 2", exact: true })
      .click();
    await details.getByRole("button", { name: "Add Express" }).click();
    await page
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: "Done" })
      .click();
    await page.getByRole("button", { name: "Actions for Express" }).click();
    await scan("[role='dialog']");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "End Stock Round" }).click();
    await page.getByRole("button", { name: "Player 1", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Operating Round", exact: true })
      .click();
    await tapRing(page);
    await scan("[role='dialog']");
  });
});

test.describe("railways: companion", () => {
  test.use(desktop);

  test("the president's companion ends the company's turn with a price move", async ({
    context,
  }) => {
    test.setTimeout(120_000);
    await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
    const host = await context.newPage();
    await host.goto("/game-timer/timer");
    const chip = host.getByRole("button", { name: /^Sharing session / });
    await chip.waitFor({ timeout: 10_000 });
    const code = /Sharing session (\S+),/.exec(
      (await chip.getAttribute("aria-label")) ?? "",
    )?.[1];
    if (!code) throw new Error("no session code");
    const companion = await context.newPage();
    await companion.goto(
      `/game-timer/companion?code=${encodeURIComponent(code)}`,
    );
    await expect(
      companion.getByText(new RegExp(`Connected to ${code}`)),
    ).toBeVisible({ timeout: 10_000 });

    await host.getByLabel(/^Game$/).selectOption("railways");
    await navigateToScreen(host, /^Seat players$/i);
    await expect(companion.getByText(/take a seat/i)).toBeVisible({
      timeout: 10_000,
    });
    await companion.getByRole("button", { name: /^Claim seat 1$/ }).click();
    await navigateToScreen(host, /^Priority$/);
    await host.getByRole("button", { name: "Player 2", exact: true }).click();
    await host.getByRole("button", { name: /start game/i }).click();
    await expect(
      host.getByRole("button", { name: "End Stock Round" }),
    ).toBeVisible({ timeout: 15_000 });

    await tapRing(host);
    await openAddSheet(host);
    await found(host, "Northern Port", 90, "Player 1");
    await found(host, "Express", 70, "Player 3");
    await host
      .getByRole("dialog", { name: "Add to Companies" })
      .getByRole("button", { name: "Done" })
      .click();
    await host.getByRole("button", { name: "End Stock Round" }).click();
    await host.getByRole("button", { name: "Player 1", exact: true }).click();
    await host
      .getByRole("alertdialog")
      .getByRole("button", { name: "Operating Round", exact: true })
      .click();
    await expect(banner(host, "Northern Port")).toBeVisible();

    // The companion holds seat 1, Northern Port's president.
    const end = companion.getByRole("button", {
      name: "End Northern Port’s turn",
    });
    await expect(end).toBeEnabled({ timeout: 10_000 });
    await end.click();
    const prompt = companion.getByRole("dialog", {
      name: "End Northern Port’s turn",
    });
    await expect(prompt).toBeVisible();
    if (EVIDENCE_DIR)
      await companion.screenshot({
        path: path.join(EVIDENCE_DIR, "companion-01-price-prompt.png"),
      });
    await prompt.getByRole("button", { name: "+1, Share price 100" }).click();

    await expect(banner(host, "Express")).toBeVisible({ timeout: 10_000 });
    await expectCompanies(host, ["Northern Port 100*", "Express 70"]);
    // Not the companion's company now.
    await expect(
      companion.getByRole("button", { name: "Waiting for your turn…" }),
    ).toBeDisabled({ timeout: 10_000 });
    if (EVIDENCE_DIR) {
      await host.screenshot({
        path: path.join(EVIDENCE_DIR, "companion-02-host-after.png"),
      });
      await companion.screenshot({
        path: path.join(EVIDENCE_DIR, "companion-03-companion-after.png"),
      });
    }
  });
});
