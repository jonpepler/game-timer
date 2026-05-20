import { Crown } from "lucide-react";
import styles from "./VictoryBanner.module.css";

interface Player {
  name: string;
  color: string;
}

interface VictoryBannerProps {
  victor: Player;
}

export function VictoryBanner({ victor }: VictoryBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.banner}
      style={{ color: victor.color }}
    >
      <span className={styles.crown}>
        <Crown size={32} aria-hidden />
      </span>
      <span
        className={styles.swatch}
        style={{ background: victor.color }}
        aria-hidden
      />
      {victor.name}
      <span className={styles.suffix}>wins!</span>
    </div>
  );
}
