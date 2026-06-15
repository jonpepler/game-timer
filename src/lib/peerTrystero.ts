/*
 * Trystero-backed transport — a spike alternative to ./peer (PeerJS).
 *
 * Implements the exact HostSession / CompanionSession contract from
 * ./peer so the hooks and pages need no changes. Which transport is
 * live is decided at build time in ./peerTransport via the
 * NEXT_PUBLIC_USE_TRYSTERO flag.
 *
 * Why bother: PeerJS leans on a central broker that hands out peer
 * ids. After a phone suspends/closes the tab the data channel dies,
 * and reconnecting means redialling a *specific* peer id — which
 * frequently lands on "peer-unavailable". Trystero is room-based: a
 * peer rejoins a room by name and the relay layer re-pairs everyone
 * automatically (it also auto-reconnects its relay sockets). That is
 * the reconnection win we're testing.
 *
 * Infra: this uses the Nostr strategy. Public Nostr relays broker the
 * WebRTC handshake *only* (SDP + ICE); once peers are paired, traffic
 * is direct P2P. We host nothing. TURN/relay slots exist in ROOM_CONFIG
 * but are intentionally left empty per the no-infra constraint.
 *
 * Mesh caveat: a Trystero room is a full mesh — host + every companion
 * are mutual peers. To keep the host/companion model, the host
 * announces its role to each newcomer (ACTION_ROLE); companions then
 * target their messages at the host id rather than broadcasting to the
 * whole room.
 *
 * API note: written against trystero@0.25.x, whose room API uses
 * settable handler properties (room.onPeerJoin = fn) and action objects
 * ({ send, onMessage }) — not the older tuple/callback style.
 */
import type {
  DataPayload,
  JoinRoomConfig,
  MessageAction,
  Room,
} from "trystero/nostr";
import { createLogger } from "./logger";
import type {
  CompanionConnectionState,
  CompanionSession,
  ConnectToHostOptions,
  CreateHostOptions,
  HostSession,
} from "./peer";

const log = createLogger("peer-trystero");

// Namespacing — mirrors PEER_BROKER_KEY in ./peer. Rooms under
// different appIds never discover each other even with the same id.
const APP_ID = "game-timer";

// Trystero action names are capped at 12 bytes.
const ACTION_MSG = "msg";
const ACTION_ROLE = "role";

// Single place to tune discovery + ICE. `relayConfig.urls` pins
// specific Nostr relays; `turnConfig` / `rtcConfig` would add a TURN
// server — left empty on purpose (no infra). manualReconnection is off,
// so Trystero auto-reconnects its relay sockets.
const ROOM_CONFIG: JoinRoomConfig = { appId: APP_ID };

// Lazy, client-only load. A static import would pull Trystero (and its
// WebSocket/window refs) into the SSR/prerender pass of the static
// export; deferring it keeps the server bundle clean and matches the
// fact that a session is only ever started from a click in the browser.
// Types come from the top-level `import type` (erased), so tsc still
// fully checks our usage against Trystero's real API.
const loadTrystero = () => import("trystero/nostr");

// Our protocol messages are JSON objects (a subset of DataPayload), but
// the transport contract types `send` as (data: unknown). This narrows
// at the single outbound boundary — not ingested JSON, so no schema.
const asPayload = (data: unknown): DataPayload => data as DataPayload;

// Trystero's Nostr strategy uses Web Crypto (crypto.subtle) to derive
// room keys. Browsers only expose crypto.subtle in a *secure context* —
// HTTPS or localhost. Over a plain-http LAN URL (e.g. testing on a phone
// at http://192.168.x.x) it's undefined and joinRoom throws deep inside
// ("reading 'importKey'"). Fail early with a message the error UI shows
// (describePeerError passes Error.message through) instead of crashing.
// PeerJS doesn't hit this — only WebRTC, which works on insecure origins.
const assertSecureContext = () => {
  if (typeof window === "undefined") return;
  if (!window.isSecureContext || !window.crypto?.subtle) {
    throw new Error(
      "Sharing needs a secure connection (HTTPS or localhost). A plain http:// address over the local network won't work on a phone — use an HTTPS dev URL (e.g. a tunnel) or the deployed site.",
    );
  }
};

/*
 * Ref-counted room manager. Trystero allows only ONE live instance of a
 * given room per tab — a second joinRoom() for the same id shares relay
 * state, so leaving one orphans the other. React StrictMode (dev) mounts
 * effects twice, which would otherwise do exactly that. We therefore
 * join each room once and hand out shared handles; the room is only left
 * when the last holder releases it. makeAction is likewise called once
 * per (room, name) since Trystero rejects duplicate action namespaces.
 */
