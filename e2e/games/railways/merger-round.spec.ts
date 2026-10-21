import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  chooseNextRound,
  DEVICES,
  dismissRoundPrompt,
  endStockRound,
  endMergerTurn,
  endTurnWithPriceChange,
  expectCompanies,
  expectDefaultNextRound,
  expectPresident,
  expectRoundComplete,
  expectSuggestedMergePrice,
  expectTurn,
  foundCompanies,
  LABEL,
  mergeCompanies,
  openMerge,
  press,
  pricePrompt,
  ROUND,
  startRailways,
  cancelMerge,
  charterPartners,
  choose,
  openCompanyActions,
  mergeConfirm,
  mergeNext,
  toMergeCheck,
} from "./railways.helpers";

/*
 * Railways of the Lost Atlas, 2nd edition rulebook: the Merger Round
 * (p18, Diagram 9) and the cycle it closes (p19). Page numbers are the
 * printed ones.
 */

/*
 * Each test walks the whole setup wizard and then plays rounds, which takes
 * up to 16s with 8 workers and more than the 30s default during load spikes.
 */
test.describe.configure({ timeout: 60_000 });

/*
 * Set MERGE_EVIDENCE_DIR to save screenshots of the merge steps and a
 * video of the charter partner merge for review, and MERGE_EVIDENCE_SCHEME
 * to "light" or "dark" to choose the scheme they are taken in.
 */
const EVIDENCE_DIR = process.env.MERGE_EVIDENCE_DIR;
const EVIDENCE_SCHEME = process.env.MERGE_EVIDENCE_SCHEME;
if (EVIDENCE_DIR)
  test.use({
    video: "on",
    launchOptions: { slowMo: 150 },
    ...(EVIDENCE_SCHEME === "light" || EVIDENCE_SCHEME === "dark"
      ? { colorScheme: EVIDENCE_SCHEME }
      : {}),
  });

