/*
 * Thin wrapper around PeerJS for the host side of a game session.
 *
 * The companion screen will talk to a HostSession over WebRTC via the
 * public PeerJS broker. We keep the wrapper small + injectable so the
 * tests can drive it with a fake Peer constructor.
 *
 * Wire format note: callers serialize their own messages (the game
 * session action log). This module just shuttles bytes.
 */
import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import { createLogger } from "./logger";

const log = createLogger("peer");

export interface HostSession {
  sessionCode: string;
  send: (data: unknown) => void;
  onConnect(handler: (peerId: string) => void): () => void;
  onDisconnect(handler: (peerId: string) => void): () => void;
  onMessage(handler: (peerId: string, data: unknown) => void): () => void;
  connections(): string[];
  close(): void;
}

export type CompanionConnectionState = "connected" | "reconnecting" | "closed";

export interface CompanionSession {
  // The code of the host this companion is talking to.
  hostCode: string;
  // The companion's own broker peer id — used by the companion to
  // find itself in the host's per-seat `claimedBy[]` array so the
  // claim can follow a seat reorder.
  peerId: string;
  send: (data: unknown) => void;
  onMessage(handler: (data: unknown) => void): () => void;
  onClose(handler: () => void): () => void;
  // Tracks connection lifecycle so the UI can distinguish "connected
  // and working" from "connection dropped, retrying" from "session
  // ended for real". Fires on every transition.
  onConnectionStateChange(
    handler: (state: CompanionConnectionState) => void,
  ): () => void;
  close(): void;
}

export interface ConnectToHostOptions {
  PeerCtor?: new (id?: string, opts?: PeerOptions) => Peer;
  peerOptions?: PeerOptions;
}

export interface CreateHostOptions {
  // Injection seam: tests pass a fake constructor that captures events.
  PeerCtor?: new (
    id?: string,
    opts?: PeerOptions,
  ) => Peer;
  peerOptions?: PeerOptions;
  // Desired peer id. Caller is responsible for collision-recovery (try
  // a different id and retry createHost) — this layer just surfaces
  // the broker's "unavailable-id" error.
  desiredId?: string;
}

// Custom broker key — every peer (host + companion) registers
// under this namespace on the public PeerJS broker so we don't
// share an id pool with random other apps using the default
// "peerjs" key. Two peers on different keys never collide even if
// they pick the same id. Override by passing your own
// `peerOptions.key` for tests / self-hosting.
const PEER_BROKER_KEY = "game-timer";

const withDefaultPeerOptions = (
  given: PeerOptions | undefined,
): PeerOptions => ({
  key: PEER_BROKER_KEY,
  ...given,
});

// Test seam: Playwright multi-page tests inject a window-level factory
// that provides a BroadcastChannel-based fake peer layer so multiple
// pages on the same origin can talk to each other without contacting
// the real PeerJS broker. The shape mirrors `createHost` /
// `connectToHost` exactly; in production this branch is dead code.
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

