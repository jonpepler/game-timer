import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { PEER_PROTOCOL_VERSION } from "../src/state/peerProtocol";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";

/*
 * Seating and names from a companion, on Railways of the Lost Atlas.
 * Two phones take seats 1 and 2 during setup, rename themselves (a name
 * is sent once, on submit), add, reorder and remove seats; the host's
 * wizard shows each change and both claims stay on their seats. A phone
 * names and colours only its own seat, and the host refuses its edits
 * to anyone else. A phone without a seat sees no editing controls and
 * the host refuses its commands. Mid-game each phone renames itself from
 * the same players sheet the host uses, without advancing the turn.
 * Seat colours are covered on Arcs, whose seating offers them.
 *
 * Set COMPANION_SEATING_EVIDENCE_DIR to save side-by-side host and phone
 * screenshots of each step and a video of a phone editing the seats.
 */

const EVIDENCE_DIR = process.env.COMPANION_SEATING_EVIDENCE_DIR;

const PHONE = { width: 390, height: 844 };
const HOST_SIZE = { width: 1180, height: 820 };

test.use({
  video: EVIDENCE_DIR ? { mode: "on", size: PHONE } : "off",
  launchOptions: { slowMo: EVIDENCE_DIR ? 150 : 0 },
});

/*
 * Each test drives a host and phones through the setup wizard before it
 * starts; on a loaded machine that alone can take most of the default
 * 30 seconds, so the file gets a budget that fits the work.
 */
test.describe.configure({ timeout: 120_000 });

const sideBySide = async (
  context: BrowserContext,
  host: Page,
  phone: Page,
  name: string,
) => {
  if (!EVIDENCE_DIR) return;
  const settle = (page: Page) =>
    page.evaluate(() =>
      Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => undefined)),
      ),
    );
  await Promise.all([settle(host), settle(phone)]);
  const [h, c] = await Promise.all([host.screenshot(), phone.screenshot()]);
  const sheet = await context.newPage();
  await sheet.setViewportSize({
    width: HOST_SIZE.width + PHONE.width + 72,
    height: HOST_SIZE.height + 72,
  });
  const img = (png: Buffer, width: number) =>
    `<figure style="margin:0"><img style="width:${width}px;display:block;border:1px solid #555" src="data:image/png;base64,${png.toString("base64")}"></figure>`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;display:flex;gap:24px;align-items:flex-start;background:#1b1b1b">${img(h, HOST_SIZE.width)}${img(c, PHONE.width)}</body>`,
  );
  await sheet.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
  await sheet.close();
};

const saveVideo = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  const video = page.video();
  await page.close();
  await video?.saveAs(path.join(EVIDENCE_DIR, `${name}.webm`));
};

const seats = (page: Page) => page.getByRole("list", { name: "Seats" });
const seatRow = (page: Page, seat: number) =>
  seats(page)
    .getByRole("listitem")
    .nth(seat - 1);
const seatName = (page: Page, seat: number) =>
  page.getByRole("textbox", { name: `Seat ${seat} name` });

// The host's wizard seat names, top to bottom.
const hostNames = (host: Page) =>
  seats(host)
    .getByRole("textbox")
    .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

/**
 * Host on the Railways seating screen with three phones connected: two
 * take seats 1 and 2, the third stays unseated.
 */
const setUp = async (
  context: BrowserContext,
  phoneSized: boolean,
  game = "railways",
) => {
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

  const open = async () => {
    const page = await context.newPage();
    if (phoneSized) await page.setViewportSize(PHONE);
    await page.goto(`/game-timer/companion?code=${encodeURIComponent(code)}`);
    await expect(
      page.getByText(new RegExp(`Connected to ${code}`)),
    ).toBeVisible({ timeout: 10_000 });
    return page;
  };
  const a = await open();
  const b = await open();
  const guest = await open();

  await host.getByLabel(/^Game$/).selectOption(game);
  await navigateToScreen(host, /^Seat players$/i);
  for (const [page, seat] of [
    [a, 1],
    [b, 2],
  ] as const) {
    await expect(page.getByText("Take a seat")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: `Claim seat ${seat}` }).click();
    await expect(seatRow(page, seat)).toContainText("You");
  }
  return { host, a, b, guest, code };
};

