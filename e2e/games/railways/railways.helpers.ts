import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "../../_peer-test-injection";
import { navigateToScreen } from "../../_setup-helpers";

/**
 * User-level helpers for the Railways rules suite. Every label the
 * tests depend on lives in `STEP_BUTTON` or `LABEL` below, so a copy
 * change in the app is a one-line fix here.
 */

/**
 * LABEL MAP: price step id to the visible button name in the end-of-turn
 * price prompt, under its "Share price change (increments)" heading.
 * The minus sign is U+2212. "+3" shows only with the Events module.
 */
export const STEP_BUTTON = {
  bankrupt: "Bankrupt",
  down: "\u22121",
  same: "No change",
  up: "+1",
  up2: "+2",
  up3: "+3",
} as const;

export type PriceStep = keyof typeof STEP_BUTTON;

/** Every other app label the suite relies on. */
export const LABEL = {
  ring: "Advance turn",
  undo: "Undo",
  keepPlaying: "Keep playing",
  notYet: "Not yet",
  companies: "Companies",
  addToCompanies: "Add to Companies",
  done: "Done",
  priorityQuestion: "Who has priority now?",
  merge: "Merge",
  next: "Next",
  back: "Back",
  cancel: "Cancel",
  swapNames: "Swap name order",
  remove: "Remove",
  close: "Close",
  // Accessible text a flipped (already operated) company carries.
  played: /played this round/,
} as const;

export const ROUND = {
  stock: "Stock Round",
  operating: "Operating Round",
  merger: "Merger Round",
} as const;

export type Round = (typeof ROUND)[keyof typeof ROUND];

export const MODULE = {
  landmarkTiles: "Landmarks: Landmark tiles",
  metropolitan: "Landmarks: Metropolitan Transit Department",
  events: "Landmarks: Events",
} as const;

export const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
export const desktop = { viewport: { width: 1280, height: 800 } };
export const DEVICES = [
  ["phone", phone],
  ["desktop", desktop],
] as const;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A company name as a pattern, tolerant of how the words wrap. A merged
 * Corporation's minor names run straight into its own name with nothing
 * between them ("Express Tunneling Union"), so neither "and" nor "&" is
 * accepted.
 */
const namePattern = (name: string) =>
  name.split(/\s+/).map(escapeRegExp).join("\\s+");
const exactName = (name: string) => new RegExp(`^${namePattern(name)}$`);

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 600;

/** A tap on a touch phone, a click on desktop. */
export const press = async (page: Page, target: Locator) => {
  if (isPhone(page)) await target.tap();
  else await target.click();
};

export const ring = (page: Page) =>
  page.getByRole("button", { name: LABEL.ring });

/** Tap the timer ring near its top, where a hand reaches first. */
export const tapRing = async (page: Page) => {
  const target = ring(page);
  const box = await target.boundingBox();
  if (!box) throw new Error("timer ring not visible");
  const position = { x: box.width / 2, y: box.height / 5 };
  if (isPhone(page)) await target.tap({ position });
  else await target.click({ position });
};

const dialog = (page: Page, name: string | RegExp) =>
  page.getByRole("dialog", { name });

const button = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole("button", {
    name,
    exact: typeof name === "string" ? true : undefined,
  });

export interface StartOptions {
  players?: number;
  modules?: Array<keyof typeof MODULE>;
  priority?: string;
  // Left alone, the setup step's default (the Long Game) stands.
  length?: "Short Game" | "Long Game";
}

const setSeatCount = async (page: Page, target: number) => {
  const seats = page.getByLabel(/^Seat \d+ name$/);
  let count = await seats.count();
  while (count < target) {
    await press(page, page.getByRole("button", { name: /add seat/i }));
    count++;
  }
  while (count > target) {
    await press(
      page,
      page.getByRole("button", { name: new RegExp(`Remove seat ${count}`) }),
    );
    count--;
  }
  await expect(seats).toHaveCount(target);
};

