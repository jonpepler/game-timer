import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";

/*
 * Companion view reflects a claimed Vagabond: a companion that claims a
 * seat and picks the Vagabond (which deals a character) should render the
 * dealt character's meeple in its claim chip — proving the faction + its
 * dealt character flow through STATE to the companion. The claim chip
 * shows the per-character body meeple as a tinted silhouette (the head
 * crest is generic across every Vagabond character, so the body meeple
 * is what identifies the character). Uses the BroadcastChannel fake.
 */
const BASE = "/game-timer";

async function startHostAndShare(page: Page): Promise<string> {
  await page.goto(`${BASE}/timer`);
  const chip = page.getByRole("button", { name: /^Sharing session / });
  await chip.waitFor({ timeout: 5000 });
  const code = /Sharing session (\S+),/.exec(
    (await chip.getAttribute("aria-label")) ?? "",
  )?.[1];
  if (!code) throw new Error("no code");
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  return code;
}
async function openCompanion(ctx: BrowserContext, code: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/companion?code=${encodeURIComponent(code)}`);
  await expect(page.getByText(new RegExp(`Connected to ${code}`))).toBeVisible({
    timeout: 5000,
  });
  return page;
}

test("companion shows a claimed Vagabond (character meeple)", async ({
  context,
}) => {
  await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
  const host = await context.newPage();
  const code = await startHostAndShare(host);
  const companion = await openCompanion(context, code);

  await host.getByRole("button", { name: /start a new game/i }).click();
  await host.getByRole("heading", { name: /Game Setup/i }).waitFor();
  await host.getByLabel(/^Game$/).selectOption("root");

  // Two seats; companion claims seat 2 (last seat → picks first under
  // Root's counterclockwise rule).
  await navigateToScreen(host, /seat players/i);
  await host.getByRole("button", { name: /Remove seat 4/ }).click();
  await host.getByRole("button", { name: /Remove seat 3/ }).click();
  await expect(companion.getByText(/take a seat/i)).toBeVisible({
    timeout: 5000,
  });
  await companion.getByRole("button", { name: /^Claim seat 2$/ }).click();

  await navigateToScreen(host, /^Faction$/);
  await host.getByRole("button", { name: /^Skip draft$/ }).click();

  // Companion's turn (seat 2) — pick the Vagabond.
  const picker = companion.getByRole("region", {
    name: /Your turn to pick a faction/i,
  });
  await expect(picker).toBeVisible({ timeout: 5000 });
  // Two "Vagabond" cards exist (the two-Vagabond variant) — pick either.
  const pickVagabond = async () => {
    await picker
      .getByRole("button", { name: "Vagabond", exact: true })
      .first()
      .click();
    await companion.getByRole("button", { name: /^Confirm setup$/ }).click();
  };
  await pickVagabond();

  // The companion's pick must reach the host and advance the picker to
  // seat 1. If the SETUP_PICK is dropped the host heartbeat re-sends
  // seat 2's turn and the companion's picker reappears — re-pick until
  // the host has advanced.
  await expect
    .poll(
      async () => {
        if (await host.getByText(/seat 1 of 2/i).isVisible()) return true;
        if (await picker.isVisible().catch(() => false)) {
          await pickVagabond().catch(() => {});
        }
        return host.getByText(/seat 1 of 2/i).isVisible();
      },
      { timeout: 20_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);

  // Seat 1's turn fires on the host — pick the Marquise (not mutex with
  // the Vagabond, and distinct from it).
  await host
    .getByRole("button", { name: "Marquise de Cat", exact: true })
    .click();
  await host.getByRole("button", { name: /^Confirm setup$/ }).click();
  await host
    .getByRole("button", { name: /start game/i })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(host.getByText(/turns left/i)).toBeVisible({ timeout: 5000 });

  // Companion's claim chip shows the dealt character's meeple as a
  // masked silhouette (a span with mask-image, not an <img>). It must
  // reference a per-character meeple under games/root/meeples/, and NOT
  // the generic vagabond.svg pawn — proving the dealt character (not the
  // faction default) reached the companion.
  await expect
    .poll(
      async () =>
        companion
          .locator('[class*="claimMeeple"]')
          .first()
          .evaluate(
            (el) =>
              getComputedStyle(el).maskImage ||
              getComputedStyle(el).webkitMaskImage ||
              "",
          )
          .catch(() => ""),
      { timeout: 5000 },
    )
    .toMatch(/games\/root\/meeples\//);
  const mask = await companion
    .locator('[class*="claimMeeple"]')
    .first()
    .evaluate(
      (el) =>
        getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
    );
  expect(mask, `claim meeple mask-image: ${mask}`).not.toMatch(
    /meeples\/vagabond\.svg/,
  );
});