/**
 * Send one command from a fresh peer on the test transport, optionally
 * claiming a seat first, and return the host's answer.
 */
const forge = (
  page: Page,
  code: string,
  claim: number | null,
  command: unknown,
) =>
  page.evaluate(
    async ({ channelName, claim, command, version }) => {
      const channel = new BroadcastChannel(channelName);
      const me = `forged-${Math.random().toString(36).slice(2)}`;
      const send = (data: unknown) =>
        channel.postMessage({ from: me, to: "host", type: "data", data });
      const reply = new Promise<unknown>((resolve) => {
        channel.addEventListener("message", (ev) => {
          const m = ev.data;
          if (m?.to === me && m.data?.type === "COMMAND_RESULT")
            resolve(m.data);
        });
      });
      channel.postMessage({ from: me, to: "host", type: "connect" });
      if (claim !== null)
        send({ type: "CLAIM", protocolVersion: version, playerIndex: claim });
      await new Promise((r) => setTimeout(r, 300));
      send({
        type: "COMMAND",
        protocolVersion: version,
        commandId: "forged-1",
        command,
      });
      const result = await reply;
      channel.postMessage({ from: me, to: "host", type: "disconnect" });
      return result;
    },
    {
      channelName: `peer-test:gtmr-${code}`,
      claim,
      command,
      version: PEER_PROTOCOL_VERSION,
    },
  );