/**
 * Walk the setup wizard to the first Stock Round and start the clock.
 * Seats are named Player 1..N; `priority` takes the first turn.
 */
export const startRailways = async (
  page: Page,
  {
    players = 4,
    modules = [],
    priority = "Player 1",
    length,
  }: StartOptions = {},
) => {
  await page.goto("/game-timer/timer");
  await page.getByLabel(/^Game$/).selectOption("railways");
  await navigateToScreen(page, /^Modules$/);
  for (const m of modules) await page.getByLabel(MODULE[m]).check();
  if (length) {
    await navigateToScreen(page, /^Game length$/);
    await press(page, button(page, new RegExp(`^${length}`)));
  }
  await navigateToScreen(page, /^Seat players$/i);
  await setSeatCount(page, players);
  await navigateToScreen(page, /^Priority$/);
  await press(page, button(page, priority));
  await press(page, page.getByRole("button", { name: /start game/i }));
  await expectRound(page, ROUND.stock);
  await expectTurn(page, priority);
  // The first tap starts the clock; it is not a turn.
  await tapRing(page);
  await expectTurn(page, priority);
};

/** The running round, read from its End control. */
export const expectRound = async (page: Page, round: Round) => {
  await expect(button(page, `End ${round}`)).toBeVisible({ timeout: 15_000 });
};

// The title over the ring, not the readout a scrolled phone pins.
const turnBanner = (page: Page, name: string) =>
  page.getByRole("main").getByText(new RegExp(`^${namePattern(name)}’s turn$`));

/** Whose turn the banner names, and the president shown beneath it. */
export const expectTurn = async (
  page: Page,
  name: string,
  president?: string,
) => {
  await expect(turnBanner(page, name)).toBeVisible();
  if (president !== undefined)
    await expect(
      page
        .getByRole("group", { name: "Whose turn" })
        .getByText(president, { exact: true }),
    ).toBeVisible();
};

const companiesList = (page: Page) =>
  page.getByRole("list", { name: LABEL.companies });

/** Show the expanded turn order on its Companies list. */
const showCompanies = async (page: Page) => {
  const tab = button(page, LABEL.companies);
  if (
    (await tab.isVisible()) &&
    (await tab.getAttribute("aria-pressed")) === "false"
  )
    await press(page, tab);
  await expect(companiesList(page)).toBeVisible();
};

/**
 * The Companies list, top to bottom, as "Name price" with a trailing
 * "*" for a company that has operated this round (its token flipped).
 */
export const expectCompanies = async (page: Page, rows: string[]) => {
  await showCompanies(page);
  const items = companiesList(page).getByRole("listitem");
  await expect(async () => {
    await expect(items).toHaveCount(rows.length, { timeout: 500 });
    for (const [i, row] of rows.entries()) {
      const m = /^(.*) (\d+)(\*)?$/.exec(row);
      if (!m) throw new Error(`bad row "${row}"`);
      const [, name, price, played] = m;
      const item = items.nth(i);
      await expect(item.getByText(exactName(name))).toHaveCount(1, {
        timeout: 500,
      });
      await expect(item.getByText(price, { exact: true })).toHaveCount(1, {
        timeout: 500,
      });
      if (played)
        await expect(item).toContainText(LABEL.played, { timeout: 500 });
      else await expect(item).not.toContainText(LABEL.played, { timeout: 500 });
    }
  }).toPass({ timeout: 10_000 });
};

/** The president a company's row names. */
export const expectPresident = async (
  page: Page,
  company: string,
  president: string,
) => {
  await showCompanies(page);
  const row = companiesList(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(exactName(company)) });
  await expect(row.getByText(president, { exact: true })).toBeVisible();
};

const addSheet = (page: Page) => dialog(page, LABEL.addToCompanies);

