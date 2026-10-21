import {
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
  useId,
} from "react";
import { contained, cx } from "./contained";
import styles from "./IconButton.module.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** The accessible name. Required: the glyph alone names nothing. */
  label: string;
  /** The glyph, usually a lucide icon with aria-hidden. */
  children: ReactNode;
  /** md is 44px, the touch target floor; lg is 56px for a cluster's lead. */
  size?: "md" | "lg";
  /** outline by default; filled leads a cluster; plain sits inside a framed row. */
  tone?: "outline" | "filled" | "plain";
  /** round in the page; square in the header bar. */
  shape?: "round" | "square";
  /**
   * Text shown on hover and keyboard focus: the label by default, a longer
   * description when given one, or nothing. Turn it off where an
   * ancestor scrolls and would clip it.
   */
  tooltip?: string | false;
  tooltipPlacement?: "top" | "bottom";
  /** Pins the tooltip to the button's start or end edge, for a button at the screen edge. */
  tooltipAlign?: "center" | "start" | "end";
}

/**
 * A glyph-only button with a required name and a tooltip. Its click never
 * reaches an ancestor, so it cannot advance a turn by accident.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      children,
      size = "md",
      tone = "outline",
      shape = "round",
      tooltip,
      tooltipPlacement = "bottom",
      tooltipAlign = "center",
      className,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) {
    const tooltipId = useId();
    const tip = tooltip === false ? null : (tooltip ?? label);
    // A tooltip that only repeats the name stays out of the accessibility tree.
    const describes = tip !== null && tip !== label;
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-describedby={describes ? tooltipId : undefined}
        className={cx(
          styles.button,
          size === "lg" && styles.lg,
          tone !== "outline" && styles[tone],
          shape === "square" && styles.square,
          className,
        )}
        onClick={contained(onClick)}
        {...rest}
      >
        {children}
        {tip !== null && (
          <span
            id={tooltipId}
            role={describes ? "tooltip" : undefined}
            aria-hidden={describes ? undefined : true}
            className={cx(
              styles.tooltip,
              tooltipPlacement === "top" && styles.tooltipTop,
              tooltipAlign === "start" && styles.tooltipStart,
              tooltipAlign === "end" && styles.tooltipEnd,
            )}
          >
            {tip}
          </span>
        )}
      </button>
    );
  },
);
