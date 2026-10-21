import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./contained";
import styles from "./VisuallyHidden.module.css";

type HiddenElement = "span" | "p" | "div" | "legend" | "h2" | "h3" | "label";

interface VisuallyHiddenProps
  extends HTMLAttributes<HTMLElement>,
    Pick<LabelHTMLAttributes<HTMLLabelElement>, "htmlFor"> {
  as?: HiddenElement;
  children: ReactNode;
}

/** Text for assistive tech only: read aloud, never drawn. */
export function VisuallyHidden({
  as: Tag = "span",
  className,
  children,
  ...rest
}: VisuallyHiddenProps) {
  return (
    <Tag className={cx(styles.hidden, className)} {...rest}>
      {children}
    </Tag>
  );
}
