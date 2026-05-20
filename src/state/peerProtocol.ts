/*
 * Wire format for host ↔ companion messages.
 *
 * Versioned so future schema changes can be migrated by the receiver
 * rather than crashing. Keep it JSON-serialisable.
 */
import type { GameDefinition } from "./gameDefinition";
import type { GameSessionState } from "./gameSession";

export const PEER_PROTOCOL_VERSION = 1;

export type HostToCompanionMessage =
  | {
      type: "STATE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      state: GameSessionState;
      // The full GameDefinition snapshot, so companions can render
      // faction pickers / score configs without having to ship the
      // registry over the wire. Optional for Generic-style games that
      // don't pick a definition.
      definition?: GameDefinition;
      // Wall-clock at the host when the snapshot was sent — lets
      // companions compute "elapsed since current turn started"
      // without trusting their local clock to be in sync with the
      // host's.
      sentAt: number;
    }
  // Pre-game wizard signal: the host's faction-picker (or any
  // turn-based player-pick step) is currently asking the seated
  // companion at `seatIndex` to choose from `optionIds`. Companions
  // that have claimed that seat render the picker; the rest see a
  // "waiting for player X" overlay.
  | {
      type: "SETUP_TURN";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      seatIndex: number;
      optionIds: string[];
      // Faction ids the seated player can't pick — already claimed by
      // others, mutex-blocked, or hireling-matched. Companion greys
      // these out.
      excludedOptionIds: string[];
      // The definition snapshot — same shape as STATE.definition so
      // the companion can render meeple chips, descriptions, ADSET.
      definition?: GameDefinition;
    }
  // Turn-based player-pick wrapped up (all seats filled, or wizard
  // moved past the picker). Companions clear the picker overlay.
  | {
      type: "SETUP_DONE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
    }
  // The host's wizard publishes its current seating list any time it
  // mounts or the seats change. Lets companions see + collaboratively
  // edit the seat list before the game starts — claim a seat, rename
  // theirs, add a new one. `claimedBy` mirrors the host's claim map
  // so every companion sees who's already grabbed which slot.
  | {
      type: "SETUP_SEATING";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      // `id` is host-internal — used to track the seat across
      // host-driven reorders. Companions key by index; the id is
      // safe to ignore but useful for richer companion UI later.
      seats: Array<{ id?: string; name: string }>;
      claimedBy: Array<string | null>;
      minPlayers: number;
      maxPlayers: number;
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
  // Mid-game change to the option attached to the claiming companion
  // (e.g. swap faction on the fly). `stepId` names the player-pick
  // step on the active definition; the host looks the option up
  // there and projects it onto player.metadata.
  | {
      type: "SET_PLAYER_OPTION";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      optionId: string;
    }
  // Companion's response to a SETUP_TURN: the seat picks `optionId`
  // for the named step during the wizard. Host validates against the
  // claim map + current setupContext + the step's constraints before
  // committing.
  | {
      type: "SETUP_PICK";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      seatIndex: number;
      optionId: string;
    }
  // Companion-driven edits to the wizard's seating list. The host
  // applies these to the wizard's setup-context (subject to the
  // step's min/max bounds) and broadcasts a fresh SETUP_SEATING.
  // `claim` doubles as the CLAIM message during setup — once the
  // game has started, peers use the legacy CLAIM message instead.
  | {
      type: "SEATING_REQUEST";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      action:
        | { kind: "add"; name: string }
        | { kind: "rename"; seatIndex: number; name: string }
        | { kind: "remove"; seatIndex: number }
        | { kind: "claim"; seatIndex: number };
    }
  // Generic-mode turn advance. END_TURN requires a slot claim; in a
  // Generic game with no per-player tracking there are no slots to
  // claim, but seated companions still need a way to advance the
  // shared timer. TAP_TIMER is the "any peer, any time" variant —
  // host treats it equivalent to tapping the timer container.
  | {
      type: "TAP_TIMER";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  // Score-milestone dialog acknowledgement. Any peer (host or
  // companion) showing the dialog can dismiss it; the request pops
  // the host-side queue and the resulting STATE clears the dialog
  // on every connected screen at once.
  | {
      type: "DISMISS_MILESTONE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  // Mid-game rename of the player attached to the claiming
  // companion's seat. The host applies it via setPlayer, preserving
  // metadata. Identity-bound (companion can only rename the seat
  // they claimed), so no playerIndex on the wire.
  | {
      type: "RENAME_PLAYER";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      name: string;
    };
