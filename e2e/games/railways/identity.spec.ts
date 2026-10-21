import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  chooseNextRound,
  DEVICES,
  endMergerTurn,
  endStockRound,
  endTurnWithPriceChange,
  expectCompanies,
  expectRoundComplete,
  expectTurn,
  foundCompanies,
  LABEL,
  openMerge,
  toMergeCheck,
  press,
  ROUND,
  startRailways,
  undo,
} from "./railways.helpers";

/*
 * Company identity: each company's token and typeface, and a merged
 * Corporation named after its two Minor Companies (rules p18, Diagram 9:
 * the two minor charters sit side by side under the corporation charter,
 * in the order the players choose). Set IDENTITY_EVIDENCE_DIR to save
 * screenshots and videos for review.
 */

const EVIDENCE_DIR = process.env.IDENTITY_EVIDENCE_DIR;
if (EVIDENCE_DIR) test.use({ video: "on", launchOptions: { slowMo: 150 } });

const METROPOLITAN = "Metropolitan";

/*
 * Two merges, a Merger Round and a Stock Round take longer than the 30s
 * default budget allows on a loaded machine.
 */
test.describe.configure({ timeout: 90_000 });

const snap = async (page: Page, name: string, target?: "banner" | "rows") => {
  if (!EVIDENCE_DIR) return;
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
  const device = (page.viewportSize()?.width ?? 0) < 600 ? "phone" : "desktop";
  const file = path.join(EVIDENCE_DIR, `${device}-${name}.png`);
  if (target === "banner")
    await page
      .getByRole("group", { name: "Whose turn" })
      .screenshot({ path: file });
  else if (target === "rows")
    await page
      .getByRole("list", { name: "Companies" })
      .screenshot({ path: file });
  else await page.screenshot({ path: file });
};

const turnBannerGroup = (page: Page) =>
  page.getByRole("group", { name: "Whose turn" });

const chartTable = (page: Page) =>
  page.getByRole("figure", { name: "Share price over the game" });

/** Launch the Metropolitan and three minors, then go to a Merger Round. */
const toMergerRound = async (page: Page) => {
  await startRailways(page, { modules: ["metropolitan"] });
  await foundCompanies(page, [
    ["Agricultural", 80, "Player 1"],
    ["Northern Port", 80, "Player 2"],
    ["Overnight", 70, "Player 3"],
    [METROPOLITAN],
  ]);
  await endStockRound(page, "Player 1", ROUND.merger);
};

/** Merge Agricultural and Northern Port into Union, optionally swapped. */
const mergeIntoUnion = async (page: Page, swap: boolean) => {
  const merge = await openMerge(page, ["Agricultural", "Northern Port"]);
  await toMergeCheck(page, merge, "Union", "Player 2");
  await expect(
    merge.getByText("Agricultural Northern Port Union"),
  ).toBeVisible();
  if (swap) {
    await press(
      page,
      merge.getByRole("button", { name: LABEL.swapNames, exact: true }),
    );
    await expect(
      merge.getByText("Northern Port Agricultural Union"),
    ).toBeVisible();
  }
  await snap(page, swap ? "merge-sheet-swapped" : "merge-sheet");
  await press(
    page,
    merge.getByRole("button", { name: LABEL.merge, exact: true }),
  );
  await expect(merge).toBeHidden();
};

/** Finish the Merger Round and a Stock Round, into an Operating Round. */
const toOperatingRound = async (page: Page) => {
  await expectTurn(page, "Overnight", "Player 3");
  await endMergerTurn(page);
  await expectRoundComplete(page, ROUND.merger);
  await chooseNextRound(page, ROUND.stock);
  await endStockRound(page, "Player 1");
};

/**
 * The minors' names over a Corporation's banner share one centre line with
 * its own name, whatever sits either side of that name.
 */
const expectLineageCentredOnTitle = async (
  page: Page,
  minors: [string, string],
  title: string,
) => {
  const banner = page.getByRole("group", { name: "Whose turn" });
  const box = async (text: string) => {
    const b = await banner.getByText(text, { exact: true }).boundingBox();
    if (!b) throw new Error(`${text} is not drawn in the banner`);
    return b;
  };
  const [first, last, major] = await Promise.all([
    box(minors[0]),
    box(minors[1]),
    box(title),
  ]);
  const lineageCentre = (first.x + last.x + last.width) / 2;
  const titleCentre = major.x + major.width / 2;
  expect(Math.abs(lineageCentre - titleCentre)).toBeLessThanOrEqual(1.5);
};

for (const [device, use] of DEVICES) {
  test.describe(`Railways company identity (${device})`, () => {
    test.use(use);

    test("p18: a merged Corporation is named after its two minors; the banner, rows and chart all show it", async ({
      page,
    }) => {
      await toMergerRound(page);
      await expectTurn(page, "Agricultural", "Player 1");
      await snap(page, "banner-minor", "banner");
      await snap(page, "screen-minor");

      await mergeIntoUnion(page, false);
      await expectCompanies(page, [
        `${METROPOLITAN} 80`,
        "Agricultural Northern Port Union 80*",
        "Overnight 70",
      ]);
      await snap(page, "rows-merged", "rows");

      await toOperatingRound(page);
      // The Metropolitan joined at the top price, so it operates first.
      await expectTurn(page, METROPOLITAN);
      await snap(page, "banner-metropolitan", "banner");
      await endTurnWithPriceChange(page, "same", METROPOLITAN);

      await expectTurn(page, "Agricultural Northern Port Union", "Player 2");
      await expectLineageCentredOnTitle(
        page,
        ["Agricultural", "Northern Port"],
        "Union",
      );
      await snap(page, "banner-merged", "banner");
      await snap(page, "screen-merged");
      await expect(
        chartTable(page).getByRole("rowheader", {
          name: "Agricultural Northern Port Union",
        }),
      ).toBeAttached();
      await chartTable(page).scrollIntoViewIfNeeded();
      await snap(page, "chart-merged");
    });

    test("Diagram 9 (p18): swapping the minors' order renames the Corporation everywhere, and undo takes a merge back", async ({
      page,
    }) => {
      await toMergerRound(page);
      await mergeIntoUnion(page, false);
      await expectCompanies(page, [
        `${METROPOLITAN} 80`,
        "Agricultural Northern Port Union 80*",
        "Overnight 70",
      ]);

      await undo(page);
      await expectCompanies(page, [
        `${METROPOLITAN} 80`,
        "Agricultural 80",
        "Northern Port 80",
        "Overnight 70",
      ]);

      await mergeIntoUnion(page, true);
      await expectCompanies(page, [
        `${METROPOLITAN} 80`,
        "Northern Port Agricultural Union 80*",
        "Overnight 70",
      ]);
      await snap(page, "rows-swapped", "rows");

      await toOperatingRound(page);
      await endTurnWithPriceChange(page, "same", METROPOLITAN);
      await expectTurn(page, "Northern Port Agricultural Union", "Player 2");
      await expect(turnBannerGroup(page)).toBeVisible();
      await snap(page, "banner-swapped", "banner");
      // Unchanged prices re-enter below their equals (p11).
      await expectCompanies(page, [
        "Northern Port Agricultural Union 80",
        `${METROPOLITAN} 80*`,
        "Overnight 70",
      ]);
      await snap(page, "rows-operating", "rows");
      await expect(
        chartTable(page).getByRole("rowheader", {
          name: "Northern Port Agricultural Union",
        }),
      ).toBeAttached();
      await chartTable(page).scrollIntoViewIfNeeded();
      await snap(page, "chart-swapped");
    });
  });
}
