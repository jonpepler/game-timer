import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionSession } from "@/lib/peer";
import type { TurnOrder } from "@/state/gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionState,
} from "@/state/gameSession";
import { PEER_PROTOCOL_VERSION } from "@/state/peerProtocol";
import { projectCommand, type SessionCommand } from "@/state/sessionCommands";
import CompanionPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("code=TURNS"),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/companion",
}));

/*
 * A phone can do what the host's turn controls do: end the opening turn
 * and a turn no seat owns, undo, pause and resume the clock, and change
 * the turns left. Drives the page through the fake transport seam the
 * e2e suite also uses.
 */

let messageHandler: ((data: unknown) => void) | null = null;
let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  messageHandler = null;
  send = vi.fn();
  const session: CompanionSession = {
    hostCode: "TURNS",
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

// What a current host sends beside the game state; an older host sends
// neither field.
interface HostExtras {
  canUndo?: boolean;
  paused?: boolean;
}

const pushState = (state: GameSessionState, extras: HostExtras = {}) =>
  receive({
    type: "STATE",
    protocolVersion: PEER_PROTOCOL_VERSION,
    state,
    sentAt: 0,
    ...extras,
  });

const sentCommands = () =>
  send.mock.calls
    .map(([m]) => m)
    .filter((m) => m?.type === "COMMAND")
    .map((m) => m.command);

const players = [
  { name: "Ada", metadata: {} },
  { name: "Bo", metadata: {} },
];

// Seats take turns in "open"; "shared" runs one entry no seat owns.
const ORDER: TurnOrder = {
  mode: "variable",
  entryKinds: [{ id: "k", label: "Kind" }],
  entries: [{ id: "s", label: "Common", kind: "k", inPlay: false }],
  lists: [
    { id: "seats", label: "Seats", includePlayers: true },
    { id: "shared", label: "Shared", kinds: ["k"] },
  ],
  phases: [
    { id: "open", label: "Open", list: "seats", next: "shared" },
    { id: "shared", label: "Shared", list: "shared", next: "open" },
  ],
};

const run = (state: GameSessionState, ...commands: SessionCommand[]) =>
  commands.reduce((s, c) => projectCommand(s, c, 0), state);

// The clock started and no turn recorded yet: Ada's opening turn.
const opening = (withPlayers = true): GameSessionState =>
  run(
    createInitialGameSessionState({
      initialAverageSeconds: 300,
      expectedTurns: 10,
      ...(withPlayers ? { players } : {}),
    }),
    { type: "END_TURN" },
  );

// One turn recorded, so Bo is up.
const roundRobin = (): GameSessionState => run(opening(), { type: "END_TURN" });

const LIVE: HostExtras = { canUndo: true, paused: false };

const connect = async (state: GameSessionState, extras: HostExtras) => {
  const user = userEvent.setup();
  render(<CompanionPage />);
  await waitFor(() => expect(messageHandler).not.toBeNull());
  pushState(state, extras);
  return user;
};

const seatedOnAda = async (
  state: GameSessionState,
  extras: HostExtras = LIVE,
) => {
  const user = await connect(state, extras);
  const claimPanel = screen.getByText("Claim a player").parentElement;
  if (!claimPanel) throw new Error("no claim panel");
  await user.click(within(claimPanel).getByRole("button", { name: /Ada/ }));
  return user;
};

describe("companion turn controls", () => {
  it("ends the opening turn once the host has started the clock", async () => {
    const state = opening();
    const user = await seatedOnAda(state);
    await user.click(screen.getByRole("button", { name: "End my turn" }));
    expect(sentCommands()).toEqual([{ type: "END_TURN", atTurn: 0 }]);
  });

  it("ends a turn no seat owns", async () => {
    const shared = run(
      createInitialGameSessionState({
        initialAverageSeconds: 300,
        expectedTurns: 10,
        players,
        turnOrder: ORDER,
      }),
      { type: "END_TURN" },
      { type: "ACTIVATE_ENTRY", entryId: "s", playerIndex: null },
      { type: "END_TURN" },
      { type: "SET_PHASE", phaseId: "shared" },
    );
    const user = await seatedOnAda(shared);
    await user.click(screen.getByRole("button", { name: "End Common’s turn" }));
    expect(sentCommands()).toEqual([
      { type: "END_TURN", atTurn: shared.turns.length },
    ]);
  });

  it("waits while another seat owns the turn", async () => {
    await seatedOnAda(roundRobin());
    expect(
      screen.getByRole("button", { name: /Waiting for your turn/ }),
    ).toBeDisabled();
  });

  it("undoes once per tap, citing the state the host last sent", async () => {
    const state = roundRobin();
    const user = await seatedOnAda(state);
    const undo = screen.getByRole("button", { name: "Undo" });
    await user.click(undo);
    expect(sentCommands()).toEqual([
      { type: "UNDO", atRevision: state.revision },
    ]);
    // Locked until the host's state moves, so a double tap is one undo.
    expect(undo).toBeDisabled();
    await user.click(undo);
    expect(sentCommands()).toHaveLength(1);

    const undone = run(state, { type: "UNDO" });
    pushState(undone, LIVE);
    await waitFor(() => expect(undo).toBeEnabled());
    await user.click(undo);
    expect(sentCommands()).toEqual([
      { type: "UNDO", atRevision: state.revision },
      { type: "UNDO", atRevision: undone.revision },
    ]);
  });

  it("frees Undo again when the host refuses it", async () => {
    const user = await seatedOnAda(roundRobin());
    await user.click(screen.getByRole("button", { name: "Undo" }));
    const [sent] = send.mock.calls
      .map(([m]) => m)
      .filter((m) => m?.type === "COMMAND");
    receive({
      type: "COMMAND_RESULT",
      protocolVersion: PEER_PROTOCOL_VERSION,
      commandId: sent.commandId,
      ok: false,
      reason: "That changed on another device",
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(
      screen.getByText("Not applied: That changed on another device"),
    ).toBeInTheDocument();
  });

  it("pauses and resumes the host's clock", async () => {
    const state = roundRobin();
    const user = await seatedOnAda(state);
    await user.click(screen.getByRole("button", { name: "Pause timer" }));
    expect(sentCommands()).toEqual([{ type: "SET_PAUSED", paused: true }]);

    pushState(state, { ...LIVE, paused: true });
    await user.click(
      await screen.findByRole("button", { name: "Resume timer" }),
    );
    expect(sentCommands()).toEqual([
      { type: "SET_PAUSED", paused: true },
      { type: "SET_PAUSED", paused: false },
    ]);
  });

  it("changes the turns left", async () => {
    const state = roundRobin();
    const user = await seatedOnAda(state);
    await user.click(screen.getByRole("button", { name: "One turn more" }));
    await user.click(screen.getByRole("button", { name: "One turn fewer" }));
    // 9 left of 10 after one turn.
    expect(sentCommands()).toEqual([
      { type: "SET_EXPECTED_TURNS", expectedTurns: 11 },
      { type: "SET_EXPECTED_TURNS", expectedTurns: 9 },
    ]);
  });

  it("offers neither Undo nor the clock against a host that does not share them", async () => {
    await seatedOnAda(roundRobin(), {});
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Pause timer|Resume timer/ }),
    ).not.toBeInTheDocument();
  });

  it("acts for the table without a seat when the game tracks no players", async () => {
    const state = run(opening(false), { type: "END_TURN" });
    const user = await connect(state, LIVE);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Pause timer" }));
    await user.click(screen.getByRole("button", { name: "One turn more" }));
    expect(sentCommands()).toEqual([
      { type: "UNDO", atRevision: state.revision },
      { type: "SET_PAUSED", paused: true },
      { type: "SET_EXPECTED_TURNS", expectedTurns: 11 },
    ]);
  });
});
