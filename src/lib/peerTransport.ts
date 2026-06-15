/*
 * Transport selector. The app imports createHost / connectToHost /
 * describePeerError from here, not from a concrete transport, so the
 * Trystero ↔ PeerJS swap is a one-flag change with no churn in hooks or
 * pages.
 *
 * Trystero (serverless WebRTC over public Nostr relays) is the standard.
 * PeerJS is kept as a fallback: build/run with NEXT_PUBLIC_USE_PEERJS=true
 * to use it instead — handy for debugging, or for plain-http LAN testing
 * where Trystero's crypto.subtle (secure-context only) is unavailable.
 *
 * Note: the choice is build-time/global on purpose. Host and companion
 * MUST use the same transport to talk, so we can't fall back per-device
 * at runtime (a secure-context host on Trystero + an insecure companion
 * on PeerJS would never connect). Flip the flag for the whole deployment.
 *
 * Both modules are imported, so both transports are bundled. Trystero's
 * heavy relay code is behind a dynamic import (see peerTrystero), so the
 * unused transport costs little beyond PeerJS's static weight.
 */
import * as peerjs from "./peer";
import * as trystero from "./peerTrystero";

export type {
  CompanionConnectionState,
  CompanionSession,
  ConnectToHostOptions,
  CreateHostOptions,
  HostSession,
} from "./peer";

const usePeerJs = process.env.NEXT_PUBLIC_USE_PEERJS === "true";

const impl = usePeerJs ? peerjs : trystero;

export const createHost = impl.createHost;
export const connectToHost = impl.connectToHost;
export const describePeerError = impl.describePeerError;
export const TRANSPORT: "trystero" | "peerjs" = usePeerJs
  ? "peerjs"
  : "trystero";
