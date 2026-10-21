import path from "node:path";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { PEER_TEST_INIT_SCRIPT } from "./_peer-test-injection";
import { navigateToScreen } from "./_setup-helpers";
import {
  expectCompanies,
  expectPresident,
} from "./games/railways/railways.helpers";

/*
 * Companion parity on Railways of the Lost Atlas: everything the host
 * can do to the turn order, a seated phone can do too, through the same
 * command path. Two companions (seats 1 and 2) found companies, change a
 * share price, reassign a president, end the Stock Round and answer its
 * prompts, merge two companies and answer the round prompt. The host
 * reflects each one. A companion cannot end a company's turn it does not
 * preside over, even with a forged message.
 *
 * Set COMPANION_PARITY_EVIDENCE_DIR to save side-by-side host and phone
 * screenshots for each action and a video of a phone founding and
 * merging.
 */

const EVIDENCE_DIR = process.env.COMPANION_PARITY_EVIDENCE_DIR;

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

const showCompanies = async (page: Page) => {
  await page.getByRole("button", { name: "Companies", exact: true }).click();
};

const companies = (page: Page) => page.getByRole("list", { name: "Companies" });

const phaseStatus = (page: Page) =>
  page.getByRole("button", { name: /^End / }).locator("..");

const versionAlert = (page: Page) =>
  page.getByRole("alert").filter({ hasText: /different versions? of Game/ });

const banner = (page: Page, name: string) =>
  page.getByText(new RegExp(`^${name}’s turn$`));

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

/**
 * Host plus two companions claiming seats 1 and 2, a Railways game with
 * Player 2 holding priority, clock started.
 */
const setUp = async (context: BrowserContext, phoneSized: boolean) => {
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

  await host.getByLabel(/^Game$/).selectOption("railways");
  await navigateToScreen(host, /^Seat players$/i);
  for (const [page, seat] of [
    [a, 1],
    [b, 2],
  ] as const) {
    await expect(page.getByText(/take a seat/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: `Claim seat ${seat}` }).click();
    await expect(
      page.getByRole("textbox", { name: `Seat ${seat} name` }),
    ).toBeVisible();
  }
  await navigateToScreen(host, /^Priority$/);
  await host.getByRole("button", { name: "Player 2", exact: true }).click();
  await host.getByRole("button", { name: /start game/i }).click();
  await expect(
    host.getByRole("button", { name: "End Stock Round" }),
  ).toBeVisible({ timeout: 15_000 });
  // Start the clock.
  await host.getByRole("button", { name: "Advance turn" }).click();
  for (const page of [a, b])
    await expect(
      page.getByRole("button", { name: "End Stock Round" }),
    ).toBeVisible({ timeout: 10_000 });
  return { host, a, b, code };
};

// Found a company from a screen's open add sheet.
const found = async (
  page: Page,
  name: string,
  price: number,
  president: string,
) => {
  await page
    .getByRole("dialog", { name: "Add to Companies" })
    .getByRole("button", { name: `Add ${name}` })
    .click();
  const details = page.getByRole("dialog", { name: `Add ${name}` });
  await details
    .getByRole("button", { name: String(price), exact: true })
    .click();
  await details.getByRole("button", { name: president, exact: true }).click();
  await details.getByRole("button", { name: `Add ${name}` }).click();
  await expect(details).toBeHidden();
};

const actionsFor = async (page: Page, name: string): Promise<Locator> => {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  return sheet;
};

const saveVideo = async (page: Page, name: string) => {
  if (!EVIDENCE_DIR) return;
  const video = page.video();
  await page.close();
  await video?.saveAs(path.join(EVIDENCE_DIR, `${name}.webm`));
};

