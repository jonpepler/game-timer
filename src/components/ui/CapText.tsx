import type { HTMLAttributes } from "react";
import { cx } from "./contained";
import styles from "./CapText.module.css";

/**
 * Text that sits beside an icon. Its box is trimmed to the letters, so a
 * row that centres items centres the icon on the visible text in every
 * theme face.
 */
export function CapText({
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx(styles.text, className)} {...rest} />;
}
