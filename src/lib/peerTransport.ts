/*
 * Transport selector. The app imports createHost / connectToHost /
 * describePeerError from here, not from a concrete transport, so the
 * PeerJS ↔ Trystero swap is a one-flag change with no churn in hooks or
 * pages.
 *
 * Select Trystero by building/running with NEXT_PUBLIC_USE_TRYSTERO=true
 * (it's a build-time inlined constant in the static export). Default is
 * PeerJS, so nothing changes unless explicitly opted in.
 *
 * Spike note: both modules are imported, so both transports are bundled
 * regardless of the flag. Before shipping one for real, drop the loser
 * to shed its bytes (PeerJS) / keep Trystero's dynamic import.
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

const useTrystero = process.env.NEXT_PUBLIC_USE_TRYSTERO === "true";

const impl = useTrystero ? trystero : peerjs;

export const createHost = impl.createHost;
export const connectToHost = impl.connectToHost;
export const describePeerError = impl.describePeerError;
export const TRANSPORT: "trystero" | "peerjs" = useTrystero
  ? "trystero"
  : "peerjs";