/** The founding sheet: the companies the table can launch. */
export const openFoundingSheet = async (page: Page) => {
  await showCompanies(page);
  await press(page, button(page, LABEL.addToCompanies));
  await expect(addSheet(page)).toBeVisible();
  return addSheet(page);
};

export const closeFoundingSheet = async (page: Page) => {
  await press(page, button(addSheet(page), LABEL.done));
  await expect(addSheet(page)).toBeHidden();
};

/**
 * Launch a company at a starting share price with its president, from
 * the founding sheet. Omit both for a company that is asked neither,
 * such as one that joins at the top price and has no president.
 */
export const foundCompany = async (
  page: Page,
  name: string,
  price?: number,
  president?: string,
) => {
  if (!(await addSheet(page).isVisible())) await openFoundingSheet(page);
  await press(page, button(addSheet(page), `Add ${name}`));
  if (price === undefined && president === undefined) return;
  const details = dialog(page, `Add ${name}`);
  if (price !== undefined) await press(page, button(details, String(price)));
  if (president !== undefined) await press(page, button(details, president));
  await press(page, button(details, `Add ${name}`));
  await expect(details).toBeHidden();
};

/** Launch several companies, then close the founding sheet. */
export const foundCompanies = async (
  page: Page,
  companies: Array<[name: string, price?: number, president?: string]>,
) => {
  for (const [name, price, president] of companies)
    await foundCompany(page, name, price, president);
  await closeFoundingSheet(page);
};

export const pricePrompt = (page: Page) => dialog(page, /^End .*’s turn$/);

/** The price prompt's button for a step. */
export const stepButton = (page: Page, step: PriceStep) =>
  pricePrompt(page).getByRole("button", {
    name: new RegExp(`^${escapeRegExp(STEP_BUTTON[step])}(,|$)`),
  });

/** Tap the ring to end the acting company's turn, opening the prompt. */
export const openPricePrompt = async (page: Page, company?: string) => {
  await tapRing(page);
  const prompt = company
    ? dialog(page, new RegExp(`^End ${namePattern(company)}’s turn$`))
    : pricePrompt(page);
  await expect(prompt).toBeVisible();
  return prompt;
};

/** End the acting company's turn with a share price step. */
export const endTurnWithPriceChange = async (
  page: Page,
  step: PriceStep,
  company?: string,
) => {
  await openPricePrompt(page, company);
  await press(page, stepButton(page, step));
  await expect(pricePrompt(page)).toBeHidden();
};

/** A Stock Round turn: the player acts or passes, then taps the ring. */
export const endStockTurn = async (page: Page) => tapRing(page);

/** A minor's Merger Round turn: propose or pass, then tap the ring. */
export const endMergerTurn = async (page: Page) => tapRing(page);

const roundPrompt = (page: Page) => page.getByRole("alertdialog");

/** Pick the next round from the open "what comes next" prompt. */
export const chooseNextRound = async (page: Page, round: Round) => {
  await expect(roundPrompt(page)).toBeVisible();
  await press(
    page,
    button(roundPrompt(page), new RegExp(`^${round}( again)?$`)),
  );
  await expect(roundPrompt(page)).toBeHidden();
  await expectRound(page, round);
};

/** The round the prompt offers as its default (the focused primary button). */
export const expectDefaultNextRound = async (page: Page, round: Round) => {
  await expect(button(roundPrompt(page), round)).toBeFocused();
};

export const expectRoundComplete = async (page: Page, round: Round) => {
  await expect(roundPrompt(page)).toHaveAccessibleName(`${round} complete`);
};

/** Leave the round-complete prompt to look at the board first. */
export const dismissRoundPrompt = async (page: Page) => {
  await press(page, button(roundPrompt(page), LABEL.notYet));
  await expect(roundPrompt(page)).toBeHidden();
};

/** After "Not yet", a tap on the ring asks what comes next again. */
export const reopenRoundPrompt = async (page: Page) => {
  await tapRing(page);
  await expect(roundPrompt(page)).toBeVisible();
};

