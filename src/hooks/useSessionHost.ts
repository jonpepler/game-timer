import { useCallback, useEffect, useRef, useState } from "react";
import { createHost, type HostSession } from "@/lib/peer";

type Status = "idle" | "opening" | "open" | "error";

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
export function useSessionHost(): UseSessionHostReturn {
  const [status, setStatus] = useState<Status>("idle");
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const sessionRef = useRef<HostSession | null>(null);

  const open = useCallback(() => {
    if (sessionRef.current || status === "opening") return;
    setStatus("opening");
    setError(null);
    createHost()
      .then((session) => {
        sessionRef.current = session;
        setSessionCode(session.sessionCode);
        setStatus("open");
        const refreshConns = () => setConnectedPeers(session.connections());
        session.onConnect(refreshConns);
        session.onDisconnect(refreshConns);
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
