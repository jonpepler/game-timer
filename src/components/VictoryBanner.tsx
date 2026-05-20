import styles from "./VictoryBanner.module.css";

interface Player {
  name: string;
  color: string;
  // Optional head crop / silhouette. When present, sits inside the
  // laurel as the hero's portrait. When absent (e.g. Generic flow
  // without per-faction artwork), the banner falls back to a
  // name-led layout — no decorative ring.
  iconSrc?: string;
}

interface VictoryBannerProps {
  victor: Player;
  // Optional laurel asset wrapping the head icon. The timer page
  // resolves it from the active definition's referenceCatalog
  // (Root ships `games/root/vp/laurel.png`). When omitted, the
  // banner collapses to a clean name-led layout.
  laurelSrc?: string;
}

export function VictoryBanner({ victor, laurelSrc }: VictoryBannerProps) {
  const hasHero = laurelSrc != null && victor.iconSrc != null;
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
      {hasHero && (
        <div className={styles.wreath}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={laurelSrc}
            alt=""
            aria-hidden
            className={styles.laurelImg}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={victor.iconSrc}
            alt=""
            aria-hidden
            className={styles.headPortrait}
          />
        </div>
      )}
      <div className={styles.label}>
        <span className={styles.victorName}>{victor.name}</span>
        <span className={styles.suffix}>wins!</span>
      </div>
    </div>
  );
}
