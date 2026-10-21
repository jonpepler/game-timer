import type { CSSProperties } from "react";
import { cx } from "./contained";
import styles from "./Text.module.css";

export interface DiscProps {
  /** Any CSS colour; a player colour comes straight from the game's data. */
  color: string;
  /** sm 10px in dense rows, md 14px, lg 20px beside a title. */
  size?: "sm" | "md" | "lg";
  /** A ring in the colour with no fill, for something set aside. */
  hollow?: boolean;
  className?: string;
}

/** A colour identity: a filled circle with a hairline ring. Decorative. */
export function Disc({
  color,
  size = "md",
  hollow = false,
  className,
}: DiscProps) {
  return (
    <span
      aria-hidden
      className={cx(
        styles.disc,
        size === "sm" && styles.discSm,
        size === "lg" && styles.discLg,
        hollow && styles.discHollow,
        className,
      )}
      style={{ "--disc-color": color } as CSSProperties}
    />
  );
}
