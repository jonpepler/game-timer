import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEER_PROTOCOL_VERSION } from "@/state/peerProtocol";
import type { CompanionConnectionState, CompanionSession } from "@/lib/peer";
import type { GameSessionState } from "@/state/gameSession";
import CompanionPage from "./page";

// The page reads the session code from the URL.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("code=TEST"),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/companion",
}));

/*
 * Connection-status UX. Asserts the companion's *display* status (the
 * derived one driving the header), not the raw transport status:
 *
 *   - Through the whole first sync — relay presence landing, the STATE
 *     pull, and a dead-channel recovery that flips the transport back to
 *     "reconnecting" — the header stays a single steady "Connecting…".
 *     This is the no-flicker guarantee (no green→grey→green).
 *   - Once a snapshot has arrived, the real status shows honestly, so a
 *     genuine mid-game drop surfaces as "Reconnecting…".
 *   - After a while still unsynced, the body escalates to a hint.
 *
 * Drives a hand-controlled fake transport via window.__PEER_TEST_FACTORY
 * (the same seam the e2e BroadcastChannel fake uses), so we can fire
 * connection-state transitions and inbound messages at will. Every fire
 * is wrapped in act() so there are no "update not wrapped in act"
 * warnings.
 */

// Captured handlers the hook registers on our fake session, so the test
// can drive transitions.
let stateHandler: ((s: CompanionConnectionState) => void) | null = null;
let messageHandler: ((data: unknown) => void) | null = null;

const makeState = (): GameSessionState => ({
  started: true,
  turns: [],
  averageSeconds: 300,
  initialAverageSeconds: 300,
  expectedTurns: 10,
  players: [
    { name: "Player 1", metadata: {} },
    { name: "Player 2", metadata: {} },
  ],
  currentTurnStartedAt: null,
  scores: {},
  victor: null,
  firedMilestones: {},
  pendingMilestones: [],
});

// Spy on console.error (where React routes "update not wrapped in
// act(...)" warnings) — still printing through — so afterEach can fail
// the test if any act warning slipped out.
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error");
  stateHandler = null;
  messageHandler = null;
  const session: CompanionSession = {
    hostCode: "TEST",
    peerId: "comp-test",
    send: vi.fn(),
    reconnect: vi.fn(),
    onMessage: (h) => {
      messageHandler = h;
      return () => {};
    },
    onClose: () => () => {},
    onConnectionStateChange: (h) => {
      stateHandler = h;
      // Replay current state on subscribe, mirroring the real session:
      // relay presence is live ("connected") but no data has arrived.
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
  const actWarnings = errorSpy.mock.calls.filter((c) =>
    String(c[0]).includes("not wrapped in act"),
  );
  errorSpy.mockRestore();
  (window as unknown as { __PEER_TEST_FACTORY?: unknown }).__PEER_TEST_FACTORY =
    undefined;
  vi.useRealTimers();
  expect(actWarnings).toEqual([]);
});

// Fire a transport-originated update. The transport pushes to us from
// outside React's event system (a socket-style callback), and there's no
// fireEvent/userEvent equivalent for that — wrapping the external trigger
// in act() is the React-docs-sanctioned pattern. Sync act suffices: the
// handlers are synchronous and act flushes the resulting render+effects
// before returning, so assertions can follow immediately.
const emitState = (s: CompanionConnectionState) =>
  act(() => {
    stateHandler?.(s);
  });

const emitMessage = (data: unknown) =>
  act(() => {
    messageHandler?.(data);
  });

const stateMessage = () => ({
  type: "STATE" as const,
  protocolVersion: PEER_PROTOCOL_VERSION,
  state: makeState(),
  sentAt: 0,
});

describe("companion connection-status UX", () => {
  it("holds a steady 'Connecting…' through first-sync churn, then reports honestly once synced", async () => {
    const { container } = render(<CompanionPage />);
    const text = () => container.textContent ?? "";
    // Let the mount's connectToHost promise settle (it registers the
    // transport handlers we drive below). waitFor flushes the pending
    // update inside act for us — no manual act() around render.
    await waitFor(() => expect(stateHandler).not.toBeNull());

    // Phase 1: relay presence up, no data → steady "Connecting…".
    expect(text()).toContain("Connecting to");
    expect(text()).toContain("Setting up your connection");
    expect(text()).not.toContain("Reconnecting to");
    expect(text()).not.toContain("Connected to");

    // Phase 2: a dead-channel recovery flips the transport to
    // "reconnecting" — but we haven't synced, so the user must still see
    // one continuous "Connecting…", NOT a flicker to "Reconnecting…".
    emitState("reconnecting");
    expect(text()).toContain("Connecting to");
    expect(text()).not.toContain("Reconnecting to");

    // Phase 3: re-paired and the first snapshot lands → now "Connected".
    emitState("connected");
    emitMessage(stateMessage());
    expect(text()).toContain("Connected to");
    expect(text()).not.toContain("Connecting to");
    expect(text()).not.toContain("Setting up your connection");

    // Phase 4: a genuine mid-game drop, now that we've synced, surfaces
    // honestly as "Reconnecting…".
    emitState("reconnecting");
    expect(text()).toContain("Reconnecting to");
  });

  it("escalates the body hint after a stretch with no snapshot", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionPage />);
    const text = () => container.textContent ?? "";
    // Flush the pending connectToHost promise inside act. With fake
    // timers the async RTL helpers can't cleanly drain a microtask, so an
    // explicit act flush is the honest tool — without it the mount's
    // resolve would later fire a state update outside act.
    await act(async () => {});

    expect(text()).toContain("Setting up your connection");

    // Still no snapshot after ~12s → gentle hint, without giving up.
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(text()).toContain("Still connecting");
    expect(text()).not.toContain("Setting up your connection");
  });
});
