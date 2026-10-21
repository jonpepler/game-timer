import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionSession } from "@/lib/peer";
import type { GameSessionState } from "@/state/gameSession";
import { PEER_PROTOCOL_VERSION } from "@/state/peerProtocol";
import CompanionPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("code=NAMES"),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/companion",
}));

/*
 * A seated phone edits its own player only, and a name goes to the host
 * once when it is submitted rather than on every keystroke. Drives the
 * page through the fake transport seam the e2e suite also uses.
 */

let messageHandler: ((data: unknown) => void) | null = null;
let send: ReturnType<typeof vi.fn>;

const game: GameSessionState = {
  started: true,
  turns: [],
  averageSeconds: 300,
  initialAverageSeconds: 300,
  expectedTurns: 10,
  players: [
    { name: "Ada", metadata: {} },
    { name: "Bo", metadata: {} },
  ],
  currentTurnStartedAt: null,
  scores: {},
  victor: null,
  firedMilestones: {},
  pendingMilestones: [],
};

beforeEach(() => {
  window.localStorage.clear();
  messageHandler = null;
  send = vi.fn();
  const session: CompanionSession = {
    hostCode: "NAMES",
    peerId: "phone-a",
    send,
    reconnect: vi.fn(),
    onMessage: (h) => {
      messageHandler = h;
      return () => {};
    },
    onClose: () => () => {},
    onConnectionStateChange: (h) => {
      h("connected");
      return () => {};
    },
    close: () => {},
  };
  (window as unknown as { __PEER_TEST_FACTORY?: unknown }).__PEER_TEST_FACTORY =
    {
      createHost: () => {
        throw new Error("host not used in this test");
      },
      connectToHost: async () => session,
    };
});

afterEach(() => {
  (window as unknown as { __PEER_TEST_FACTORY?: unknown }).__PEER_TEST_FACTORY =
    undefined;
});

// The host pushes state from outside React's event system, so the
// transport callback is the one place act() is needed.
const receive = (data: unknown) =>
  act(() => {
    messageHandler?.(data);
  });

const renames = () =>
  send.mock.calls
    .map(([m]) => m)
    .filter((m) => m?.type === "COMMAND" && m.command.type === "RENAME_PLAYER")
    .map((m) => m.command);

const seatedOnAda = async () => {
  const user = userEvent.setup();
  render(<CompanionPage />);
  await waitFor(() => expect(messageHandler).not.toBeNull());
  receive({
    type: "STATE",
    protocolVersion: PEER_PROTOCOL_VERSION,
    state: game,
    sentAt: 0,
  });
  const claimPanel = screen.getByText("Claim a player").parentElement;
  if (!claimPanel) throw new Error("no claim panel");
  await user.click(within(claimPanel).getByRole("button", { name: /Ada/ }));
  return user;
};

describe("companion player editing", () => {
  it("sends its own name once, when submitted", async () => {
    const user = await seatedOnAda();
    const yourName = screen.getByRole("textbox", { name: "Your name" });
    await user.type(yourName, "Ada Lovelace");
    expect(renames()).toEqual([]);
    await user.keyboard("{Enter}");
    expect(renames()).toEqual([
      { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada Lovelace" },
    ]);
  });

  it("offers a name field for its own player only", async () => {
    const user = await seatedOnAda();
    await user.click(screen.getByRole("button", { name: "Rename players" }));
    const sheet = screen.getByRole("dialog", { name: "Players" });
    expect(within(sheet).getAllByRole("textbox")).toEqual([
      within(sheet).getByRole("textbox", { name: "Seat 1 name" }),
    ]);
    expect(sheet).toHaveTextContent("Bo");
    const mine = within(sheet).getByRole("textbox", { name: "Seat 1 name" });
    await user.clear(mine);
    await user.type(mine, "Ada L");
    expect(renames()).toEqual([]);
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(renames()).toEqual([
      { type: "RENAME_PLAYER", playerIndex: 0, name: "Ada L" },
    ]);
  });
});
