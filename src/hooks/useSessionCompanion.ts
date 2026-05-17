import { useEffect, useRef, useState } from "react";
import { connectToHost, type CompanionSession } from "@/lib/peer";

type Status = "connecting" | "connected" | "disconnected" | "error";

export interface UseSessionCompanionReturn<TMessage> {
  status: Status;
  lastMessage: TMessage | null;
  error: Error | null;
  send: (data: unknown) => void;
}

export function useSessionCompanion<TMessage>(
  hostCode: string | null,
): UseSessionCompanionReturn<TMessage> {
  const [status, setStatus] = useState<Status>("connecting");
  const [lastMessage, setLastMessage] = useState<TMessage | null>(null);
  const [error, setError] = useState<Error | null>(null);
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

    connectToHost(hostCode)
      .then((session) => {
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setStatus("connected");
        session.onMessage((data) => {
          setLastMessage(data as TMessage);
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

  const send = (data: unknown) => {
    sessionRef.current?.send(data);
  };

  return { status, lastMessage, error, send };
}
