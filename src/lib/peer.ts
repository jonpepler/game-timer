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

export interface CreateHostOptions {
  // Injection seam: tests pass a fake constructor that captures events.
  PeerCtor?: new (id?: string, opts?: PeerOptions) => Peer;
  peerOptions?: PeerOptions;
}

export function createHost(
  options: CreateHostOptions = {},
): Promise<HostSession> {
  const Ctor = options.PeerCtor ?? Peer;
  return new Promise((resolve, reject) => {
    const peer = new Ctor(undefined, options.peerOptions);
    const conns = new Map<string, DataConnection>();
    const connectHandlers = new Set<(peerId: string) => void>();
    const disconnectHandlers = new Set<(peerId: string) => void>();
    const messageHandlers = new Set<(peerId: string, data: unknown) => void>();
    let opened = false;

    peer.on("open", (id) => {
      opened = true;
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
          log.warn("connection error", { peerId: conn.peer, error: String(err) });
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
