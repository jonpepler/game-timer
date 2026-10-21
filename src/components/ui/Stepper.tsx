import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./contained";
import { IconButton } from "./IconButton";
import styles from "./Stepper.module.css";

export interface StepperProps {
  value: ReactNode;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement?: boolean;
  canIncrement?: boolean;
  /** Names for the two buttons, e.g. "Decrease score for Ada". */
  decrementLabel: string;
  incrementLabel: string;
  /** Names the value for assistive tech, and announces it as it changes. */
  valueLabel?: string;
  /** compact: 44px buttons, for setup and lists; wide: 56px filled buttons, for scoring. */
  size?: "compact" | "wide";
  /** Draws the stadium track around a compact stepper. Off inside a row that already has a frame. */
  framed?: boolean;
  /** Shown between the minus button and the value, such as whose score it is. */
  children?: ReactNode;
  className?: string;
}

/** One control for "a number with minus and plus", in two sizes. */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  canDecrement = true,
  canIncrement = true,
  decrementLabel,
  incrementLabel,
  valueLabel,
  size = "compact",
  framed = size === "compact",
  children,
  className,
}: StepperProps) {
  const wide = size === "wide";
  return (
    <div
      className={cx(
        styles.stepper,
        wide && styles.wide,
        framed && styles.framed,
        className,
      )}
    >
      <IconButton
        label={decrementLabel}
        size={wide ? "lg" : "md"}
        tone={wide ? "filled" : "outline"}
        tooltip={false}
        disabled={!canDecrement}
        onClick={onDecrement}
      >
        <Minus aria-hidden />
      </IconButton>
      {children && <span className={styles.content}>{children}</span>}
      {valueLabel ? (
        <output className={styles.value} aria-label={valueLabel}>
          {value}
        </output>
      ) : (
        <span className={styles.value}>{value}</span>
      )}
      <IconButton
        label={incrementLabel}
        size={wide ? "lg" : "md"}
        tone={wide ? "filled" : "outline"}
        tooltip={false}
        disabled={!canIncrement}
        onClick={onIncrement}
      >
        <Plus aria-hidden />
      </IconButton>
    </div>
  );
}