interface RoomEntry {
  room: Room;
  refs: number;
  actions: Map<string, MessageAction>;
}
type JoinRoomFn = typeof import("trystero/nostr")["joinRoom"];
const liveRooms = new Map<string, RoomEntry>();

const acquireRoom = (roomId: string, joinRoom: JoinRoomFn): RoomEntry => {
  const existing = liveRooms.get(roomId);
  if (existing) {
    existing.refs++;
    return existing;
  }
  const entry: RoomEntry = {
    room: joinRoom(ROOM_CONFIG, roomId),
    refs: 1,
    actions: new Map(),
  };
  liveRooms.set(roomId, entry);
  return entry;
};

const releaseRoom = (roomId: string) => {
  const entry = liveRooms.get(roomId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    liveRooms.delete(roomId);
    void entry.room.leave();
  }
};

const action = (entry: RoomEntry, name: string): MessageAction => {
  const existing = entry.actions.get(name);
  if (existing) return existing;
  const made = entry.room.makeAction(name);
  entry.actions.set(name, made);
  return made;
};

// Test seam: identical to ./peer. Playwright multi-page tests inject a
// BroadcastChannel-based fake at window.__PEER_TEST_FACTORY so the e2e
// suite keeps working whichever transport is selected.
interface PeerTestFactory {
  createHost: (options: CreateHostOptions) => Promise<HostSession>;
  connectToHost: (
    hostCode: string,
    options: ConnectToHostOptions,
  ) => Promise<CompanionSession>;
}
const getTestFactory = (): PeerTestFactory | null => {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { __PEER_TEST_FACTORY?: PeerTestFactory })
      .__PEER_TEST_FACTORY ?? null
  );
};

export async function createHost(
  options: CreateHostOptions = {},
): Promise<HostSession> {
  const testFactory = getTestFactory();
  if (testFactory) return testFactory.createHost(options);
  assertSecureContext();

  // The room id *is* the session code. No broker hands these out, so
  // the "unavailable-id" collision dance in useSessionHost simply never
  // fires (createHost never rejects with that). Two hosts picking the
  // same 4-char code would share a room — see the spike notes.
  const roomId = options.desiredId ?? "gtmr-host";
  const { joinRoom } = await loadTrystero();
  const entry = acquireRoom(roomId, joinRoom);
  const room = entry.room;

  const peers = new Set<string>();
  const connectHandlers = new Set<(peerId: string) => void>();
  const disconnectHandlers = new Set<(peerId: string) => void>();
  const messageHandlers = new Set<(peerId: string, data: unknown) => void>();

  const msgAction = action(entry, ACTION_MSG);
  const roleAction = action(entry, ACTION_ROLE);

  msgAction.onMessage = (data, ctx) => {
    messageHandlers.forEach((h) => {
      h(ctx.peerId, data);
    });
  };

  room.onPeerJoin = (peerId) => {
    peers.add(peerId);
    log.info("companion joined", { peerId });
    // Tell the newcomer (or a silently re-paired companion) that we are
    // the host, so it can target us and ignore other companions.
    void roleAction.send({ host: true }, { target: peerId });
    // Drives the host page's broadcast-on-connect (full STATE + seating),
    // which is what re-syncs a returning companion.
    connectHandlers.forEach((h) => {
      h(peerId);
    });
  };
  room.onPeerLeave = (peerId) => {
    if (peers.delete(peerId)) {
      log.info("companion left", { peerId });
      disconnectHandlers.forEach((h) => {
        h(peerId);
      });
    }
  };

  log.info("host room joined", { sessionCode: roomId });

  return {
    sessionCode: roomId,
    send: (data) => {
      // Broadcast to every companion in the room.
      void msgAction.send(asPayload(data));
    },
    onConnect: (h) => {
      connectHandlers.add(h);
      return () => {
        connectHandlers.delete(h);
      };
    },
    onDisconnect: (h) => {
      disconnectHandlers.add(h);
      return () => {
        disconnectHandlers.delete(h);
      };
    },
    onMessage: (h) => {
      messageHandlers.add(h);
      return () => {
        messageHandlers.delete(h);
      };
    },
    connections: () => Array.from(peers),
    close: () => {
      log.info("host room left", { sessionCode: roomId });
      releaseRoom(roomId);
    },
  };
}

