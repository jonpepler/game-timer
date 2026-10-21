import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { contained, cx } from "./contained";
import styles from "./ListRow.module.css";

export interface ListRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  /** Drawn first: a head, a Disc, or a glyph (set leadWell for a glyph). */
  lead?: ReactNode;
  /** Sets the lead in a round well, for an action glyph. */
  leadWell?: boolean;
  label: ReactNode;
  /** A line of detail under the label. */
  hint?: ReactNode;
  /** A value at the far end, such as the number a choice leads to. */
  trailing?: ReactNode;
  /** An entry's colour: the whole border takes it. */
  color?: string;
  /** For a choice that stays chosen; omit for a row that acts at once. */
  pressed?: boolean;
  tone?: "default" | "danger";
  /**
   * "adaptive" stays a row on a phone and becomes a tile on a wide screen
   * (glyph and value across the top, then the label and hint), for a
   * ChoiceGrid.
   */
  layout?: "row" | "adaptive";
}

/**
 * A full-width selectable row for prompts, sheets and setup lists. Its click
 * never reaches an ancestor.
 */
export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(
  function ListRow(
    {
      lead,
      leadWell = false,
      label,
      hint,
      trailing,
      color,
      pressed,
      tone = "default",
      layout = "row",
      className,
      style,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={pressed}
        className={cx(
          styles.row,
          tone === "danger" && styles.danger,
          layout === "adaptive" && styles.adaptive,
          className,
        )}
        style={
          color ? ({ ...style, "--row-color": color } as CSSProperties) : style
        }
        onClick={contained(onClick)}
        {...rest}
      >
        {lead && (
          <span className={cx(styles.lead, leadWell && styles.iconWell)}>
            {lead}
          </span>
        )}
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          {hint && <span className={styles.hint}>{hint}</span>}
        </span>
        {trailing !== undefined && (
          <span className={styles.trailing}>{trailing}</span>
        )}
      </button>
    );
  },
);

/**
 * A list of choices: stacked rows on a phone, a grid of tiles on a wide
 * screen. Give each ListRow layout="adaptive".
 */
export function ChoiceGrid({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cx(styles.grid, className)} {...rest}>
      {children}
    </ul>
  );
}
