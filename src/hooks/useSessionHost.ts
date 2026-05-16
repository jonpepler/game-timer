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

  // Tear the session down if the host page unmounts (route change, etc.)
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
    };
  }, []);

  return { status, sessionCode, connectedPeers, error, open, close };
}
