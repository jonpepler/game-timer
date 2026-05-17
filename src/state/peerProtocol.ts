/*
 * Wire format for host ↔ companion messages.
 *
 * Versioned so future schema changes can be migrated by the receiver
 * rather than crashing. Keep it JSON-serialisable.
 */
import type { GameDefinition } from "./gameDefinition";
import type { GameSessionState } from "./gameSession";

export const PEER_PROTOCOL_VERSION = 1;

export type HostToCompanionMessage = {
  type: "STATE";
  protocolVersion: typeof PEER_PROTOCOL_VERSION;
  state: GameSessionState;
  // The full GameDefinition snapshot, so companions can render faction
  // pickers / score configs without having to ship the registry over
  // the wire. Optional for Generic-style games that don't pick a
  // definition.
  definition?: GameDefinition;
  // Wall-clock at the host when the snapshot was sent — lets companions
  // compute "elapsed since current turn started" without trusting their
  // local clock to be in sync with the host's.
  sentAt: number;
};

// Companion → host. The companion claims a player slot, then issues
// action requests for that slot. The host validates each request
// against the claim map before dispatching.
export type CompanionToHostMessage =
  | {
      type: "CLAIM";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      playerIndex: number;
    }
  | {
      type: "RELEASE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  | {
      type: "END_TURN";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  | {
      type: "INCREMENT_SCORE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      delta: number;
    }
  | {
      type: "SET_FACTION";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      factionId: string;
    };
