import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./contained";
import styles from "./Text.module.css";

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** The outline level: renders h1, h2 or h3. */
  level: 1 | 2 | 3;
  /**
   * The drawn size, 28, 20 or 16px. It follows the level; set it only where
   * the outline and the visual rank differ, such as a dialog's name sitting
   * above the larger title of the step inside it.
   */
  size?: 1 | 2 | 3;
  align?: "start" | "center";
  children: ReactNode;
}

/** A real heading element, so the outline and a theme's display face reach it. */
export function Heading({
  level,
  size = level,
  align = "start",
  className,
  children,
  ...rest
}: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      className={cx(
        styles.heading,
        styles[`size${size}`],
        align === "center" && styles.center,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