for (const [label, phoneSized] of [
  ["phone", true],
  ["desktop", false],
] as const) {
  test.describe(`companion parity: ${label}`, () => {
    if (phoneSized)
      test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test("companions found, reprice, reassign, merge and end rounds", async ({
      context,
    }) => {
      test.setTimeout(180_000);
      const { host, a, b } = await setUp(context, phoneSized);
      const evidence = phoneSized ? sideBySide : async () => {};

      // Seat 1's phone founds two companies, each with price and president.
      await showCompanies(a);
      await a.getByRole("button", { name: "Add to Companies" }).click();
      await found(a, "Northern Port", 80, "Player 1");
      await found(a, "Agricultural", 70, "Player 1");
      await a
        .getByRole("dialog", { name: "Add to Companies" })
        .getByRole("button", { name: "Done" })
        .click();
      await showCompanies(host);
      await expectCompanies(host, ["Northern Port 80", "Agricultural 70"]);
      await expectPresident(host, "Northern Port", "Player 1");
      await expectPresident(host, "Agricultural", "Player 1");
      await evidence(context, host, a, "01-companion-founds");

      // Seat 2's phone raises a price: the list re-sorts on the host.
      await showCompanies(b);
      const repriced = await actionsFor(b, "Agricultural");
      await repriced.getByRole("button", { name: "Up to 80" }).click();
      await expectCompanies(host, ["Northern Port 80", "Agricultural 80"]);
      await expectPresident(host, "Northern Port", "Player 1");
      await expectPresident(host, "Agricultural", "Player 1");
      await evidence(context, host, b, "02-companion-changes-value");

      // And makes itself president of it.
      const reassigned = await actionsFor(b, "Agricultural");
      await reassigned
        .getByRole("button", { name: "Player 2", exact: true })
        .click();
      await expectCompanies(host, ["Northern Port 80", "Agricultural 80"]);
      await expectPresident(host, "Northern Port", "Player 1");
      await expectPresident(host, "Agricultural", "Player 2");
      await expectCompanies(a, ["Northern Port 80", "Agricultural 80"]);
      await expectPresident(a, "Northern Port", "Player 1");
      await expectPresident(a, "Agricultural", "Player 2");
      await evidence(context, host, b, "03-companion-reassigns-owner");

      // Seat 1 ends the Stock Round: priority, then the next round kind.
      await a.getByRole("button", { name: "End Stock Round" }).click();
      await expect(a.getByRole("alertdialog")).toHaveAccessibleName(
        "Who has priority now?",
      );
      await evidence(context, host, a, "04-companion-ends-phase-exit-question");
      await a.getByRole("button", { name: "Player 4", exact: true }).click();
      await expect(a.getByRole("alertdialog")).toHaveAccessibleName(
        "End Stock Round?",
      );
      await evidence(context, host, a, "05-companion-ends-phase-next-round");
      await a
        .getByRole("alertdialog")
        .getByRole("button", { name: "Operating Round", exact: true })
        .click();
      await expect(phaseStatus(host)).toHaveText(/^Operating Round/);
      await expect(banner(host, "Northern Port")).toBeVisible();
      await expect(a.getByRole("alertdialog")).toHaveCount(0);
      await expect(
        b.getByRole("button", { name: "End Operating Round" }),
      ).toBeVisible();

      // Northern Port is seat 1's: seat 2 can only wait.
      await expect(
        b.getByRole("button", { name: "Waiting for your turn…" }),
      ).toBeDisabled();
      await a.getByRole("button", { name: "End Northern Port’s turn" }).click();
      await a.getByRole("button", { name: "+1, Share price 90" }).click();
      await expect(banner(host, "Agricultural")).toBeVisible();
      await evidence(context, host, a, "06-companion-ends-own-turn");

      // Seat 1's phone merges the two into a Union under Player 2.
      const merging = await actionsFor(a, "Northern Port");
      await merging.getByRole("button", { name: "Merge", exact: true }).click();
      const merge = a.getByRole("dialog", { name: "Merge" });
      await merge.getByRole("button", { name: /^Agricultural/ }).click();
      await merge.getByRole("button", { name: "Next" }).click();
      await merge.getByRole("button", { name: "Union", exact: true }).click();
      await merge
        .getByRole("button", { name: "Player 2", exact: true })
        .click();
      await evidence(context, host, a, "07-companion-merge-sheet");
      await merge.getByRole("button", { name: "Merge", exact: true }).click();
      await expect(merge).toBeHidden();
      await expectCompanies(host, ["Northern Port Agricultural Union 80*"]);
      await expectPresident(
        host,
        "Northern Port Agricultural Union",
        "Player 2",
      );
      await evidence(context, host, a, "08-companion-merged");

      // The round is over: every screen asks what comes next. Seat 2
      // answers; the prompt closes on seat 1's phone without a tap.
      const prompt = (page: Page) =>
        page.getByRole("alertdialog", { name: "Operating Round complete" });
      await expect(prompt(host)).toBeVisible();
      await expect(prompt(a)).toBeVisible();
      await expect(prompt(b)).toBeVisible();
      await evidence(context, host, b, "09-round-prompt-on-every-screen");
      await b
        .getByRole("button", { name: "Merger Round", exact: true })
        .click();
      await expect(phaseStatus(host)).toHaveText(/^Merger Round/);
      await expect(prompt(host)).toHaveCount(0, { timeout: 10_000 });
      await expect(prompt(a)).toHaveCount(0, { timeout: 10_000 });
      await expect(prompt(b)).toHaveCount(0, { timeout: 10_000 });
      await evidence(context, host, a, "10-prompt-closed-elsewhere");

      await saveVideo(a, "companion-founds-and-merges");
    });

    test("a companion cannot end a turn it does not own", async ({
      context,
    }) => {
      test.setTimeout(120_000);
      const { host, a, b, code } = await setUp(context, phoneSized);
      await showCompanies(a);
      await a.getByRole("button", { name: "Add to Companies" }).click();
      await found(a, "Northern Port", 80, "Player 1");
      await a
        .getByRole("dialog", { name: "Add to Companies" })
        .getByRole("button", { name: "Done" })
        .click();
      await a.getByRole("button", { name: "End Stock Round" }).click();
      await a.getByRole("button", { name: "Player 4", exact: true }).click();
      await a
        .getByRole("alertdialog")
        .getByRole("button", { name: "Operating Round", exact: true })
        .click();
      await expect(banner(host, "Northern Port")).toBeVisible();

      // The UI offers seat 2 nothing to press.
      await expect(
        b.getByRole("button", { name: "Waiting for your turn…" }),
      ).toBeDisabled({ timeout: 10_000 });

      // A forged END_TURN from a peer holding seat 2 is refused with a
      // reason, and the host's turn does not move.
      const result = await b.evaluate(
        async ({ channelName }) => {
          const channel = new BroadcastChannel(channelName);
          const me = "forged-peer";
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
          send({ type: "CLAIM", protocolVersion: 3, playerIndex: 1 });
          await new Promise((r) => setTimeout(r, 300));
          send({
            type: "COMMAND",
            protocolVersion: 3,
            commandId: "forged-1",
            command: { type: "END_TURN", valueStepId: "up-1" },
          });
          return reply;
        },
        { channelName: `peer-test:gtmr-${code}` },
      );
      expect(result).toMatchObject({
        commandId: "forged-1",
        ok: false,
        reason: "It is not your turn",
      });
      await expect(banner(host, "Northern Port")).toBeVisible();
      await expect(
        host.getByRole("dialog", { name: /^End .*’s turn$/ }),
      ).toHaveCount(0);
    });

    test("two phones answering one round prompt apply it once", async ({
      context,
    }) => {
      test.setTimeout(120_000);
      const { host, a, b } = await setUp(context, phoneSized);
      await showCompanies(a);
      await a.getByRole("button", { name: "Add to Companies" }).click();
      await found(a, "Northern Port", 80, "Player 1");
      await a
        .getByRole("dialog", { name: "Add to Companies" })
        .getByRole("button", { name: "Done" })
        .click();
      await a.getByRole("button", { name: "End Stock Round" }).click();
      await a.getByRole("button", { name: "Player 4", exact: true }).click();
      await a
        .getByRole("alertdialog")
        .getByRole("button", { name: "Operating Round", exact: true })
        .click();
      await a.getByRole("button", { name: "End Northern Port’s turn" }).click();
      await a.getByRole("button", { name: "+1, Share price 90" }).click();

      const prompt = (page: Page) =>
        page.getByRole("alertdialog", { name: "Operating Round complete" });
      await expect(prompt(a)).toBeVisible();
      await expect(prompt(b)).toBeVisible();

      // Both tap "Operating Round" in the same instant.
      const tap = (page: Page) =>
        page
          .evaluate(() => {
            const button = Array.from(document.querySelectorAll("button")).find(
              (el) => el.textContent?.trim() === "Operating Round",
            );
            button?.click();
            return button !== undefined;
          })
          .catch(() => false);
      // Usually both taps land before either phone hears back; when one
      // phone hears first, its prompt has already closed.
      const tapped = await Promise.all([tap(a), tap(b)]);
      expect(tapped).toContain(true);

      await expect(phaseStatus(host)).toHaveText(/^Operating Round/);
      for (const page of [host, a, b])
        await expect(prompt(page)).toHaveCount(0, { timeout: 10_000 });
      // Whichever arrived second was refused, and its phone says why.
      const refused = (page: Page) =>
        page.getByRole("status").filter({ hasText: /^Not applied: / });
      await expect
        .poll(
          async () => (await refused(a).count()) + (await refused(b).count()),
        )
        .toBe(tapped.filter(Boolean).length - 1);
      if (tapped.every(Boolean)) {
        const loser = (await refused(a).count()) > 0 ? a : b;
        await expect(refused(loser)).toContainText(
          "The phase already changed on another device",
        );
        if (phoneSized)
          await sideBySide(context, host, loser, "11-race-refused");
      }
    });

    test("the host applies one of two same-instant answers", async ({
      context,
    }) => {
      const { host, b, code } = await setUp(context, phoneSized);
      // Two seated peers send the same phase change in one task, before
      // the host can re-render between them.
      const results = await b.evaluate(
        async ({ channelName }) => {
          const channel = new BroadcastChannel(channelName);
          const replies: unknown[] = [];
          const done = new Promise<unknown[]>((resolve) => {
            channel.addEventListener("message", (ev) => {
              const m = ev.data;
              if (m?.to === "racer-1" && m.data?.type === "COMMAND_RESULT") {
                replies.push(m.data);
                if (replies.length === 2) resolve(replies);
              }
            });
          });
          const post = (from: string, data: unknown) =>
            channel.postMessage({ from, to: "host", type: "data", data });
          for (const [from, seat] of [
            ["racer-1", 0],
            ["racer-2", 2],
          ] as const) {
            channel.postMessage({ from, to: "host", type: "connect" });
            post(from, {
              type: "CLAIM",
              protocolVersion: 3,
              playerIndex: seat,
            });
          }
          await new Promise((r) => setTimeout(r, 300));
          const command = {
            type: "SET_PHASE",
            phaseId: "operating",
            from: { phaseId: "stock", run: 1 },
          };
          post("racer-1", {
            type: "COMMAND",
            protocolVersion: 3,
            commandId: "first",
            command,
          });
          post("racer-2", {
            type: "COMMAND",
            protocolVersion: 3,
            commandId: "second",
            command,
          });
          return done;
        },
        { channelName: `peer-test:gtmr-${code}` },
      );
      expect(results).toEqual([
        expect.objectContaining({ commandId: "first", ok: true }),
        expect.objectContaining({
          commandId: "second",
          ok: false,
          reason: "The phase already changed on another device",
        }),
      ]);
      await expect(phaseStatus(host)).toHaveText(/^Operating Round/);
    });

    test("a stale protocol version is refused visibly", async ({ context }) => {
      const { host, b, code } = await setUp(context, phoneSized);
      await b.evaluate(
        ({ channelName }) => {
          const channel = new BroadcastChannel(channelName);
          channel.postMessage({
            from: "old-peer",
            to: "host",
            type: "connect",
          });
          channel.postMessage({
            from: "old-peer",
            to: "host",
            type: "data",
            data: { type: "END_TURN", protocolVersion: 1 },
          });
        },
        { channelName: `peer-test:gtmr-${code}` },
      );
      await expect(versionAlert(host)).toBeVisible();
      // Companions on the current version are not blamed for it.
      await expect(versionAlert(b)).toHaveCount(0);
    });

    test("a companion facing a newer host asks for a reload", async ({
      context,
    }) => {
      const { host, b } = await setUp(context, phoneSized);
      // The host fans its STATE out over the channel; replay one to the
      // companion stamped with a future version.
      await host.evaluate(() => {
        const send = BroadcastChannel.prototype.postMessage;
        BroadcastChannel.prototype.postMessage = function (m: unknown) {
          const msg = m as { data?: { protocolVersion?: number } };
          if (msg?.data?.protocolVersion !== undefined)
            msg.data.protocolVersion = 99;
          return send.call(this, m);
        };
      });
      await host.getByRole("button", { name: "Advance turn" }).click();
      await expect(versionAlert(b)).toBeVisible();
      // It stops offering actions it can no longer send.
      await expect(
        b.getByRole("button", { name: "End Stock Round" }),
      ).toHaveCount(0);
    });
  });
}
