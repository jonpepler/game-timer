/*
 * Human-friendly session codes for PeerJS host ids.
 *
 * The public PeerJS broker uses a global id namespace, so we prefix
 * everything with a project tag to keep collisions to other Game Timer
 * sessions only. The user-visible portion is two short words + a
 * three-digit number — easy to read out loud to someone across the
 * table.
 *
 *   peer id:        gtmr-fox-river-042
 *   shown to user:  fox-river-042
 */
const PREFIX = "gtmr";

// Small, deliberately friendly word lists. Common, easy to pronounce,
// no homophones to misread on a phone.
const ADJECTIVES = [
  "amber",
  "bright",
  "calm",
  "deep",
  "easy",
  "fast",
  "gold",
  "happy",
  "icy",
  "jolly",
  "kind",
  "lazy",
  "mild",
  "nice",
  "olive",
  "plum",
  "quiet",
  "ripe",
  "soft",
  "tame",
  "vast",
  "warm",
  "wild",
  "young",
];

const NOUNS = [
  "badger",
  "cat",
  "crow",
  "deer",
  "eagle",
  "fox",
  "frog",
  "goose",
  "hare",
  "ibis",
  "jay",
  "lark",
  "lynx",
  "mole",
  "newt",
  "otter",
  "owl",
  "raven",
  "river",
  "stoat",
  "swan",
  "vole",
  "wren",
];

const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];

const threeDigit = () => String(Math.floor(Math.random() * 1000)).padStart(3, "0");

// Returns a fresh user-visible code (no prefix). Caller wraps it with
// `toPeerId` before passing it to PeerJS.
export const generateSessionCode = (): string =>
  `${pick(ADJECTIVES)}-${pick(NOUNS)}-${threeDigit()}`;

export const toPeerId = (sessionCode: string): string =>
  `${PREFIX}-${sessionCode}`;

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
