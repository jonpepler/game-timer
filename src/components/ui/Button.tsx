import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  Children,
  Fragment,
  isValidElement,
  type ComponentProps,
  forwardRef,
  type ReactNode,
} from "react";
import styles from "./Button.module.css";
import { CapText } from "./CapText";
import { contained, cx } from "./contained";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonLook {
  /**
   * primary: the one main action of a prompt or setup screen (never on the
   * timer screen). secondary: every other action, including the turn and
   * round controls. ghost: a quiet text action. danger: removes something.
   */
  variant?: ButtonVariant;
  /**
   * Both sizes are 44px tall, the touch target floor: sm only tightens
   * type and padding for dense panels. There is no larger size, so a
   * primary button is always the same size as the buttons beside it.
   */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Ends a long label in an ellipsis instead of wrapping it. */
  truncate?: boolean;
}

/**
 * Text children sit in a label trimmed to its letters, so a label centres
 * on the icon beside it by its caps rather than by its font's line box,
 * whose ascent and descent differ from face to face.
 */
const flatten = (children: ReactNode): ReactNode[] =>
  Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  );

/**
 * Neighbouring text, such as "Up to " and a number, shares one label: split
 * across two, the space between them would collapse at the label's edge.
 */
const wrapText = (children: ReactNode): ReactNode => {
  const out: ReactNode[] = [];
  let run: Array<string | number> = [];
  const endRun = () => {
    if (run.length === 0) return;
    out.push(
      <CapText key={`text-${out.length}`} className={styles.label}>
        {run.join("")}
      </CapText>,
    );
    run = [];
  };
  for (const child of flatten(children)) {
    if (typeof child === "string" || typeof child === "number") run.push(child);
    else {
      endRun();
      out.push(child);
    }
  }
  endRun();
  return out;
};

const label = (children: ReactNode, truncate: boolean) =>
  truncate ? (
    <CapText className={styles.label}>{children}</CapText>
  ) : (
    wrapText(children)
  );

/** The class list for a button look, for an element the kit cannot render. */
export const buttonClassName = ({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  truncate = false,
}: ButtonLook = {}) =>
  cx(
    styles.button,
    styles[variant],
    size !== "md" && styles[size],
    fullWidth && styles.fullWidth,
    truncate && styles.truncate,
  );

export interface ButtonProps
  extends ButtonLook,
    ButtonHTMLAttributes<HTMLButtonElement> {
  /** A leading icon, drawn at the size's icon size. */
  icon?: ReactNode;
}

/**
 * A text button. Its click never reaches an ancestor, so no button can
 * advance a turn by accident.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      fullWidth,
      truncate,
      icon,
      className,
      type = "button",
      onClick,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          buttonClassName({ variant, size, fullWidth, truncate }),
          className,
        )}
        onClick={contained(onClick)}
        {...rest}
      >
        {icon}
        {label(children, truncate ?? false)}
      </button>
    );
  },
);

export type ButtonLinkProps = ButtonLook &
  ComponentProps<typeof Link> & { icon?: ReactNode };

/** A link drawn as a button, for navigation that reads as an action. */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  truncate,
  icon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={cx(
        buttonClassName({ variant, size, fullWidth, truncate }),
        className,
      )}
      {...rest}
    >
      {icon}
      {label(children, truncate ?? false)}
    </Link>
  );
}