/** Open the end-of-round flow from the round's End control. */
export const endRound = async (page: Page, round: Round) => {
  await press(page, button(page, `End ${round}`));
};

/**
 * End the Stock Round: name the new priority player (the player
 * clockwise of the last non-pass action), then start the next round.
 */
export const endStockRound = async (
  page: Page,
  priority: string,
  next: Round = ROUND.operating,
) => {
  await endRound(page, ROUND.stock);
  await expect(roundPrompt(page)).toHaveAccessibleName(LABEL.priorityQuestion);
  await press(page, button(roundPrompt(page), priority));
  await chooseNextRound(page, next);
};

const actionsSheet = (page: Page, company: string) =>
  dialog(page, new RegExp(`^${namePattern(company)}`));

/** Open a company's actions sheet from its row. */
export const openCompanyActions = async (page: Page, company: string) => {
  await showCompanies(page);
  await press(
    page,
    button(page, new RegExp(`^Actions for ${namePattern(company)}(,|$)`)),
  );
  await expect(actionsSheet(page, company)).toBeVisible();
  return actionsSheet(page, company);
};

/**
 * Move a company's share price outside its own turn (share sales,
 * issues, the fully-owned bonus): one increment up or down, or straight
 * to a track value.
 */
export const changePriceOutOfTurn = async (
  page: Page,
  company: string,
  to: "up" | "down" | number,
) => {
  const sheet = await openCompanyActions(page, company);
  if (to === "up")
    await press(page, sheet.getByRole("button", { name: /^Up to \d+$/ }));
  else if (to === "down")
    await press(page, sheet.getByRole("button", { name: /^Down to \d+$/ }));
  else await press(page, button(sheet, String(to)));
  await expect(sheet).toBeHidden();
};

/** Hand a company's presidency to another player. */
export const setPresident = async (
  page: Page,
  company: string,
  president: string,
) => {
  const sheet = await openCompanyActions(page, company);
  await press(page, button(sheet, president));
  await expect(sheet).toBeHidden();
};

/** Take a company out of the game (closed, or its president bankrupt). */
export const removeCompany = async (page: Page, company: string) => {
  const sheet = await openCompanyActions(page, company);
  await press(page, button(sheet, LABEL.remove));
  await expect(sheet).toBeHidden();
};

export interface MergeOptions {
  minors: [string, string];
  major: string;
  president: string;
  swapNames?: boolean;
  // Overrides the suggested price.
  price?: number;
}

/**
 * Open the stepped merge sheet from the first minor's actions, pick the
 * second minor and go on to the charter step. The steps after it are the
 * charter and the president (each moves on when tapped), then the check
 * of the new Corporation with its name order and price.
 */
export const openMerge = async (page: Page, minors: [string, string]) => {
  const sheet = await openCompanyActions(page, minors[0]);
  await press(page, button(sheet, LABEL.merge));
  const merge = dialog(page, LABEL.merge);
  await expect(merge).toBeVisible();
  await press(
    page,
    button(merge, new RegExp(`^${escapeRegExp(minors[1])} \\d+$`)),
  );
  await press(page, button(merge, LABEL.next));
  return merge;
};

/** Leave the merge sheet from whichever step it is on. */
export const cancelMerge = async (page: Page, merge: Locator) => {
  while (await button(merge, LABEL.back).isVisible())
    await press(page, button(merge, LABEL.back));
  await press(page, button(merge, LABEL.cancel));
  await expect(merge).toBeHidden();
};

/** From the charter step, pick the charter and president, to the check. */
export const toMergeCheck = async (
  page: Page,
  merge: Locator,
  major: string,
  president: string,
) => {
  await press(page, button(merge, major));
  await press(page, button(merge, president));
  await expect(button(merge, LABEL.merge)).toBeVisible();
};

