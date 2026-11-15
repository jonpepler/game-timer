import { expect, type Locator, type Page } from "@playwright/test";
import { navigateToScreen } from "../../_setup-helpers";

/**
 * User-level helpers for the Oath rules suite. Every label the tests
 * depend on lives in `LABEL` or `COLOUR` below, so a copy
 * change in the app is a one-line fix here.
 */

export const LABEL = {
  ring: "Advance turn",
  undo: "Undo",
  changeRoles: "Change roles",
  done: "Done",
  chancellorWins: "Chancellor wins",
  playOn: "Play on",
  noChancellor: "No Chancellor",
  victory: "Victory banner",
  gameOver: "Game over",
} as const;

export type Role = "Exile" | "Citizen" | "Chancellor";

/** Seat colours as the setup screen names them. */
export const COLOUR = {
  white: "White",
  red: "Red",
  blue: "Blue",
  yellow: "Yellow",
  black: "Black",
  pink: "Pink",
  brown: "Brown",
} as const;

/** The Empire's purple, as the turn banner draws the Chancellor's name (hex). */
export const CHANCELLOR_PURPLE = "#7b3f8c";

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

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 600;

/** A tap on a touch phone, a click on desktop. */
export const press = async (page: Page, target: Locator) => {
  if (isPhone(page)) await target.tap();
  else await target.click();
};

const button = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole("button", {
    name,
    exact: typeof name === "string" ? true : undefined,
  });

export const ring = (page: Page) => button(page, LABEL.ring);

/** Tap the timer ring near its top, where a hand reaches first. */
export const tapRing = async (page: Page) => {
  const target = ring(page);
  const box = await target.boundingBox();
  if (!box) throw new Error("timer ring not visible");
  const position = { x: box.width / 2, y: box.height / 5 };
  if (isPhone(page)) await target.tap({ position });
  else await target.click({ position });
};

export interface StartOptions {
  players?: number;
  /** The last game's winner, or null for a game with no Empire. */
  chancellor?: string | null;
  citizens?: string[];
  /** With no Chancellor: who holds the first player marker. */
  firstPlayer?: string;
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

/** Open the setup wizard on Oath and walk to the seating screen. */
export const openOathSetup = async (page: Page) => {
  await page.goto("/game-timer/timer");
  await page.getByLabel(/^Game$/).selectOption("oath");
  await navigateToScreen(page, /^Seat players$/i);
};

/**
 * Walk the setup wizard and start the clock. Seats are named
 * Player 1..N. With a Chancellor, they open; without one, `firstPlayer`
 * does.
 */
export const startOath = async (
  page: Page,
  {
    players = 4,
    chancellor = null,
    citizens = [],
    firstPlayer = "Player 1",
  }: StartOptions = {},
) => {
  await openOathSetup(page);
  await setSeatCount(page, players);
  await navigateToScreen(page, /^Chancellor$/);
  await press(page, button(page, chancellor ?? LABEL.noChancellor));
  if (chancellor) {
    await navigateToScreen(page, /^Citizens$/);
    for (const name of citizens)
      await press(page, page.getByRole("checkbox", { name }));
  } else {
    await navigateToScreen(page, /^First player$/);
    await press(page, button(page, firstPlayer));
  }
  await press(page, page.getByRole("button", { name: /start game/i }));
  const opener = chancellor ?? firstPlayer;
  await expectTurn(page, opener);
  // The first tap starts the clock; it is not a turn.
  await tapRing(page);
  await expectTurn(page, opener);
};

// The title over the ring, not the readout a scrolled phone pins.
const turnBanner = (page: Page, name: string) =>
  page.getByRole("main").getByText(new RegExp(`^${name}’s turn$`));

export const expectTurn = async (page: Page, name: string) => {
  await expect(turnBanner(page, name)).toBeVisible({ timeout: 15_000 });
};

/** End the active player's turn the normal way: a tap on the ring. */
export const endTurn = tapRing;

/** Play out the rest of a round: `remaining` ordinary turn ends. */
export const endTurns = async (page: Page, remaining: number) => {
  for (let i = 0; i < remaining; i++) await tapRing(page);
};

/**
 * The round being played, read from the footer's countdown: round 1 of 8
 * leaves "8 rounds left".
 */
export const expectRound = async (page: Page, round: number) => {
  const left = 9 - round;
  await expect(page.getByRole("contentinfo")).toContainText(
    `${left} ${left === 1 ? "round left" : "rounds left"}`,
  );
};

/** The role shown under the name of the player whose turn it is. */
export const expectActiveRole = async (page: Page, role: Role) => {
  await expect(
    page.getByRole("main").getByText(role, { exact: true }),
  ).toBeVisible();
};

/** Change any player's role from the Change roles sheet. */
export const changeRole = async (page: Page, player: string, role: Role) => {
  await press(
    page,
    page
      .getByRole("region", { name: "Turn actions" })
      .getByRole("button", { name: LABEL.changeRoles }),
  );
  const sheet = page.getByRole("dialog", { name: LABEL.changeRoles });
  await press(
    page,
    sheet
      .getByRole("group", { name: `${player} role` })
      .getByRole("button", { name: role }),
  );
  await press(page, button(sheet, LABEL.done));
  await expect(sheet).toBeHidden();
};

export const endDiePrompt = (page: Page, round: number) =>
  page.getByRole("alertdialog", { name: `End of round ${round}` });

export const expectWinner = async (page: Page, name: string) => {
  const banner = page.getByRole("dialog", { name: LABEL.victory });
  await expect(banner.getByText(name, { exact: true })).toBeVisible();
  await expect(banner.getByText("wins!")).toBeVisible();
};

/** The end screen of a game that names no winner. */
export const gameOverScreen = (page: Page) =>
  page.getByRole("dialog", { name: LABEL.gameOver });

/**
 * The seat colour the turn banner is drawn for. The name text itself may
 * be pulled toward the ink on a light theme, so this reads the colour the
 * banner was given.
 */
export const turnNameColour = (page: Page, name: string) =>
  turnBanner(page, name).evaluate((name) => {
    const el = name.closest<HTMLElement>("[style*='color']") ?? name;
    // A canvas reads any CSS colour back as hex, whatever syntax drew it.
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no canvas");
    const [r, g, b] = (
      (el.style.color || getComputedStyle(el).color).match(/[\d.]+/g) ?? []
    )
      .slice(0, 3)
      .map(Number)
      .map((v) => (v <= 1 && v % 1 !== 0 ? Math.round(v * 255) : v));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    return ctx.fillStyle;
  });
