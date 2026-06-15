import type { CSSProperties } from "react";

/**
 * Shared player-icon renderer. Reproduces the three-way render that
 * was duplicated across the timer banner, the companion header /
 * active-player display, and the score panel markers + chips:
 *
 *   headIconSrc ? <img>            (raster portrait crop, artwork colours)
 *   : iconSrc   ? <span mask>      (silhouette SVG tinted via mask-image)
 *   : fallback                     (call-site supplied — swatch / initial / nothing)
 *
 * Sizing / shape stays at the call site via `headClassName` and
 * `silhouetteClassName` (CSS-module classes) so each surface keeps its
 * exact appearance. The only behaviour this component owns is the
 * head-vs-silhouette-vs-fallback decision and the mask wiring.
 */
export interface PlayerMeepleProps {
  iconSrc?: string;
  headIconSrc?: string;
  /** Faction colour used to fill the masked silhouette. */
  color: string;
  /** Class applied to the <img> head-icon variant. */
  headClassName?: string;
  /** Class applied to the <span> masked-silhouette variant. */
  silhouetteClassName?: string;
  /**
   * Silhouette fill. "color" (default) paints the mask with the
   * player's faction colour; "css" leaves the fill to the class's own
   * `background` (used by the score panel's fixed dark fill).
   */
  silhouetteFill?: "color" | "css";
  /** Rendered when neither a head icon nor a silhouette is available. */
  fallback?: React.ReactNode;
}

export function PlayerMeeple({
  iconSrc,
  headIconSrc,
  color,
  headClassName,
  silhouetteClassName,
  silhouetteFill = "color",
  fallback = null,
}: PlayerMeepleProps) {
  if (headIconSrc) {
    return (
      <img src={headIconSrc} alt="" aria-hidden className={headClassName} />
    );
  }
  if (iconSrc) {
    const style: CSSProperties = {
      WebkitMaskImage: `url(${iconSrc})`,
      maskImage: `url(${iconSrc})`,
    };
    if (silhouetteFill === "color") {
      style.background = color;
    }
    return <span className={silhouetteClassName} style={style} aria-hidden />;
  }
  return <>{fallback}</>;
}
