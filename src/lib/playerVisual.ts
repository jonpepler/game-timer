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
// render distinct markers without crashing. Tuned for the dark default
// look.
export const DEFAULT_PLAYER_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

// The same hues deepened for a light scheme: the dark set is neon on
// paper and its yellow vanishes. Each keeps 3:1 on a light surface.
export const LIGHT_PLAYER_PALETTE = [
  "#94680A",
  "#B03A2E",
  "#22679A",
  "#3D7A2C",
  "#9C3279",
  "#A6531A",
];

export const fallbackColor = (
  playerIndex: number,
  scheme: "light" | "dark" = "dark",
): string => {
  const palette =
    scheme === "light" ? LIGHT_PLAYER_PALETTE : DEFAULT_PLAYER_PALETTE;
  return palette[playerIndex % palette.length] ?? "#888";
};

// Get the colour to render for this player. Prefers metadata declared
// by playerVisualFrom; otherwise falls back to the positional palette
// for the scheme on screen.
export const playerColor = (
  player: Player | undefined,
  playerIndex: number,
  visualKey: string | undefined,
  scheme: "light" | "dark" = "dark",
): string => {
  if (player && visualKey) {
    const meta = player.metadata[visualKey];
    if (meta?.type === "selected-option" && meta.color) return meta.color;
  }
  return fallbackColor(playerIndex, scheme);
};

// Get the descriptive option label declared via metadata (e.g. the
// name of the picked option), useful for tooltips and richer banners. Falls back
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

// Icon path for this player (e.g. the picked option's meeple SVG), if the
// active definition declared one and the picked option carries an
// iconSrc. Returns a path relative to the deployment basePath: the
// renderer prepends it (or uses a relative-URL render).
export const playerIcon = (
  player: Player | undefined,
  visualKey: string | undefined,
): string | undefined => {
  if (player && visualKey) {
    const meta = player.metadata[visualKey];
    if (meta?.type === "selected-option" && meta.iconSrc) return meta.iconSrc;
  }
  return undefined;
};

// HEAD icon: portrait crop used by the score panel + victory hero
// where the full-body silhouette is too tall. Falls back to the
// regular silhouette icon when no head crop was provided.
export const playerHeadIcon = (
  player: Player | undefined,
  visualKey: string | undefined,
): string | undefined => {
  if (player && visualKey) {
    const meta = player.metadata[visualKey];
    if (meta?.type === "selected-option") {
      return meta.headIconSrc ?? meta.iconSrc;
    }
  }
  return undefined;
};

// Subheading shown beneath the player's display name (e.g. "Red Team"
// under "Jon"). Returns undefined when the active definition
// declares no subheading source OR the metadata's label happens to
// equal the player's name: in that case the subheading would just
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