export function createHost(
  options: CreateHostOptions = {},
): Promise<HostSession> {
  const testFactory = getTestFactory();
  if (testFactory) return testFactory.createHost(options);
  const Ctor = options.PeerCtor ?? Peer;
  return new Promise((resolve, reject) => {
    const peer = new Ctor(
      options.desiredId,
      withDefaultPeerOptions(options.peerOptions),
    );
    const conns = new Map<string, DataConnection>();
    const connectHandlers = new Set<(peerId: string) => void>();
    const disconnectHandlers = new Set<(peerId: string) => void>();
    const messageHandlers = new Set<(peerId: string, data: unknown) => void>();
    let opened = false;

    // PeerJS's cloud broker drops the websocket from time to time
    // ("Lost connection to server"). When it does, the peer goes
    // into a disconnected-but-not-destroyed state; reconnect()
    // re-establishes the WSS without invalidating any open data
    // connections. Keep trying indefinitely (capped at 60s) so the
    // host doesn't have to refresh after a network blip.
    let reconnectAttempts = 0;
    let pendingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const tryReconnect = (immediate = false) => {
      if (peer.destroyed) return;
      if (pendingReconnectTimer != null) return;
      reconnectAttempts++;
      const backoffMs = immediate
        ? 0
        : Math.min(60_000, 500 * 2 ** Math.min(reconnectAttempts - 1, 7));
      log.info("peer reconnecting", {
        attempt: reconnectAttempts,
        backoffMs,
      });
      pendingReconnectTimer = setTimeout(() => {
        pendingReconnectTimer = null;
        if (peer.destroyed) return;
        try {
          peer.reconnect();
        } catch (err) {
          log.warn("peer.reconnect() threw", { error: String(err) });
        }
      }, backoffMs);
    };
    peer.on("disconnected", () => {
      log.warn("peer disconnected from broker");
      tryReconnect();
    });

    // Network / visibility nudges — when the OS reports we're back
    // online or the user returns to the tab, immediately retry
    // rather than waiting for the scheduled backoff.
    const onOnline = () => {
      log.info("host window online — kicking immediate reconnect");
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      reconnectAttempts = 0;
      if (peer.disconnected) tryReconnect(/* immediate */ true);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!peer.disconnected) return;
      log.info("host tab visible — kicking immediate reconnect");
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      reconnectAttempts = 0;
      tryReconnect(/* immediate */ true);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
    }

    peer.on("open", (id) => {
      opened = true;
      // Reset the backoff once a fresh open completes so a later
      // disconnect starts from attempt 1 again.
      reconnectAttempts = 0;
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      log.info("host session opened", { sessionCode: id });

      peer.on("connection", (conn) => {
        log.debug("incoming connection", { peerId: conn.peer });
        conn.on("open", () => {
          conns.set(conn.peer, conn);
          log.info("companion connected", { peerId: conn.peer });
          connectHandlers.forEach((h) => {
            h(conn.peer);
          });
        });
        conn.on("data", (data) => {
          messageHandlers.forEach((h) => {
            h(conn.peer, data);
          });
        });
        conn.on("close", () => {
          if (conns.delete(conn.peer)) {
            log.info("companion disconnected", { peerId: conn.peer });
            disconnectHandlers.forEach((h) => {
              h(conn.peer);
            });
          }
        });
        conn.on("error", (err) => {
          log.warn("connection error", {
            peerId: conn.peer,
            error: String(err),
          });
        });
      });

      resolve({
        sessionCode: id,
        send: (data) => {
          conns.forEach((c) => {
            if (c.open) c.send(data);
          });
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
        connections: () => {
          const keys: string[] = [];
          conns.forEach((_, k) => {
            keys.push(k);
          });
          return keys;
        },
        close: () => {
          log.info("host session closed", { sessionCode: id });
          if (typeof window !== "undefined") {
            window.removeEventListener("online", onOnline);
            document.removeEventListener("visibilitychange", onVisible);
          }
          if (pendingReconnectTimer != null) {
            clearTimeout(pendingReconnectTimer);
            pendingReconnectTimer = null;
          }
          peer.destroy();
        },
      });
    });

    peer.on("error", (err) => {
      log.error("peer error", { error: String(err) });
      // Only the initial-open failure rejects the promise; later runtime
      // errors propagate via the logger and the underlying Peer.
      if (!opened) reject(err);
    });
  });
}

