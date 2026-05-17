/*
 * Wire format for host ↔ companion messages.
 *
 * Versioned so future schema changes can be migrated by the receiver
 * rather than crashing. Keep it JSON-serialisable.
 */
import type { GameSessionState } from "./gameSession";

export const PEER_PROTOCOL_VERSION = 1;

export type HostToCompanionMessage = {
  type: "STATE";
  protocolVersion: typeof PEER_PROTOCOL_VERSION;
  state: GameSessionState;
  // Wall-clock at the host when the snapshot was sent — lets companions
  // compute "elapsed since current turn started" without trusting their
  // local clock to be in sync with the host's.
  sentAt: number;
};

// Phase 3 will add CompanionToHostMessage with action requests.
