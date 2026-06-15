import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";

/*
 * Companion view reflects a claimed Vagabond: a companion that claims a
 * seat and picks the Vagabond (which deals a character) should render the
 * Vagabond's head art in its claim chip — proving the faction + its
 * dealt character flow through STATE to the companion. (The head uses the
 * generic Vagabond crest; per-character art shows as the body meeple, not
 * the head.) Uses the BroadcastChannel fake.
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

test("companion shows a claimed Vagabond (head art)", async ({ context }) => {
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
  await picker
    .getByRole("button", { name: "Vagabond", exact: true })
    .first()
    .click();
  await companion.getByRole("button", { name: /^Confirm setup$/ }).click();

  // Seat 1's turn fires on the host — pick any faction.
  await host
    .locator('[class*="heroCard"]:not([aria-disabled="true"])')
    .first()
    .click();
  await host.getByRole("button", { name: /^Confirm setup$/ }).click();
  await host
    .getByRole("button", { name: /start game/i })
    .click({ timeout: 3000 })
    .catch(() => {});
  await expect(host.getByText(/turns left/i)).toBeVisible({ timeout: 5000 });

  // Companion's claim chip shows the Vagabond head art.
  await expect
    .poll(
      async () =>
        companion.locator('img[src*="games/root/heads/vagabond"]').count(),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  const srcs = await companion
    .locator("img")
    .evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  expect(
    srcs.some((s) => /games\/root\/heads\/vagabond\.png/.test(s ?? "")),
    `companion img srcs: ${JSON.stringify(srcs)}`,
  ).toBe(true);
});