export function connectToHost(
  hostCode: string,
  options: ConnectToHostOptions = {},
): Promise<CompanionSession> {
  const testFactory = getTestFactory();
  if (testFactory) return testFactory.connectToHost(hostCode, options);
  const Ctor = options.PeerCtor ?? Peer;
  return new Promise((resolve, reject) => {
    const peer = new Ctor(
      undefined,
      withDefaultPeerOptions(options.peerOptions),
    );
    const messageHandlers = new Set<(data: unknown) => void>();
    const closeHandlers = new Set<() => void>();
    let resolved = false;

    // Broker-flake mitigation: when the WSS to the broker drops,
    // keep trying to reconnect with exponential backoff capped at
    // 60s. No hard attempt limit — when the network comes back the
    // peer should rejoin without the user reloading.
    let reconnectAttempts = 0;
    let pendingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const tryReconnect = (immediate = false) => {
      if (peer.destroyed) return;
      if (pendingReconnectTimer != null) return;
      reconnectAttempts++;
      const backoffMs = immediate
        ? 0
        : Math.min(60_000, 500 * 2 ** Math.min(reconnectAttempts - 1, 7));
      log.info("companion reconnecting", {
        attempt: reconnectAttempts,
        backoffMs,
      });
      pendingReconnectTimer = setTimeout(() => {
        pendingReconnectTimer = null;
        if (peer.destroyed) return;
        try {
          peer.reconnect();
        } catch (err) {
          log.warn("companion peer.reconnect() threw", { error: String(err) });
        }
      }, backoffMs);
    };
    peer.on("disconnected", () => {
      log.warn("companion peer disconnected from broker");
      tryReconnect();
    });

    // Network / visibility nudges — when the OS reports we're back
    // online or the user returns to the tab, immediately retry
    // rather than waiting for the next scheduled backoff.
    const onOnline = () => {
      log.info("companion window online — kicking immediate reconnect");
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      reconnectAttempts = 0;
      if (peer.disconnected) tryReconnect(/* immediate */ true);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!peer.disconnected) return;
      log.info("companion tab visible — kicking immediate reconnect");
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      reconnectAttempts = 0;
      tryReconnect(/* immediate */ true);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
    }

    // Hold the active conn in a closure variable so reconnects can
    // swap it without breaking the session interface returned to
    // callers. Without this, the FIRST conn was captured in the
    // session's `send`/etc. closures and a later broker reconnect
    // would leave the caller pointing at a dead conn.
    let currentConn: DataConnection | null = null;
    let peerIdAtOpen: string | null = null;
    let destroyed = false;
    // Buffer data events that arrive before the first onMessage handler
    // is registered. The companion's caller attaches its handler in a
    // .then() callback after connectToHost resolves; the host may
    // broadcast immediately on connection (via a peerCount-keyed
    // useEffect). Without the buffer those early messages are dropped.
    const pendingMessages: unknown[] = [];
    const stateHandlers = new Set<(state: CompanionConnectionState) => void>();
    let lastState: CompanionConnectionState = "reconnecting";
    const emitState = (next: CompanionConnectionState) => {
      if (next === lastState) return;
      lastState = next;
      stateHandlers.forEach((h) => {
        h(next);
      });
    };

    const dialHost = () => {
      if (peer.destroyed || destroyed) return;
      log.info("companion dialing host", { hostCode });
      const conn = peer.connect(hostCode);
      currentConn = conn;

      conn.on("open", () => {
        emitState("connected");
        if (!resolved) {
          resolved = true;
          log.info("companion connected to host", { hostCode });
          resolve({
            hostCode,
            peerId: peerIdAtOpen ?? "",
            send: (data) => {
              if (currentConn?.open) currentConn.send(data);
            },
            onMessage: (h) => {
              messageHandlers.add(h);
              // Replay any messages that arrived before this handler
              // was registered (the first-connection race window).
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
              // Replay current state so a late subscriber doesn't
              // miss the initial "connected" transition.
              h(lastState);
              return () => {
                stateHandlers.delete(h);
              };
            },
            close: () => {
              log.info("companion closing", { hostCode });
              destroyed = true;
              emitState("closed");
              if (typeof window !== "undefined") {
                window.removeEventListener("online", onOnline);
                document.removeEventListener("visibilitychange", onVisible);
              }
              if (pendingReconnectTimer != null) {
                clearTimeout(pendingReconnectTimer);
                pendingReconnectTimer = null;
              }
              peer.destroy();
            },
          });
        } else {
          log.info("companion re-connected to host", { hostCode });
        }
      });

      conn.on("data", (data) => {
        if (messageHandlers.size === 0) {
          pendingMessages.push(data);
        } else {
          messageHandlers.forEach((h) => {
            h(data);
          });
        }
      });

      conn.on("close", () => {
        log.info("companion connection closed", { hostCode });
        emitState(destroyed ? "closed" : "reconnecting");
        // If the host's data channel closes but our peer is still
        // open, try re-dialling — they might be reloading or had a
        // brief network blip. The peer's broker-level reconnect
        // logic handles the other case (broker WSS down).
        if (!destroyed && !peer.destroyed && !peer.disconnected) {
          setTimeout(() => {
            if (!destroyed && !peer.destroyed && !peer.disconnected) {
              dialHost();
            }
          }, 1500);
        }
        if (resolved)
          closeHandlers.forEach((h) => {
            h();
          });
      });

      conn.on("error", (err) => {
        log.warn("companion connection error", {
          hostCode,
          error: String(err),
        });
        if (!resolved) reject(err);
      });
    };

    peer.on("open", (id) => {
      reconnectAttempts = 0;
      if (pendingReconnectTimer != null) {
        clearTimeout(pendingReconnectTimer);
        pendingReconnectTimer = null;
      }
      peerIdAtOpen = id;
      log.info("companion peer opened, dialing host", { hostCode, id });
      dialHost();
    });

    peer.on("error", (err) => {
      log.error("companion peer error", { error: String(err) });
      if (!resolved) reject(err);
    });
  });
}

// Translate a raw PeerJS error into a short, user-facing sentence.
// PeerJS exposes the failure mode on `err.type`; we map the common
// ones we've actually hit in the wild. The default "couldn't
// connect" stays generic on purpose — better than guessing.
export function describePeerError(err: unknown): string {
  if (err && typeof err === "object" && "type" in err) {
    const type = (err as { type?: unknown }).type;
    switch (type) {
      case "network":
        return "Network unavailable — check your Wi-Fi or mobile data.";
      case "peer-unavailable":
        return "Host not found. They may have closed the session, or the code is wrong.";
      case "server-error":
        return "The sharing service is unreachable. Retrying in the background.";
      case "socket-error":
      case "socket-closed":
        return "Lost the connection to the sharing service. Retrying.";
      case "disconnected":
        return "Disconnected — trying to reconnect.";
      case "browser-incompatible":
        return "This browser doesn't support the WebRTC features needed to share. Try a different browser.";
      case "ssl-unavailable":
        return "Secure connection blocked by your network or browser.";
      case "unavailable-id":
        return "That session code is taken. Try starting a new session.";
      case "invalid-id":
      case "invalid-key":
        return "That session code is invalid.";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Couldn't connect. Retrying in the background.";
}
