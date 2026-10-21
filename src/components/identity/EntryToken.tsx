import {
  Anchor,
  Anvil,
  Asterisk,
  Building2,
  ChevronsRight,
  Circle,
  Cog,
  Drill,
  FerrisWheel,
  FlaskConical,
  Globe,
  Hexagon,
  House,
  Layers,
  LayoutPanelLeft,
  Link,
  type LucideIcon,
  Magnet,
  Moon,
  Orbit,
  Pickaxe,
  Sparkle,
  SunDim,
  Sunrise,
  Tent,
  TrainFrontTunnel,
  TrainTrack,
  TramFront,
  Triangle,
  Trophy,
  Waypoints,
  Wheat,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { EntrySymbol } from "@/state/entryIdentity";
import styles from "./identity.module.css";

const ICONS: Record<EntrySymbol, LucideIcon> = {
  anchor: Anchor,
  anvil: Anvil,
  asterisk: Asterisk,
  "building-2": Building2,
  "chevrons-right": ChevronsRight,
  circle: Circle,
  cog: Cog,
  drill: Drill,
  "ferris-wheel": FerrisWheel,
  "flask-conical": FlaskConical,
  globe: Globe,
  hexagon: Hexagon,
  house: House,
  layers: Layers,
  "layout-panel-left": LayoutPanelLeft,
  link: Link,
  magnet: Magnet,
  moon: Moon,
  orbit: Orbit,
  pickaxe: Pickaxe,
  sparkle: Sparkle,
  "sun-dim": SunDim,
  sunrise: Sunrise,
  tent: Tent,
  "train-front-tunnel": TrainFrontTunnel,
  "train-track": TrainTrack,
  "tram-front": TramFront,
  triangle: Triangle,
  trophy: Trophy,
  waypoints: Waypoints,
  wheat: Wheat,
};

export const symbolIcon = (symbol: EntrySymbol): LucideIcon => ICONS[symbol];

const channel = (hex: string, i: number) => {
  const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * The on-light or on-dark text token, whichever contrasts more with
 * `color`. Colours that are not six-digit hex (CSS variables, names)
 * get the on-dark token.
 */
export const inkFor = (color: string): string => {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "var(--color-on-dark)";
  const l =
    0.2126 * channel(color, 1) +
    0.7152 * channel(color, 3) +
    0.0722 * channel(color, 5);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05)
    ? "var(--color-on-light)"
    : "var(--color-on-dark)";
};

/**
 * Shifts an icon's viewBox so its drawn shape, not its 24-unit frame,
 * sits in the middle. Many glyphs are drawn off centre in their frame,
 * which shows inside a round token.
 */
export const centreGlyph = (svg: SVGSVGElement | null) => {
  if (!svg || typeof svg.getBBox !== "function") return;
  const box = svg.getBBox();
  if (box.width === 0 || box.height === 0) return;
  const x = box.x + box.width / 2 - 12;
  const y = box.y + box.height / 2 - 12;
  svg.setAttribute("viewBox", `${x} ${y} 24 24`);
};

interface EntryTokenProps {
  color: string;
  symbol: EntrySymbol;
  // Diameter in pixels.
  size: number;
  // Turned over, as a piece that has acted: the colour without its symbol.
  faceDown?: boolean;
  className?: string;
}

/**
 * A disc in the entry's colour carrying its symbol in black or white,
 * ringed faintly so dark colours still separate from the background.
 * Decorative: the entry's name always sits beside it.
 */
export function EntryToken({
  color,
  symbol,
  size,
  faceDown = false,
  className,
}: EntryTokenProps) {
  const Icon = ICONS[symbol];
  return (
    <span
      className={`${styles.token} ${className ?? ""}`}
      style={
        {
          "--token-size": `${size}px`,
          background: color,
          color: inkFor(color),
        } as CSSProperties
      }
      aria-hidden
      data-symbol={symbol}
      data-face-down={faceDown || undefined}
    >
      {!faceDown && (
        <Icon
          ref={centreGlyph}
          size={Math.round(size * 0.6)}
          strokeWidth={size < 20 ? 2.4 : 2}
          aria-hidden
        />
      )}
    </span>
  );
}
