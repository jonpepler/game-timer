/*
 * Render-time helpers for player visual identity.
 *
 * Players don't carry a top-level colour; instead the active
 * GameDefinition declares which metadata key holds the visual data
 * (via `playerVisualFrom`), and renderers look that up. When the
 * metadata is absent (generic game, no setup step has fired yet),
 * we fall back to a positional palette.
 */
import type { Player } from "@/state/gameSession";

// Distinct, accessible colours for anonymous-player games. First N
// players get these in order; the wrap-around lets larger games still
// render distinct markers without crashing.
export const DEFAULT_PLAYER_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

export const fallbackColor = (playerIndex: number): string =>
  DEFAULT_PLAYER_PALETTE[playerIndex % DEFAULT_PLAYER_PALETTE.length] ?? "#888";

// Get the colour to render for this player. Prefers metadata declared
// by playerVisualFrom; otherwise falls back to the positional palette.
export const playerColor = (
  player: Player | undefined,
  playerIndex: number,
  visualKey: string | undefined,
): string => {
  if (player && visualKey) {
    const meta = player.metadata[visualKey];
    if (meta?.type === "selected-option" && meta.color) return meta.color;
  }
  return fallbackColor(playerIndex);
};

// Get the descriptive option label declared via metadata (e.g. the
// faction name) — useful for tooltips and richer banners. Falls back
// to the player's own display name.
export const playerOptionLabel = (
  player: Player | undefined,
  visualKey: string | undefined,
): string | undefined => {
  if (player && visualKey) {
    const meta = player.metadata[visualKey];
    if (meta?.type === "selected-option") return meta.label;
  }
  return undefined;
};

// Subheading shown beneath the player's display name (e.g. "Marquise
// de Cat" under "Jon"). Returns undefined when the active definition
// declares no subheading source OR the metadata's label happens to
// equal the player's name — in that case the subheading would just
// duplicate what's already shown.
export const playerSubheading = (
  player: Player | undefined,
  subheadingKey: string | undefined,
): string | undefined => {
  if (!player || !subheadingKey) return undefined;
  const meta = player.metadata[subheadingKey];
  if (meta?.type !== "selected-option") return undefined;
  if (meta.label === player.name) return undefined;
  return meta.label;
};