for (const [label, phoneSized] of [
  ["phone", true],
  ["desktop", false],
] as const) {
  test.describe(`companion seating: ${label}`, () => {
    if (phoneSized)
      test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test("phones rename, add, reorder and remove seats during setup", async ({
      context,
    }) => {
      test.setTimeout(120_000);
      const { host, a, b, guest } = await setUp(context, phoneSized);
      expect(await hostNames(host)).toEqual([
        "Player 1",
        "Player 2",
        "Player 3",
        "Player 4",
      ]);
      await sideBySide(context, host, a, `${label}-01-seats-claimed`);

      // A phone names only its own seat, and only once it submits.
      await expect(seatName(a, 1)).toBeVisible();
      for (const other of [2, 3, 4])
        await expect(seatName(a, other)).toHaveCount(0);
      await seatName(a, 1).fill("Ada");
      await sideBySide(context, host, a, `${label}-02a-typing`);
      expect(await hostNames(host)).toEqual([
        "Player 1",
        "Player 2",
        "Player 3",
        "Player 4",
      ]);
      await seatName(a, 1).press("Enter");
      // The host names anyone, including a free seat.
      await seatName(host, 3).fill("Cy");
      await seatName(host, 3).press("Enter");
      await expect
        .poll(() => hostNames(host))
        .toEqual(["Ada", "Player 2", "Cy", "Player 4"]);
      await expect(seatRow(b, 1)).toContainText("Ada");
      await expect(seatRow(a, 3)).toContainText("Cy");
      await sideBySide(context, host, a, `${label}-02-renamed`);

      // It adds a seat, which the host and the other phones see.
      await a.getByRole("button", { name: "Add seat" }).click();
      await expect.poll(() => hostNames(host)).toHaveLength(5);
      await expect(seatRow(guest, 5)).toContainText("Player 5");

      // It moves Cy to the top; both claims follow their seats.
      await a.getByRole("button", { name: "Move seat 3 up" }).click();
      await expect(seatRow(a, 2)).toContainText("Cy");
      await a.getByRole("button", { name: "Move seat 2 up" }).click();
      await expect
        .poll(() => hostNames(host))
        .toEqual(["Cy", "Ada", "Player 2", "Player 4", "Player 5"]);
      await expect(seatRow(a, 2)).toContainText("You");
      await expect(seatRow(b, 3)).toContainText("You");
      await sideBySide(context, host, a, `${label}-03-reordered`);

      // It removes Cy; the claims shift up with their seats.
      await a.getByRole("button", { name: "Remove seat 1" }).click();
      await expect
        .poll(() => hostNames(host))
        .toEqual(["Ada", "Player 2", "Player 4", "Player 5"]);
      await expect(seatRow(a, 1)).toContainText("You");
      await expect(seatRow(b, 2)).toContainText("You");
      // Another phone's seat offers no remove button.
      await expect(
        a.getByRole("button", { name: "Remove seat 2" }),
      ).toHaveCount(0);

      // The other phone renames itself, after all of that.
      await seatName(b, 2).fill("Bo");
      await seatName(b, 2).press("Enter");
      await expect
        .poll(() => hostNames(host))
        .toEqual(["Ada", "Bo", "Player 4", "Player 5"]);
      await sideBySide(context, host, b, `${label}-04-removed-and-renamed`);

      // A phone without a seat can only take one.
      await expect(seats(guest)).toContainText("Ada");
      await expect(guest.getByRole("textbox")).toHaveCount(0);
      await expect(guest.getByRole("button", { name: "Add seat" })).toHaveCount(
        0,
      );
      await expect(
        guest.getByRole("button", { name: /^Move seat/ }),
      ).toHaveCount(0);
      await sideBySide(context, host, guest, `${label}-05-unseated-phone`);
      await saveVideo(a, `seating-${label}`);
    });

    test("a phone picks and swaps its own seat colour", async ({ context }) => {
      const { host, a, b } = await setUp(context, phoneSized, "arcs");
      const colours = (page: Page, seat: string) =>
        page.getByRole("radiogroup", { name: `${seat} colour` });
      const colour = (page: Page, seat: string, name: string) =>
        colours(page, seat).getByRole("radio", { name });
      // Each phone is offered its own seat's colours only.
      await expect(colours(a, "Player 2")).toHaveCount(0);
      await expect(colours(b, "Player 1")).toHaveCount(0);
      await colour(a, "Player 1", "Pink").click();
      await expect(colour(host, "Player 1", "Pink")).toBeChecked();
      // Taking a colour another seat holds hands that seat yours.
      await colour(b, "Player 2", "Pink").click();
      await expect(colour(host, "Player 2", "Pink")).toBeChecked();
      await expect(colour(host, "Player 1", "Blue")).toBeChecked();
      await expect(colour(a, "Player 1", "Blue")).toBeChecked();
      await sideBySide(context, host, b, `${label}-08-seat-colours`);
    });

    test("the host refuses a phone's edits to another player", async ({
      context,
    }) => {
      const { host, guest, code } = await setUp(context, phoneSized, "arcs");
      for (const command of [
        { type: "RENAME_PLAYER", playerIndex: 0, name: "Mallory" },
        { type: "SET_SEAT_COLOR", playerIndex: 0, colorId: "pink" },
      ])
        expect(await forge(guest, code, 3, command)).toMatchObject({
          ok: false,
          reason: "You can only edit your own player",
        });
      expect(await hostNames(host)).toContain("Player 1");
    });

    test("the host refuses seat commands from a phone without a seat", async ({
      context,
    }) => {
      const { host, guest, code } = await setUp(context, phoneSized);
      for (const command of [
        { type: "RENAME_PLAYER", playerIndex: 0, name: "Mallory" },
        { type: "ADD_SEAT" },
        { type: "REMOVE_SEAT", playerIndex: 3 },
        { type: "REORDER_SEATS", playerIndex: 3, toIndex: 0 },
      ])
        expect(await forge(guest, code, null, command)).toMatchObject({
          ok: false,
          reason: "Claim a seat first",
        });
      // A seated phone cannot take another phone's seat away either.
      expect(
        await forge(guest, code, 3, { type: "REMOVE_SEAT", playerIndex: 1 }),
      ).toMatchObject({
        ok: false,
        reason: "Another phone has claimed that seat",
      });
      expect(await hostNames(host)).toEqual([
        "Player 1",
        "Player 2",
        "Player 3",
        "Player 4",
      ]);
    });

    test("phones rename players mid-game without advancing the turn", async ({
      context,
    }) => {
      test.setTimeout(120_000);
      const { host, a, b } = await setUp(context, phoneSized);
      await seatName(a, 1).fill("Ada");
      await seatName(a, 1).press("Enter");
      await expect.poll(() => hostNames(host)).toContain("Ada");
      await navigateToScreen(host, /^Priority$/);
      await host.getByRole("button", { name: "Ada", exact: true }).click();
      await host.getByRole("button", { name: /start game/i }).click();
      await host.getByRole("button", { name: "Advance turn" }).click();
      const banner = (page: Page, name: string) =>
        page.getByText(new RegExp(`^${name}’s turn$`));
      await expect(banner(host, "Ada")).toBeVisible({ timeout: 15_000 });
      // The claims carried from setup into the game.
      const yourName = (page: Page) =>
        page.getByRole("textbox", { name: "Your name" });
      await expect(yourName(a)).toHaveAttribute("placeholder", "Ada");
      await expect(yourName(b)).toHaveAttribute("placeholder", "Player 2");
      // The clock is running on Ada's opening turn, and renaming must not
      // end it: her phone can end it, the other phone waits.
      const turnStaysWithAda = async () => {
        await expect(
          a.getByRole("button", { name: "End my turn" }),
        ).toBeEnabled();
        await expect(
          b.getByRole("button", { name: /^Waiting for your turn/ }),
        ).toBeDisabled();
      };
      await turnStaysWithAda();

      // Each phone renames itself from the players sheet, where the
      // other players' names are shown but not editable. The name goes
      // to the host when the field is left, here by tapping Done.
      const renameSelf = async (page: Page, seat: number, name: string) => {
        await page.getByRole("button", { name: "Rename players" }).click();
        const sheet = page.getByRole("dialog", { name: "Players" });
        await expect(sheet.getByRole("textbox")).toHaveCount(1);
        await sheet
          .getByRole("textbox", { name: `Seat ${seat} name` })
          .fill(name);
        await sideBySide(
          context,
          host,
          page,
          `${label}-06-mid-game-sheet-seat-${seat}`,
        );
        await sheet.getByRole("button", { name: "Done" }).click();
      };
      await renameSelf(a, 1, "Ada L");
      await expect(banner(host, "Ada L")).toBeVisible();
      await expect(banner(b, "Ada L")).toBeVisible();
      await renameSelf(b, 2, "Bo");
      await expect(yourName(b)).toHaveAttribute("placeholder", "Bo");
      await turnStaysWithAda();

      // The host shows the names in its own players sheet and renames
      // from it; the phones follow and the turn stays put.
      // The header bar's button, not the open turn order's Players tab.
      await host
        .getByRole("banner")
        .getByRole("button", { name: "Players", exact: true })
        .click();
      const hostSheet = host.getByRole("dialog", { name: "Players" });
      const hostSeat2 = hostSheet.getByRole("textbox", { name: "Seat 2 name" });
      await expect(hostSeat2).toHaveValue("Bo");
      await hostSeat2.fill("Bodhi");
      await hostSeat2.press("Enter");
      await hostSheet.getByRole("button", { name: "Done" }).click();
      await expect(yourName(b)).toHaveAttribute("placeholder", "Bodhi");
      await expect(banner(host, "Ada L")).toBeVisible();
      await turnStaysWithAda();
      await sideBySide(context, host, b, `${label}-07-host-renamed`);
      await saveVideo(b, `mid-game-rename-${label}`);
    });
  });
}