export async function connectToHost(
  hostCode: string,
  options: ConnectToHostOptions = {},
): Promise<CompanionSession> {
  const testFactory = getTestFactory();
  if (testFactory) return testFactory.connectToHost(hostCode, options);
  assertSecureContext();

  const roomId = hostCode;
  const { joinRoom, selfId } = await loadTrystero();

  const messageHandlers = new Set<(data: unknown) => void>();
  const closeHandlers = new Set<() => void>();
  const stateHandlers = new Set<(state: CompanionConnectionState) => void>();
  // Buffer host messages that arrive before the caller attaches its
  // onMessage handler (it does so in a .then after we resolve, while the
  // host may broadcast immediately on our join). Mirrors ./peer.
  const pendingMessages: unknown[] = [];
  let lastState: CompanionConnectionState = "reconnecting";
  let hostId: string | null = null;
  let destroyed = false;

  const emitState = (next: CompanionConnectionState) => {
    if (next === lastState) return;
    lastState = next;
    stateHandlers.forEach((h) => {
      h(next);
    });
  };

  // `msgAction` is swapped on a forced rejoin, so the caller's send()
  // closure reads it through this mutable binding rather than capturing a
  // dead room (same reasoning as currentConn in ./peer).
  let msgAction: MessageAction;

  const bindRoom = (entry: RoomEntry) => {
    const msg = action(entry, ACTION_MSG);
    const role = action(entry, ACTION_ROLE);
    msgAction = msg;

    msg.onMessage = (data) => {
      if (messageHandlers.size === 0) {
        pendingMessages.push(data);
      } else {
        messageHandlers.forEach((h) => {
          h(data);
        });
      }
    };

    role.onMessage = (info, ctx) => {
      if (
        info &&
        typeof info === "object" &&
        (info as { host?: unknown }).host
      ) {
        hostId = ctx.peerId;
        log.info("host identified — connected", { hostId });
        emitState("connected");
      }
    };

    entry.room.onPeerLeave = (peerId) => {
      if (peerId === hostId) {
        log.warn("host left — awaiting re-pair");
        hostId = null;
        emitState(destroyed ? "closed" : "reconnecting");
      }
    };
  };

  bindRoom(acquireRoom(roomId, joinRoom));

  // Mobile suspend safety net. Trystero usually re-pairs on its own once
  // its relay socket reconnects, but if we return to the foreground
  // still isolated (no host id), tear the room down and rejoin fresh to
  // force rediscovery. selfId is stable across this, so the host re-pairs
  // us to the same identity and our persisted seat claim still matches.
  const rejoin = () => {
    if (destroyed || hostId) return;
    log.info("companion forcing room rejoin", { roomId });
    releaseRoom(roomId);
    hostId = null;
    bindRoom(acquireRoom(roomId, joinRoom));
  };
  const onVisible = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    rejoin();
  };
  const onOnline = () => {
    rejoin();
  };
  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
  }

  return {
    hostCode,
    peerId: selfId,
    send: (data) => {
      // Target the host directly when known, so other companions in the
      // mesh don't receive host-bound traffic. Fall back to broadcast in
      // the brief window before the host's role announce arrives.
      void msgAction.send(
        asPayload(data),
        hostId ? { target: hostId } : undefined,
      );
    },
    onMessage: (h) => {
      messageHandlers.add(h);
      if (pendingMessages.length > 0) {
        const buffered = pendingMessages.splice(0);
        buffered.forEach((msg) => {
          h(msg);
        });
      }
      return () => {
        messageHandlers.delete(h);
      };
    },
    onClose: (h) => {
      closeHandlers.add(h);
      return () => {
        closeHandlers.delete(h);
      };
    },
    onConnectionStateChange: (h) => {
      stateHandlers.add(h);
      // Replay current state so a late subscriber sees where we are.
      h(lastState);
      return () => {
        stateHandlers.delete(h);
      };
    },
    close: () => {
      log.info("companion leaving room", { hostCode });
      destroyed = true;
      emitState("closed");
      if (typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onOnline);
      }
      releaseRoom(roomId);
    },
  };
}

// Trystero surfaces failures as plain Errors / JoinError details rather
// than the typed taxonomy PeerJS uses, so this is intentionally coarse.
// Kept for interface parity with ./peer's describePeerError.
export function describePeerError(err: unknown): string {
  if (err instanceof Error && err.message) {
    if (/relay|websocket|network/i.test(err.message))
      return "Lost the connection to the sharing service. Retrying.";
    return err.message;
  }
  return "Couldn't connect. Retrying in the background.";
}
