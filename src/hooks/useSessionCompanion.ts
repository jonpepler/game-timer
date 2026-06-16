import { useCallback, useEffect, useRef, useState } from "react";
import { connectToHost, type CompanionSession } from "@/lib/peerTransport";
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
  // Force the transport to rebuild its connection. The page calls this
  // as a last resort when connected but no data is arriving (a dead
  // data channel). Stable identity, safe in effect deps.
  reconnect: () => void;
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

  // Inbound messages are surfaced one at a time through `lastMessage`,
  // which consumers read in a `[lastMessage]` effect. Several messages
  // can arrive in a single tick — e.g. the transport buffers them while
  // a handler (re)attaches, then flushes synchronously, and the host
  // sends STATE + SETUP_SEATING back-to-back on connect. If we called
  // setLastMessage() for each synchronously, React would batch them and
  // the consumer's effect would only ever see the LAST one, silently
  // dropping the rest (e.g. a connecting companion would process the
  // stale seating snapshot but miss the STATE behind it). So we queue
  // and drain one per commit, each on its own task, guaranteeing the
  // consumer's effect fires for every message.
  const queueRef = useRef<TMessage[]>([]);
  const pumpingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const pump = useCallback(() => {
    if (!mountedRef.current) return;
    const next = queueRef.current.shift();
    if (next === undefined) {
      pumpingRef.current = false;
      return;
    }
    pumpingRef.current = true;
    setLastMessage(next);
    // Deliver the next message on a fresh task so this one commits (and
    // the consumer effect runs) before the next setLastMessage lands.
    setTimeout(pump, 0);
  }, []);
  const enqueueMessage = useCallback(
    (data: TMessage) => {
      queueRef.current.push(data);
      if (!pumpingRef.current) pump();
    },
    [pump],
  );

  useEffect(() => {
    if (!hostCode) {
      setStatus("error");
      setError(new Error("No host code provided"));
      return;
    }
    let cancelled = false;
    setStatus("connecting");
    setError(null);
    // Drop any messages queued from a prior host code.
    queueRef.current = [];
    pumpingRef.current = false;

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
          enqueueMessage(data as TMessage);
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
  }, [hostCode, enqueueMessage]);

  // Stable identity so consumers can safely list `send` in useEffect
  // dep arrays without re-firing on every render. Without this, the
  // companion's CLAIM-on-claim useEffect (and similar self-driven
  // pings) re-runs on every render, and the host's per-CLAIM
  // setClaimMap → broadcastSeating → STATE round-trip drives the
  // companion to re-render, forming a tight send/receive loop.
  const send = useCallback((data: unknown) => {
    sessionRef.current?.send(data);
  }, []);

  const reconnect = useCallback(() => {
    sessionRef.current?.reconnect();
  }, []);

  return { status, lastMessage, error, send, reconnect, peerId };
}