/** The price the merge sheet proposes (the pressed price chip). */
export const expectSuggestedMergePrice = async (
  merge: Locator,
  price: number,
) => {
  await expect(
    merge.getByRole("button", { name: String(price), exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
};

/** Merge two minors into a major. Returns the merged company's name. */
export const mergeCompanies = async (page: Page, options: MergeOptions) => {
  const merge = await openMerge(page, options.minors);
  await toMergeCheck(page, merge, options.major, options.president);
  if (options.swapNames) await press(page, button(merge, LABEL.swapNames));
  if (options.price !== undefined)
    await press(page, button(merge, String(options.price)));
  const name = await merge
    .getByText(new RegExp(`^.+ ${escapeRegExp(options.major)}$`))
    .textContent();
  await press(page, button(merge, LABEL.merge));
  await expect(merge).toBeHidden();
  return name ?? "";
};

/** The footer undo. */
export const undo = async (page: Page) => {
  await press(page, button(page, LABEL.undo));
};

const CLOCK_START = new Date("2026-01-01T12:00:00Z").getTime();

/**
 * Take over the page's clock before the game loads and hold it still,
 * so only `letTimePass` moves it on and a turn lasts exactly as long as
 * the test says, however slow the machine. Call before `startRailways`.
 */
export const installClock = async (page: Page) => {
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 1000);
};

/**
 * Let a number of seconds pass on an installed clock. Keep a turn inside
 * its countdown (45s in a Stock Round, 150s in an Operating Round, then
 * the round's running average): a jump past the end starts the overtime
 * count only where the jump lands.
 */
export const letTimePass = (page: Page, seconds: number) =>
  page.clock.fastForward(seconds * 1000);

/** Each player's share of the time played, as "Name: 25.0%" strings. */
const timeShares = (page: Page) =>
  page
    .getByLabel("Time share by player")
    .getByTitle(/: [\d.]+%$/)
    .evaluateAll((segments) =>
      segments.map((s) => s.getAttribute("title") ?? ""),
    );

/**
 * Each named player's share of the time played, in percent, to within a
 * point. Players left out should have had no time credited.
 */
export const expectTimeShares = async (
  page: Page,
  shares: Record<string, number>,
) => {
  await expect(async () => {
    const read: Record<string, number> = Object.fromEntries(
      (await timeShares(page)).map((t) => {
        const [, name, pct] = /^(.*): ([\d.]+)%$/.exec(t) ?? [];
        return [name, Number(pct)];
      }),
    );
    for (const name of new Set([...Object.keys(read), ...Object.keys(shares)]))
      expect(
        Math.abs((read[name] ?? 0) - (shares[name] ?? 0)),
        `${name}'s share of ${JSON.stringify(read)}`,
      ).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 10_000 });
};

/** The time share as it stands, to compare after an untimed turn. */
export const readTimeShares = timeShares;

/** The ring's countdown, absent while a turn is untimed. */
export const ringClock = (page: Page) => ring(page).getByText(/^\d\d:\d\d$/);

/** The notice an untimed, shared turn shows in place of a countdown. */
export const untimedNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Shareholders act" });

/**
 * Nothing on screen keeps or edits a score, and what is left is only the
 * game model's countdown in cycles, never a turn budget the table sets.
 */
export const expectNoScoreTracking = async (page: Page) => {
  await expect(page.getByRole("button", { name: /score for/i })).toHaveCount(0);
  await expect(page.getByLabel("Scores", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^\d+(\.5)? cycles? left$/)).toBeVisible();
};

/**
 * The merge sheet's folded "Charter Partners" section, on its first step:
 * the Direct-to-Major partner charters that stand in for a Minor Company.
 */
export const charterPartners = (merge: Locator) =>
  button(merge, "Charter Partners");

/** The merge sheet's confirm on its last step. */
export const mergeConfirm = (merge: Locator) => button(merge, LABEL.merge);

/** The merge sheet's Next, enabled once its step's choice is made. */
export const mergeNext = (merge: Locator) => button(merge, LABEL.next);

/** Tap a choice (a charter, a president, a price) in an open sheet. */
export const choose = (page: Page, sheet: Locator, name: string) =>
  press(page, button(sheet, name));

/** Step back from the price prompt without ending the turn. */
export const keepPlaying = async (page: Page) => {
  await press(page, button(pricePrompt(page), LABEL.keepPlaying));
  await expect(pricePrompt(page)).toBeHidden();
};

const COMPANION_SIZE = { width: 390, height: 844 };
const HOST_SIZE = { width: 1180, height: 820 };

export interface Table {
  host: Page;
  // Companion phones, by the seat number each one claimed.
  phones: Record<number, Page>;
}

/**
 * A host and one companion per seat in `seats`, each claiming its seat
 * from the wizard, then the game started with `priority` and the clock
 * running. Companions are phone sized in a touch context.
 */
export const startRailwaysWithCompanions = async (
  context: BrowserContext,
  {
    seats,
    modules = [],
    priority = "Player 1",
  }: { seats: number[]; modules?: StartOptions["modules"]; priority?: string },
): Promise<Table> => {
  await context.addInitScript({ content: PEER_TEST_INIT_SCRIPT });
  const host = await context.newPage();
  await host.setViewportSize(HOST_SIZE);
  await host.goto("/game-timer/timer");
  const chip = host.getByRole("button", { name: /^Sharing session / });
  await chip.waitFor({ timeout: 10_000 });
  const code = /Sharing session (\S+),/.exec(
    (await chip.getAttribute("aria-label")) ?? "",
  )?.[1];
  if (!code) throw new Error("no session code");

  const phones: Record<number, Page> = {};
  for (const seat of seats) {
    const phone = await context.newPage();
    await phone.setViewportSize(COMPANION_SIZE);
    await phone.goto(`/game-timer/companion?code=${encodeURIComponent(code)}`);
    await expect(
      phone.getByText(new RegExp(`Connected to ${code}`)),
    ).toBeVisible({ timeout: 10_000 });
    phones[seat] = phone;
  }

  await host.getByLabel(/^Game$/).selectOption("railways");
  await navigateToScreen(host, /^Modules$/);
  for (const m of modules ?? []) await host.getByLabel(MODULE[m]).check();
  await navigateToScreen(host, /^Seat players$/i);
  for (const seat of seats) {
    const phone = phones[seat];
    await expect(phone.getByText(/take a seat/i)).toBeVisible({
      timeout: 10_000,
    });
    await press(phone, button(phone, `Claim seat ${seat}`));
    await expect(
      phone.getByRole("textbox", { name: `Seat ${seat} name` }),
    ).toBeVisible();
  }
  await navigateToScreen(host, /^Priority$/);
  await press(host, button(host, priority));
  await press(host, host.getByRole("button", { name: /start game/i }));
  await expectRound(host, ROUND.stock);
  await tapRing(host);
  for (const phone of Object.values(phones))
    await expectRound(phone, ROUND.stock);
  return { host, phones };
};

/** A companion's own end-of-turn button, named for the acting company. */
export const companionEndTurn = (phone: Page, company: string) =>
  phone.getByRole("button", {
    name: new RegExp(`^End ${namePattern(company)}’s turn$`),
  });

/** A companion's end-of-turn button while it is someone else's turn. */
export const companionWaiting = (phone: Page) =>
  phone.getByRole("button", { name: /^Waiting for your turn/ });

/**
 * End the acting company's turn from its president's phone, answering
 * the price prompt when one is asked.
 */
export const endTurnFromPhone = async (
  phone: Page,
  company: string,
  step?: PriceStep,
) => {
  await press(phone, companionEndTurn(phone, company));
  if (step === undefined) return;
  await expect(pricePrompt(phone)).toBeVisible();
  await press(phone, stepButton(phone, step));
  await expect(pricePrompt(phone)).toBeHidden();
};
