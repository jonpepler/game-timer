/*
 * Wire format for host ↔ companion messages.
 *
 * Versioned so future schema changes can be migrated by the receiver
 * rather than crashing. Keep it JSON-serialisable.
 */
import type { GameDefinition } from "./gameDefinition";
import type { GameSessionState } from "./gameSession";
import type { SeatColorOption } from "./seating";
import type { SessionCommand } from "./sessionCommands";

/**
 * Bumped whenever a message changes shape. Each side drops messages at
 * another version and says so on screen (a notice on the host, a reload
 * banner on the companion) rather than ignoring them silently.
 * 2: game actions moved onto COMMAND / COMMAND_RESULT.
 * 3: seating and renames moved onto COMMAND; CLAIM covers setup too.
 *
 * Additions that both sides tolerate keep the version: an older host
 * refuses an unknown command with a COMMAND_RESULT, and an older
 * companion ignores an unknown STATE field (and the host drops a
 * command field it does not know). UNDO, SET_PAUSED, SET_EXPECTED_TURNS,
 * `STATE.canUndo` and `STATE.paused` were added this way.
 */
export const PEER_PROTOCOL_VERSION = 3;

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
      // Whether the host has anything to undo (its snapshots stay on
      // the host). A companion cites `state.revision` in UNDO. Absent
      // from hosts that predate it, where a companion offers no Undo.
      canUndo?: boolean;
      // Whether the host's clock is paused. The clock is not game state,
      // so it travels beside it. Absent from hosts that predate it.
      paused?: boolean;
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
  // The host's wizard publishes its seating list whenever it opens or
  // the seats change, so seated companions can edit it with seat
  // commands. `claimedBy` mirrors the host's claim map, so every
  // companion sees who holds which seat and finds its own seat after a
  // reorder. Seat ids are stable; commands may name a seat by id.
  | {
      type: "SETUP_SEATING";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      stepId: string;
      seats: Array<{ id: string; name: string; colorId?: string }>;
      claimedBy: Array<string | null>;
      minPlayers: number;
      maxPlayers: number;
      colorOptions?: SeatColorOption[];
    }
  // Setup stopped seating players: the wizard closed, or the chosen game
  // has no seating step. Companions drop the seat list.
  | {
      type: "SETUP_SEATING_CLOSED";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  // The outcome of one COMMAND. Broadcast, so every peer sees it; only
  // the issuer (matching `commandId`) acts on it, showing `reason` when
  // the command was refused. A refusal usually means another screen got
  // there first.
  | {
      type: "COMMAND_RESULT";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      commandId: string;
      ok: boolean;
      reason?: string;
    }
  // Sent when the host drops a message at another protocol version, so
  // the companion that sent it (`peerId`; the send is a broadcast) can
  // tell its user to reload. Companions older than this message ignore
  // it; the host shows its own notice as well.
  | {
      type: "PROTOCOL_MISMATCH";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      peerId: string;
      peerVersion: number | null;
    };

// Companion → host. The companion claims a player slot, then issues
// action requests for that slot. The host validates each request
// against the claim map before dispatching.
export type CompanionToHostMessage =
  // Bind this companion to a seat: a seat on the setup seating list
  // while it is open (first come, first served), otherwise a player of
  // the running game.
  | {
      type: "CLAIM";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      playerIndex: number;
    }
  | {
      type: "RELEASE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  // First-sync pull. The host pushes STATE (+ seating + any in-flight
  // setup turn) when a peer connects, but that push is best-effort: the
  // WebRTC data channel carrying it may not be open yet at the instant
  // the host fires it, so the snapshot is silently dropped — and once a
  // game has started there is no STATE heartbeat to recover it, leaving
  // the companion hung with no UI. A freshly-(re)connected companion
  // therefore asks for the snapshot itself, retrying until one arrives.
  // The host replies exactly as it does on connect. Feature-agnostic:
  // recovers any companion's first sync, not just a specific action.
  | {
      type: "REQUEST_STATE";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
    }
  // A game action (see SessionCommand). The host checks it against the
  // sender's claimed seat with the same policy and runs it through the
  // same code path as its own UI. `commandId` is chosen by the sender
  // and echoed in COMMAND_RESULT. The host Zod-parses `command`, so a
  // malformed one is refused rather than trusted.
  | {
      type: "COMMAND";
      protocolVersion: typeof PEER_PROTOCOL_VERSION;
      commandId: string;
      command: SessionCommand;
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
    };
