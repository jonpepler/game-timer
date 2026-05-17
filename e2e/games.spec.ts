import { test, expect, type Page } from "@playwright/test";

const BASE = "/game-timer";

const fillBasics = async (page: Page, name: string) => {
  await page.getByLabel(/^Name$/).fill(name);
};

test.describe("game definition editor", () => {
  test("library shows built-ins with a Built-in badge", async ({ page }) => {
    await page.goto(`${BASE}/games`);
    await expect(page.getByText("Generic")).toBeVisible();
    await expect(page.getByText("Root")).toBeVisible();
    // Built-ins shouldn't expose edit / delete buttons.
    await expect(
      page.getByRole("link", { name: /Edit Root/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Delete Root/i }),
    ).toHaveCount(0);
  });

  test("creating a minimal custom definition lands it in the library + setup modal", async ({
    page,
  }) => {
    await page.goto(`${BASE}/games`);
    await page.getByRole("link", { name: /new game definition/i }).click();

    await expect(page).toHaveURL(/\/games\/new/);
    await fillBasics(page, "Wingspan");
    await page.getByRole("button", { name: /create game/i }).click();

    // Lands back on the library with the new entry visible.
    await expect(page).toHaveURL(/\/games$/);
    await expect(page.getByText("Wingspan")).toBeVisible();

    // The setup modal on /timer should now show Wingspan as an option.
    await page.goto(`${BASE}/timer`);
    const picker = page.getByLabel(/^Game$/);
    await picker.selectOption({ label: "Wingspan" });
    await expect(picker).toHaveValue(/^wingspan-/);
  });

  test("custom definition with factions populates the player rows", async ({
    page,
  }) => {
    await page.goto(`${BASE}/games/new`);
    await fillBasics(page, "Two Bird Game");
    // Add two factions
    await page.getByRole("button", { name: /add faction/i }).click();
    await page
      .getByLabel(/^Faction 1 name$/)
      .fill("Sparrows");
    await page.getByRole("button", { name: /add faction/i }).click();
    await page
      .getByLabel(/^Faction 2 name$/)
      .fill("Owls");
    await page.getByRole("button", { name: /create game/i }).click();

    await page.goto(`${BASE}/timer`);
    await page.getByLabel(/^Game$/).selectOption({ label: "Two Bird Game" });
    await page.getByLabel(/track individual players/i).check();
    await expect(page.getByLabel(/^Player 1 name$/)).toHaveValue("Sparrows");
    await expect(page.getByLabel(/^Player 2 name$/)).toHaveValue("Owls");
  });

  test("deleting a custom definition removes it from the library", async ({
    page,
  }) => {
    await page.goto(`${BASE}/games/new`);
    await fillBasics(page, "Disposable Game");
    await page.getByRole("button", { name: /create game/i }).click();

    await expect(page.getByText("Disposable Game")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: /Delete Disposable Game/i })
      .click();
    await expect(page.getByText("Disposable Game")).toHaveCount(0);
  });

  test("Manage games link in the setup modal navigates to the library", async ({
    page,
  }) => {
    await page.goto(`${BASE}/timer`);
    await page.getByRole("link", { name: /manage games/i }).click();
    await expect(page).toHaveURL(/\/games$/);
    await expect(page.getByText("Generic")).toBeVisible();
  });
});