const snap = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const device = (page.viewportSize()?.width ?? 0) < 600 ? "phone" : "desktop";
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${device}-${name}.png`),
  });
};

const stepHeading = (merge: Locator) =>
  merge.getByRole("heading", { level: 3 });

/** Every Corporation charter, both sides, as on the cards. */
const CORPORATION_SIDES = [
  ["International", "Inc."],
  ["Consortium", "Conglomerate"],
  ["Firm", "Federation"],
  ["Enterprise", "Experiment"],
  ["System", "Syndicate"],
  ["Union", "Unlimited"],
  ["League", "LLC"],
  ["Alliance", "Authority"],
] as const;

/** The Direct-to-Major partner charters (Landmarks p2), both sides. */
const PARTNER_SIDES = [
  ["Generic", "Independent"],
  ["Big", "The"],
  ["Mom & Pop", "Friendly Local"],
  ["Regional", "Common"],
  ["Original", "Grand"],
] as const;

type Launch = [name: string, price: number, president: string];

/** Launch companies in the first Stock Round, then go to a Merger Round. */
const toMergerRound = async (page: Page, companies: Launch[]) => {
  await startRailways(page);
  await foundCompanies(page, companies);
  await endStockRound(page, "Player 1", ROUND.merger);
};

for (const [device, use] of DEVICES) {
  test.describe(`Railways Merger Round (${device})`, () => {
    test.use(use);

    test("p18: in descending stock price order each Minor Company's president may propose a merger or pass; Major Corporations do not act", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Tunneling", 70, "Player 2"],
        ["Union", 100, "Player 4"],
        ["Express", 90, "Player 1"],
        ["Suburban", 60, "Player 3"],
      ]);
      await expectTurn(page, "Express", "Player 1");
      // Passing in the Merger Round moves no share price.
      await endMergerTurn(page);
      await expect(pricePrompt(page)).toHaveCount(0);
      await expectTurn(page, "Tunneling", "Player 2");
      await endMergerTurn(page);
      await expectTurn(page, "Suburban", "Player 3");
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
    });

    test("p3, p5 and Diagram 9 (p18): each Corporation charter has two identity options, so the merge offers both sides of every charter", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Agricultural", 80, "Player 1"],
        ["Northern Port", 80, "Player 2"],
      ]);
      const merge = await openMerge(page, ["Agricultural", "Northern Port"]);
      for (const major of CORPORATION_SIDES.flat())
        await expect(
          merge.getByRole("button", { name: major, exact: true }),
        ).toBeVisible();
      await cancelMerge(page, merge);

      await mergeCompanies(page, {
        minors: ["Agricultural", "Northern Port"],
        major: "Conglomerate",
        president: "Player 1",
      });
      await expectCompanies(page, [
        "Agricultural Northern Port Conglomerate 80*",
      ]);
    });

    test("every Corporation side on the cards can name the merged Corporation", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await toMergerRound(page, [
        ["Agricultural", 80, "Player 1"],
        ["Northern Port", 80, "Player 2"],
      ]);
      const merge = await openMerge(page, ["Agricultural", "Northern Port"]);
      await expect(stepHeading(merge)).toHaveText("Corporation Name");
      for (const side of CORPORATION_SIDES.flat()) {
        await choose(page, merge, side);
        await expect(stepHeading(merge)).toHaveText("Who is president?");
        await press(page, merge.getByRole("button", { name: LABEL.back }));
        await expect(
          merge.getByRole("button", { name: side, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      }
    });

    test("Landmarks p12, Launching Direct-to-Major: a Minor Company becomes a Corporation with a partner charter in place of a second Minor", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      const actions = await openCompanyActions(page, "Express");
      await press(page, actions.getByRole("button", { name: LABEL.merge }));
      const merge = page.getByRole("dialog", { name: LABEL.merge });
      await expect(stepHeading(merge)).toHaveText(
        "Which two Minor Companies merge?",
      );
      // The partners sit folded below the Minor Companies.
      await expect(charterPartners(merge)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(merge.getByRole("button", { name: "Big" })).toHaveCount(0);
      await snap(page, "merge-01-partners-collapsed");
      await press(page, charterPartners(merge));
      for (const side of PARTNER_SIDES.flat())
        await expect(
          merge.getByRole("button", { name: side, exact: true }),
        ).toBeVisible();
      await snap(page, "merge-02-partners-expanded");
      await choose(page, merge, "Big");
      // One partner at most: Express and Big fill both places.
      await expect(
        merge.getByRole("button", { name: "Mom & Pop", exact: true }),
      ).toBeDisabled();
      await expect(
        merge.getByRole("button", { name: "Tunneling 70" }),
      ).toBeDisabled();
      await snap(page, "merge-03-partner-chosen");
      await press(page, mergeNext(merge));
      await expect(stepHeading(merge)).toHaveText("Corporation Name");
      await snap(page, "merge-04-corporation-name");
      await toMergeCheck(page, merge, "Union", "Player 1");
      await expect(merge.getByText(/^Express\s+Big\s+Union$/)).toBeVisible();
      await press(page, merge.getByRole("button", { name: LABEL.swapNames }));
      await expect(merge.getByText(/^Big\s+Express\s+Union$/)).toBeVisible();
      // The partner has no share price: the Minor's price carries over.
      await expectSuggestedMergePrice(merge, 90);
      await snap(page, "merge-05-check");
      await press(page, mergeConfirm(merge));
      await expect(merge).toBeHidden();
      await expectCompanies(page, ["Big Express Union 90*", "Tunneling 70"]);
      await expectPresident(page, "Big Express Union", "Player 1");
      await snap(page, "merge-06-done");
    });

    test("p4 and p18: the merged stock price is the average of both Minor Companies rounded down", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 80, "Player 1"],
        ["Tunneling", 70, "Player 1"],
        ["Northern Port", 120, "Player 2"],
        ["Agricultural", 135, "Player 2"],
      ]);
      // 80 and 70 average 75, rounded down to 70 on the track.
      let merge = await openMerge(page, ["Express", "Tunneling"]);
      await toMergeCheck(page, merge, "Union", "Player 1");
      await expectSuggestedMergePrice(merge, 70);
      await cancelMerge(page, merge);
      // 120 and 135 average 127, rounded down to 120.
      merge = await openMerge(page, ["Northern Port", "Agricultural"]);
      await toMergeCheck(page, merge, "Union", "Player 2");
      await expectSuggestedMergePrice(merge, 120);
    });

    test("p11 and p18: the merged Corporation's token enters below those already in its column, and both minors leave the stock track", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 2"],
        ["Tunneling", 70, "Player 1"],
      ]);
      await mergeCompanies(page, {
        minors: ["Express", "Tunneling"],
        major: "Union",
        president: "Player 1",
      });
      // Express was proposing, so the new Corporation has had its turn.
      await expectCompanies(page, [
        "Expansive 80",
        "Express Tunneling Union 80*",
      ]);
    });

    test("p18: the player with the most shares of the merging Companies becomes president of the new Corporation", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      await mergeCompanies(page, {
        minors: ["Express", "Tunneling"],
        major: "Federation",
        president: "Player 2",
      });
      await expectPresident(page, "Express Tunneling Federation", "Player 2");
    });

    test("Diagram 9 (p18): the two Minor charters sit side by side under the Corporation; their name order can be swapped", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Northern Port", 80, "Player 1"],
        ["Agricultural", 80, "Player 2"],
      ]);
      const merge = await openMerge(page, ["Northern Port", "Agricultural"]);
      await toMergeCheck(page, merge, "Union", "Player 2");
      await expect(
        merge.getByText("Northern Port Agricultural Union"),
      ).toBeVisible();
      await press(
        page,
        merge.getByRole("button", { name: LABEL.swapNames, exact: true }),
      );
      await expect(
        merge.getByText("Agricultural Northern Port Union"),
      ).toBeVisible();
      await press(
        page,
        merge.getByRole("button", { name: LABEL.merge, exact: true }),
      );
      await expectCompanies(page, ["Agricultural Northern Port Union 80*"]);
    });

    test("p18: after a merge the next Minor Company in stock price order proposes", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 80, "Player 2"],
        ["Suburban", 60, "Player 1"],
      ]);
      await expectTurn(page, "Express");
      // Express proposes to Suburban; its president runs both.
      await mergeCompanies(page, {
        minors: ["Express", "Suburban"],
        major: "Consortium",
        president: "Player 1",
      });
      await expectTurn(page, "Tunneling", "Player 2");
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
    });

    test("p19: a cycle is a Stock Round, two Operating Rounds and a Merger Round, so the next cycle opens with a Stock Round", async ({
      page,
    }) => {
      await toMergerRound(page, [["Express", 90, "Player 1"]]);
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
      await expectDefaultNextRound(page, ROUND.stock);
    });

    test("p18: the new Corporation operates in later Operating Rounds at its merged price, under its president", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Expansive", 80, "Player 3"],
        ["Tunneling", 70, "Player 2"],
      ]);
      await mergeCompanies(page, {
        minors: ["Express", "Tunneling"],
        major: "System",
        president: "Player 2",
      });
      await expectTurn(page, "Expansive");
      await endMergerTurn(page);
      await expectRoundComplete(page, ROUND.merger);
      await chooseNextRound(page, ROUND.stock);
      await endStockRound(page, "Player 1");
      await expectTurn(page, "Expansive", "Player 3");
      await endTurnWithPriceChange(page, "same", "Expansive");
      await expectTurn(page, "Express Tunneling System", "Player 2");
      await endTurnWithPriceChange(page, "up", "Express Tunneling System");
      await dismissRoundPrompt(page);
      await expectCompanies(page, [
        "Express Tunneling System 90*",
        "Expansive 80*",
      ]);
    });

    test("p18: the merger needs its Corporation charter and the president of the new Corporation before it goes ahead", async ({
      page,
    }) => {
      await toMergerRound(page, [
        ["Express", 90, "Player 1"],
        ["Tunneling", 70, "Player 2"],
      ]);
      const merge = await openMerge(page, ["Express", "Tunneling"]);
      await expect(mergeNext(merge)).toBeDisabled();
      await choose(page, merge, "Federation");
      await expect(mergeNext(merge)).toBeDisabled();
      await choose(page, merge, "Player 2");
      await expect(mergeConfirm(merge)).toBeEnabled();
    });
  });
}
