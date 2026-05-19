import type { Page } from "@playwright/test";

/*
 * Shared wizard-walking helpers for e2e tests. The wizard has several
 * screens; tests that just want to "get to the timer" use `startGame`
 * with the bare minimum config.
 *
 * The wizard order for Root is:
 *   1) Game · 2) Turns · 3) Expansions · 4) Map · 5) Deck ·
 *   6) Landmarks · 7) Seat players · 8) Hirelings · 9) Draft ·
 *   10) Faction picker · 11) ADSET confirm
 * For Generic it collapses to:
 *   1) Game · 2) Turns · 3) Players (track-players fallback)
 */

const BASE = "/game-timer";

export interface StartGameOptions {
  /** Definition id to switch to. Omit to use Generic (default). */
  game?: string;
  /** Override Expected Turns input. */
  expectedTurns?: number;
  /** Generic only: enable per-player tracking. */
  trackPlayers?: boolean;
  /** Generic: number of players when tracking on. Root: seats. */
  playerCount?: number;
  /** Root: faction option ids per seat, in seating order. */
  factions?: string[];
  /** Root: rename seats before advancing. Lets tests assert on
   * meaningful player names instead of the default Player 1..N. */
  seatNames?: string[];
}

const next = (page: Page) =>
  page.getByRole("button", { name: /^Next/ }).click();

const setSeatCount = async (page: Page, target: number) => {
  // Each seat row exposes its index in the labelled input. Count by
  // probing increasing seat indices.
  const currentCount = await page
    .locator('input[aria-label^="Seat "][aria-label$=" name"]')
    .count();
  if (target > currentCount) {
    for (let i = 0; i < target - currentCount; i++) {
      await page.getByRole("button", { name: /add seat/i }).click();
    }
  } else if (target < currentCount) {
    for (let i = currentCount; i > target; i--) {
      await page
        .getByRole("button", { name: new RegExp(`Remove seat ${i}`) })
        .click();
    }
  }
};

/**
 * Walks the wizard from /timer to the timer view, with the supplied
 * options. Returns once the wizard is closed.
 */
export async function startGame(page: Page, options: StartGameOptions = {}) {
  await page.goto(`${BASE}/timer`);

  // Screen 1: Game.
  if (options.game) {
    await page.getByLabel(/^Game$/).selectOption(options.game);
  }
  await next(page);

  // Screen 2: Expected turns.
  if (options.expectedTurns !== undefined) {
    await page
      .getByLabel(/expected turns/i)
      .fill(String(options.expectedTurns));
  }
  await next(page);

  if (options.game === "root") {
    // Screens 3-6: expansions / map / deck / landmarks — accept defaults.
    await next(page); // expansions
    await next(page); // map
    await next(page); // deck
    await next(page); // landmarks
    // Screen 7: seat players.
    if (options.playerCount !== undefined) {
      await setSeatCount(page, options.playerCount);
    }
    if (options.seatNames) {
      for (let i = 0; i < options.seatNames.length; i++) {
        await page
          .getByLabel(new RegExp(`^Seat ${i + 1} name$`))
          .fill(options.seatNames[i]);
      }
    }
    await next(page);
    // Screen 8: hirelings — default skipped.
    await next(page);
    // Screen 9: draft — default off.
    await next(page);
    // Screen 10 (LAST): faction picker. The footer button reads
    // "Start Game" here, not "Next" — clicking faction cards fills
    // the seats; Start Game submits.
    if (options.factions) {
      for (const id of options.factions) {
        await page.getByTestId(`faction-card-${id}`).click();
      }
    }
  } else {
    // Generic: Players screen.
    if (options.trackPlayers) {
      await page.getByLabel(/track individual players/i).check();
      if (options.playerCount !== undefined) {
        await page
          .getByLabel(/^Number of players$/)
          .fill(String(options.playerCount));
      }
    }
  }
  await page.getByRole("button", { name: /start game/i }).click();
}
