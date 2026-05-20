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
  close(): void;
}

export interface ConnectToHostOptions {
  PeerCtor?: new (id?: string, opts?: PeerOptions) => Peer;
  peerOptions?: PeerOptions;
}

export interface CreateHostOptions {
  // Injection seam: tests pass a fake constructor that captures events.
  PeerCtor?: new (id?: string, opts?: PeerOptions) => Peer;
  peerOptions?: PeerOptions;
  // Desired peer id. Caller is responsible for collision-recovery (try
  // a different id and retry createHost) — this layer just surfaces
  // the broker's "unavailable-id" error.
  desiredId?: string;
}

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
    const peer = new Ctor(options.desiredId, options.peerOptions);
    const conns = new Map<string, DataConnection>();
    const connectHandlers = new Set<(peerId: string) => void>();
    const disconnectHandlers = new Set<(peerId: string) => void>();
    const messageHandlers = new Set<(peerId: string, data: unknown) => void>();
    let opened = false;

    // PeerJS's cloud broker drops the websocket from time to time
    // ("Lost connection to server"). When it does, the peer goes
    // into a disconnected-but-not-destroyed state; reconnect()
    // re-establishes the WSS without invalidating any open data
    // connections. We retry a few times with a backoff before
    // giving up.
    let reconnectAttempts = 0;
    const tryReconnect = () => {
      if (peer.destroyed) return;
      if (reconnectAttempts >= 5) {
        log.warn("peer reconnect attempts exhausted");
        return;
      }
      reconnectAttempts++;
      const backoffMs = Math.min(8000, 500 * 2 ** (reconnectAttempts - 1));
      log.info("peer reconnecting", {
        attempt: reconnectAttempts,
        backoffMs,
      });
      setTimeout(() => {
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

    peer.on("open", (id) => {
      opened = true;
      // Reset the backoff once a fresh open completes so a later
      // disconnect starts from attempt 1 again.
      reconnectAttempts = 0;
      log.info("host session opened", { sessionCode: id });

      peer.on("connection", (conn) => {
        log.debug("incoming connection", { peerId: conn.peer });
        conn.on("open", () => {
          conns.set(conn.peer, conn);
          log.info("companion connected", { peerId: conn.peer });
          connectHandlers.forEach((h) => h(conn.peer));
        });
        conn.on("data", (data) => {
          messageHandlers.forEach((h) => h(conn.peer, data));
        });
        conn.on("close", () => {
          if (conns.delete(conn.peer)) {
            log.info("companion disconnected", { peerId: conn.peer });
            disconnectHandlers.forEach((h) => h(conn.peer));
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
          conns.forEach((_, k) => keys.push(k));
          return keys;
        },
        close: () => {
          log.info("host session closed", { sessionCode: id });
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
    const peer = new Ctor(undefined, options.peerOptions);
    const messageHandlers = new Set<(data: unknown) => void>();
    const closeHandlers = new Set<() => void>();
    let resolved = false;

    // Same broker-flake mitigation as the host: when the WSS to
    // the broker drops, try to reconnect with a backoff before
    // bubbling failure to the UI.
    let reconnectAttempts = 0;
    const tryReconnect = () => {
      if (peer.destroyed) return;
      if (reconnectAttempts >= 5) {
        log.warn("companion reconnect attempts exhausted");
        return;
      }
      reconnectAttempts++;
      const backoffMs = Math.min(8000, 500 * 2 ** (reconnectAttempts - 1));
      log.info("companion reconnecting", {
        attempt: reconnectAttempts,
        backoffMs,
      });
      setTimeout(() => {
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

    peer.on("open", (id) => {
      reconnectAttempts = 0;
      log.info("companion peer opened, dialing host", { hostCode, id });
      const conn = peer.connect(hostCode);

      conn.on("open", () => {
        resolved = true;
        log.info("companion connected to host", { hostCode });
        resolve({
          hostCode,
          peerId: id,
          send: (data) => {
            if (conn.open) conn.send(data);
          },
          onMessage: (h) => {
            messageHandlers.add(h);
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
          close: () => {
            log.info("companion closing", { hostCode });
            peer.destroy();
          },
        });
      });

      conn.on("data", (data) => {
        messageHandlers.forEach((h) => h(data));
      });

      conn.on("close", () => {
        log.info("companion connection closed", { hostCode });
        closeHandlers.forEach((h) => h());
      });

      conn.on("error", (err) => {
        log.warn("companion connection error", {
          hostCode,
          error: String(err),
        });
        if (!resolved) reject(err);
      });
    });

    peer.on("error", (err) => {
      log.error("companion peer error", { error: String(err) });
      if (!resolved) reject(err);
    });
  });
}
