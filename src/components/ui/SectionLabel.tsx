import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./contained";
import styles from "./Text.module.css";

type LabelElement =
  | "p"
  | "span"
  | "div"
  | "legend"
  | "h2"
  | "h3"
  | "label"
  | "figcaption";

export interface SectionLabelProps
  extends HTMLAttributes<HTMLElement>,
    Pick<LabelHTMLAttributes<HTMLLabelElement>, "htmlFor"> {
  /** The element: a legend inside a fieldset, a label for a field, a heading for a section. */
  as?: LabelElement;
  children: ReactNode;
}

/** The small uppercase label over a group of controls or a section. */
export function SectionLabel({
  as: Tag = "p",
  className,
  children,
  ...rest
}: SectionLabelProps) {
  return (
    <Tag className={cx(styles.label, className)} {...rest}>
      {children}
    </Tag>
  );
}
