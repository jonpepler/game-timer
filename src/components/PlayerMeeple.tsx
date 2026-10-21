import { type CSSProperties, useEffect, useState } from "react";

/**
 * Shared player-icon renderer. Reproduces the three-way render that
 * was duplicated across the timer banner, the companion header /
 * active-player display, and the score panel markers + chips:
 *
 *   headIconSrc ? <img>            (raster portrait crop, artwork colours)
 *   : iconSrc   ? <span mask>      (silhouette SVG tinted via mask-image)
 *   : fallback                     (call-site supplied: swatch / initial / nothing)
 *
 * Sizing / shape stays at the call site via `headClassName` and
 * `silhouetteClassName` (CSS-module classes) so each surface keeps its
 * exact appearance. The only behaviour this component owns is the
 * head-vs-silhouette-vs-fallback decision and the mask wiring.
 */
export interface PlayerMeepleProps {
  iconSrc?: string;
  headIconSrc?: string;
  /** Player colour used to fill the masked silhouette. */
  color: string;
  /** Class applied to the <img> head-icon variant. */
  headClassName?: string;
  /**
   * Extra class for a head icon whose artwork is opaque to its corners
   * (a square card or photo rather than a cut-out), so the surface can
   * frame it, e.g. as a round token. `--frame-color` carries `color`.
   */
  framedHeadClassName?: string;
  /** Class applied to the <span> masked-silhouette variant. */
  silhouetteClassName?: string;
  /**
   * Silhouette fill. "color" (default) paints the mask with the
   * player's colour; "css" leaves the fill to the class's own
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
  framedHeadClassName,
  silhouetteClassName,
  silhouetteFill = "color",
  fallback = null,
}: PlayerMeepleProps) {
  const framed = useOpaqueArtwork(
    framedHeadClassName ? headIconSrc : undefined,
  );
  if (headIconSrc) {
    return (
      <img
        src={headIconSrc}
        alt=""
        aria-hidden
        className={
          framed && framedHeadClassName
            ? `${headClassName ?? ""} ${framedHeadClassName}`
            : headClassName
        }
        style={
          framed ? ({ "--frame-color": color } as CSSProperties) : undefined
        }
      />
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

const opaqueArtwork = new Map<string, boolean>();

// True when all four corner pixels are fully opaque. Any failure to
// read the pixels (no canvas, a tainted image) counts as a cut-out.
const cornersOpaque = (img: HTMLImageElement): boolean => {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    return [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ].every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] === 255);
  } catch {
    return false;
  }
};

/**
 * Whether the image at `src` is opaque to its corners. Measured once
 * per src after it loads and cached for the session; false until then.
 */
const useOpaqueArtwork = (src: string | undefined): boolean => {
  const [opaque, setOpaque] = useState(() =>
    src ? (opaqueArtwork.get(src) ?? false) : false,
  );
  useEffect(() => {
    if (!src) {
      setOpaque(false);
      return;
    }
    const known = opaqueArtwork.get(src);
    if (known !== undefined) {
      setOpaque(known);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const result = cornersOpaque(img);
      opaqueArtwork.set(src, result);
      if (!cancelled) setOpaque(result);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return opaque;
};
