import { useCallback, useEffect, useRef, useState } from "react";
import { connectToHost, type CompanionSession } from "@/lib/peer";
import { toPeerId } from "@/lib/sessionCode";

type Status =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface UseSessionCompanionReturn<TMessage> {
  status: Status;
  lastMessage: TMessage | null;
  error: Error | null;
  send: (data: unknown) => void;
  // The companion's own broker peer id once connected. Used to
  // identify itself in the host's per-seat claimedBy[] array.
  peerId: string | null;
}

export function useSessionCompanion<TMessage>(
  hostCode: string | null,
): UseSessionCompanionReturn<TMessage> {
  const [status, setStatus] = useState<Status>("connecting");
  const [lastMessage, setLastMessage] = useState<TMessage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const sessionRef = useRef<CompanionSession | null>(null);

  useEffect(() => {
    if (!hostCode) {
      setStatus("error");
      setError(new Error("No host code provided"));
      return;
    }
    let cancelled = false;
    setStatus("connecting");
    setError(null);

    connectToHost(toPeerId(hostCode))
      .then((session) => {
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setStatus("connected");
        setPeerId(session.peerId);
        session.onMessage((data) => {
          setLastMessage(data as TMessage);
        });
        session.onConnectionStateChange((next) => {
          // Map the session's three-state lifecycle to the hook's
          // user-facing status. "reconnecting" lets the UI hint
          // that the connection is being re-established rather
          // than dead. "closed" → "disconnected" matches the
          // pre-existing semantics so the rest of the app keeps
          // working.
          if (next === "connected") setStatus("connected");
          else if (next === "reconnecting") setStatus("reconnecting");
          else if (next === "closed") setStatus("disconnected");
        });
        session.onClose(() => {
          setStatus("disconnected");
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setStatus("error");
        setError(err);
      });

    return () => {
      cancelled = true;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [hostCode]);

  // Stable identity so consumers can safely list `send` in useEffect
  // dep arrays without re-firing on every render. Without this, the
  // companion's CLAIM-on-claim useEffect (and similar self-driven
  // pings) re-runs on every render, and the host's per-CLAIM
  // setClaimMap → broadcastSeating → STATE round-trip drives the
  // companion to re-render, forming a tight send/receive loop.
  const send = useCallback((data: unknown) => {
    sessionRef.current?.send(data);
  }, []);

  return { status, lastMessage, error, send, peerId };
}
