import { expect, type Page } from "@playwright/test";

/** The tap-to-advance ring, which also shows the running countdown. */
export const ring = (page: Page) =>
  page.getByRole("button", { name: "Advance turn" });

const mmss = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The ring's countdown started from `seconds`. A few seconds below it
 * also pass, so a slow test run does not fail on clock drift.
 */
export const expectCountdownFrom = async (page: Page, seconds: number) => {
  const readings = Array.from({ length: 6 }, (_, i) => mmss(seconds - i));
  await expect(ring(page)).toContainText(new RegExp(readings.join("|")));
};
