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
  /** Root: faction option *labels* per seat, in seating order
   * (e.g. "Marquise de Cat"). Labels not ids because tests query
   * the cards by their visible role + name. */
  factions?: string[];
  /** Root: rename seats before advancing. Lets tests assert on
   * meaningful player names instead of the default Player 1..N. */
  seatNames?: string[];
}

const next = (page: Page) =>
  page.getByRole("button", { name: /^Next/ }).click();

/**
 * Advance through Next clicks until the named screen heading is
 * visible. Encodes the user's mental model — "I keep clicking Next
 * until I see X" — and decouples tests from wizard step ordering or
 * count.
 */
export async function navigateToScreen(
  page: Page,
  heading: RegExp,
  { maxClicks = 12 } = {},
): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    const h = page.getByRole("heading", { name: heading });
    if (await h.isVisible().catch(() => false)) return;
    await next(page);
  }
  // Final assertion — fail loudly with a useful message if the
  // screen never showed.
  await page.getByRole("heading", { name: heading }).waitFor({ timeout: 2000 });
}

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

  // Game screen (always first).
  if (options.game) {
    await page.getByLabel(/^Game$/).selectOption(options.game);
  }

  if (options.game === "root") {
    // Seating.
    await navigateToScreen(page, /seat players/i);
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
    // Faction picker (last screen).
    await navigateToScreen(page, /^Faction$/);
    // The picker defaults to draft mode (dealt hand of n+1) — skip
    // it so the helper can land specific factions.
    await page.getByRole("button", { name: /^Skip draft$/ }).click();
    if (options.factions) {
      // Picking goes counterclockwise from the LAST seat (ADSET
      // A.8.3) — click in reverse so factions[i] lands on seat i.
      // Each pick is now two-step (open preview, Confirm setup).
      // `exact: true` keeps the role-name match off the
      // "Confirm setup" / nested buttons that share the cards.
      for (let i = options.factions.length - 1; i >= 0; i--) {
        await page
          .getByRole("button", { name: options.factions[i], exact: true })
          .click();
        await page.getByRole("button", { name: /^Confirm setup$/ }).click();
      }
    }
  } else {
    // Generic flow — Expected turns then Players.
    await navigateToScreen(page, /how long is this game/i);
    if (options.expectedTurns !== undefined) {
      await page
        .getByLabel(/expected turns/i)
        .fill(String(options.expectedTurns));
    }
    await navigateToScreen(page, /Players \(optional\)/i);
    if (options.trackPlayers) {
      await page.getByLabel(/track individual players/i).check();
      if (options.playerCount !== undefined) {
        await page
          .getByLabel(/^Number of players$/)
          .fill(String(options.playerCount));
      }
    }
  }
  // The picker auto-submits after the last confirmed pick when
  // it sits on the final wizard screen — in that case the Start
  // Game button is already gone. Otherwise click it.
  const startBtn = page.getByRole("button", { name: /start game/i });
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
  }
}

// Score-milestone dialog (Root's hireling triggers at 4/8/12) opens
// fullscreen and blocks every subsequent score button. Tests that
// pump the score upward have to acknowledge the dialog after each
// crossing — this helper polls briefly and clicks Acknowledge if it
// appeared.
export async function dismissMilestoneIfShown(page: Page): Promise<boolean> {
  const ack = page.getByRole("button", { name: /^Acknowledge$/ });
  if (await ack.isVisible().catch(() => false)) {
    await ack.click();
    return true;
  }
  return false;
}

// Increment a player's score N times, dismissing any milestone dialog
// that pops up between clicks. The dialog is fullscreen and would
// otherwise swallow the next + click.
export async function incrementScoreWithMilestones(
  page: Page,
  playerName: string,
  times: number,
): Promise<void> {
  const inc = page.getByRole("button", {
    name: new RegExp(`Increase score for ${playerName}`, "i"),
  });
  for (let i = 0; i < times; i++) {
    await inc.click();
    await dismissMilestoneIfShown(page);
  }
}
