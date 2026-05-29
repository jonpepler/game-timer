/*
 * Short, table-friendly session codes for PeerJS host ids.
 *
 * 4-character codes drawn from a 22-symbol alphabet that excludes
 * every common look-alike pair (0/O/D, 1/I/L, 2/Z, 5/S, 6/G, 8/B).
 * Easy to read out loud, easy to type on a phone keyboard. The
 * broker uses a global id namespace so we prefix on the wire to
 * keep collisions to other Game Timer sessions.
 *
 *   peer id:        gtmr-K3WP
 *   shown to user:  K3WP
 */
const PREFIX = "gtmr";

// 22 unambiguous characters. Letters dropped: B (8), D (0/O), G
// (6), I (1), L (1/I), O (0), Q (O), S (5), Z (2). Digits dropped:
// 0 (O), 1 (I), 2 (Z), 5 (S), 6 (G), 8 (B). What's left reads
// cleanly across sans-serif fonts, mixed case, and on poor phone
// screens.
const ALPHABET = "ACEFHJKMNPRTUVWXY3479";
export const SESSION_CODE_LENGTH = 4;

const randomChar = (): string =>
  ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));

// Returns a fresh user-visible code (no prefix). Caller wraps it with
// `toPeerId` before passing it to PeerJS.
export const generateSessionCode = (): string => {
  let out = "";
  for (let i = 0; i < SESSION_CODE_LENGTH; i++) out += randomChar();
  return out;
};

// User-typed codes might come in any case / with surrounding
// whitespace. Normalise to the canonical form before passing to
// PeerJS or matching against existing sessions.
export const normaliseSessionCode = (input: string): string =>
  input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export const toPeerId = (sessionCode: string): string =>
  `${PREFIX}-${normaliseSessionCode(sessionCode)}`;

export const fromPeerId = (peerId: string): string =>
  peerId.startsWith(`${PREFIX}-`) ? peerId.slice(PREFIX.length + 1) : peerId;

// Build the companion URL for the given session code, using the
// current document origin. Falls back to a relative URL when window is
// unavailable (SSR / tests).
export const buildCompanionUrl = (sessionCode: string): string => {
  const path = `/game-timer/companion?code=${encodeURIComponent(sessionCode)}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
};
