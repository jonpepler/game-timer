import { Crown } from "lucide-react";
import styles from "./VictoryBanner.module.css";

interface Player {
  name: string;
  color: string;
  // Optional silhouette (meeple SVG) — when present, fills the
  // centre of the laurel tinted to the faction colour. When the
  // game definition starts shipping head-icon PNGs, those slot in
  // here too. Falls back to the player's name initial when neither
  // is available.
  iconSrc?: string;
}

interface VictoryBannerProps {
  victor: Player;
  // Optional laurel asset wrapping the head icon. The timer page
  // resolves it from the active definition's referenceCatalog
  // (Root ships `games/root/vp/laurel.png`). When omitted, a
  // CSS-drawn ring + crown placeholder fills in.
  laurelSrc?: string;
}

export function VictoryBanner({ victor, laurelSrc }: VictoryBannerProps) {
  const initial = victor.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.hero}
      style={
        {
          color: victor.color,
          ["--victor-color" as string]: victor.color,
        } as React.CSSProperties
      }
    >
      <div className={styles.wreath}>
        {laurelSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={laurelSrc}
            alt=""
            aria-hidden
            className={styles.laurelImg}
          />
        ) : (
          // Placeholder: a thick coloured ring with a crown floating
          // at the top. Swapped for the real laurel SVG once it
          // lands at /public/factions/root/vp-laurel.svg.
          <>
            <span className={styles.laurelFallbackRing} aria-hidden />
            <span className={styles.laurelFallbackCrown} aria-hidden>
              <Crown size={28} aria-hidden />
            </span>
          </>
        )}
        <span className={styles.headInner} aria-hidden>
          {victor.iconSrc ? (
            // Always render as a real <img> here — head crops are
            // PNGs whose own artwork should come through, and
            // meeple silhouettes look fine sized down to the
            // inner-laurel circle even without the mask tint.
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={victor.iconSrc}
              alt=""
              aria-hidden
              className={styles.headPortrait}
            />
          ) : (
            <span className={styles.headInitial}>{initial}</span>
          )}
        </span>
      </div>
      <div className={styles.label}>
        <span className={styles.victorName}>{victor.name}</span>
        <span className={styles.suffix}>wins!</span>
      </div>
    </div>
  );
}
