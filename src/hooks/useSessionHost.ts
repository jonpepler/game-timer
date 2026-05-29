import { useCallback, useEffect, useRef, useState } from "react";
import { createHost, type HostSession } from "@/lib/peer";
import { fromPeerId, generateSessionCode, toPeerId } from "@/lib/sessionCode";

const COLLISION_RETRY_LIMIT = 6;

type Status = "idle" | "opening" | "open" | "error";

export interface UseSessionHostOptions {
  // Fires when a connected companion sends a message. The hook keeps a
  // ref to the latest handler so callers don't need to memoise.
  onMessage?: (peerId: string, data: unknown) => void;
  onConnect?: (peerId: string) => void;
  onDisconnect?: (peerId: string) => void;
}

export interface UseSessionHostReturn {
  status: Status;
  sessionCode: string | null;
  connectedPeers: string[];
  error: Error | null;
  open: () => void;
  close: () => void;
  // Broadcast a message to every connected companion. No-op when the
  // host isn't open. Stable identity so it can be a useEffect dep.
  send: (data: unknown) => void;
}

// Owns at most one HostSession. Opt-in: callers click "Share" to spin
// up the peer; the broker is only contacted from then on.
export function useSessionHost(
  options: UseSessionHostOptions = {},
): UseSessionHostReturn {
  const [status, setStatus] = useState<Status>("idle");
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const sessionRef = useRef<HostSession | null>(null);

  // Keep the latest handlers in refs so dependency-array changes on the
  // caller side don't trigger re-subscription / re-opens of the peer.
  const onMessageRef = useRef(options.onMessage);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onConnectRef.current = options.onConnect;
    onDisconnectRef.current = options.onDisconnect;
  }, [options.onMessage, options.onConnect, options.onDisconnect]);

  const open = useCallback(() => {
    if (sessionRef.current || status === "opening") return;
    setStatus("opening");
    setError(null);

    // Try a friendly human-readable code; on broker collision, generate
    // a new one and retry up to a small cap before giving up.
    const tryOpen = (attempt: number): Promise<HostSession> => {
      const code = generateSessionCode();
      return createHost({ desiredId: toPeerId(code) }).catch((err: unknown) => {
        const isCollision =
          err &&
          typeof err === "object" &&
          "type" in err &&
          (err as { type: string }).type === "unavailable-id";
        if (isCollision && attempt < COLLISION_RETRY_LIMIT) {
          return tryOpen(attempt + 1);
        }
        throw err;
      });
    };

    tryOpen(0)
      .then((session) => {
        sessionRef.current = session;
        // Strip the project prefix so the UI shows the friendly code
        // rather than the underlying broker id.
        setSessionCode(fromPeerId(session.sessionCode));
        setStatus("open");
        session.onConnect((peerId) => {
          setConnectedPeers(session.connections());
          onConnectRef.current?.(peerId);
        });
        session.onDisconnect((peerId) => {
          setConnectedPeers(session.connections());
          onDisconnectRef.current?.(peerId);
        });
        session.onMessage((peerId, data) => {
          onMessageRef.current?.(peerId, data);
        });
      })
      .catch((err: Error) => {
        setError(err);
        setStatus("error");
      });
  }, [status]);

  const close = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setSessionCode(null);
    setConnectedPeers([]);
    setStatus("idle");
    setError(null);
  }, []);

  const send = useCallback((data: unknown) => {
    sessionRef.current?.send(data);
  }, []);

  // Tear the session down if the host page unmounts (route change, etc.)
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
    };
  }, []);

  return { status, sessionCode, connectedPeers, error, open, close, send };
}
