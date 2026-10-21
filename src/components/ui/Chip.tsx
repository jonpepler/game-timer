import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";
import styles from "./Chip.module.css";
import { contained, cx } from "./contained";
import { VisuallyHidden } from "./VisuallyHidden";

export type ChipTone =
  | "outline"
  | "solid"
  | "muted"
  | "success"
  | "warning"
  | "danger";

interface ChipBaseProps {
  tone?: ChipTone;
  /** Drawn before the label: a Disc or a token. */
  leading?: ReactNode;
  children: ReactNode;
}

interface StaticChipProps
  extends ChipBaseProps,
    Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  onPress?: undefined;
  pressed?: undefined;
}

interface ActionableChipProps
  extends ChipBaseProps,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "children" | "onClick" | "aria-pressed"
    > {
  onPress: MouseEventHandler<HTMLButtonElement>;
  /** Whether this value is chosen, for a chip that picks one of several. */
  pressed?: boolean;
}

export type ChipProps = StaticChipProps | ActionableChipProps;

const TONE: Record<ChipTone, string | undefined> = {
  outline: undefined,
  solid: styles.solid,
  muted: styles.muted,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

/**
 * A short stadium label. Without onPress it is a static status mark; with
 * onPress it becomes a 44px button that picks a value (pass pressed to show
 * the choice), and its click never reaches an ancestor. For a command, use a
 * Button.
 */
export function Chip(props: ChipProps) {
  if (props.onPress) {
    const {
      tone = "outline",
      leading,
      className,
      type = "button",
      onPress,
      pressed,
      children,
      ...rest
    } = props;
    return (
      <button
        type={type}
        aria-pressed={pressed}
        className={cx(styles.chip, styles.actionable, TONE[tone], className)}
        onClick={contained(onPress)}
        {...rest}
      >
        {leading}
        {children}
      </button>
    );
  }
  const {
    tone = "outline",
    leading,
    className,
    onPress: _onPress,
    pressed: _pressed,
    children,
    ...rest
  } = props;
  return (
    <span className={cx(styles.chip, TONE[tone], className)} {...rest}>
      {leading}
      {children}
    </span>
  );
}

/** Lays chips out in a wrapping row. */
export function ChipRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx(styles.group, className)}>{children}</div>;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** Names the group for assistive tech. */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** One of a few views, as joined toggle buttons. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <fieldset className={cx(styles.segmented, className)}>
      <VisuallyHidden as="legend">{label}</VisuallyHidden>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.segment}
          aria-pressed={o.value === value}
          onClick={contained(() => onChange(o.value))}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
