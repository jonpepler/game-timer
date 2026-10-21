"use client";

import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { cx } from "./contained";
import { Heading } from "./Heading";
import styles from "./Sheet.module.css";

export interface BackdropProps extends HTMLAttributes<HTMLDivElement> {
  /** hero sits under prompts and sheets; prompt under sheets. */
  layer?: "hero" | "prompt" | "sheet";
}

/**
 * The full-screen layer under a sheet, a prompt or a hero moment: it
 * dims the page and keeps every tap from reaching it. Use Sheet or Prompt
 * for a question; use this alone only for a full-screen moment that
 * draws its own content.
 */
export function Backdrop({
  layer = "sheet",
  className,
  onClick,
  children,
  ...rest
}: BackdropProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard; a role comes from the caller
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard; keys are handled by the caller
    <div
      className={cx(
        styles.backdrop,
        layer !== "sheet" && styles[layer],
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Open sheets, oldest first. Only the newest answers Escape. */
const openSheets: string[] = [];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  title: ReactNode;
  /** An identity mark drawn before the title, such as a Disc. */
  titleMark?: ReactNode;
  subtitle?: ReactNode;
  /** Pinned below the scrolling body: the sheet's buttons. */
  actions?: ReactNode;
  /**
   * Called on Escape. Leave it out for a question the table must answer;
   * the sheet then has no way out but its own buttons.
   */
  onDismiss?: () => void;
  /** Takes focus when the sheet opens; the first button does otherwise. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** A colour for the frame, such as the player a prompt is about. */
  accentColor?: string;
  /** Centres the body, for an announcement rather than a form. */
  centred?: boolean;
  /**
   * md for a question, wide for a form with many choices, grid for a
   * ChoiceGrid of tiles on a wide screen.
   */
  width?: "md" | "wide" | "grid";
  /** An id for the body text when it describes the whole sheet. */
  describedBy?: string;
  children?: ReactNode;
  /** @internal set by Prompt */
  role?: "dialog" | "alertdialog";
}

/**
 * A modal sheet: a centred card on a wide screen, a bottom sheet on a
 * phone. Escape closes the newest one, Tab stays inside it, focus comes
 * back where it was when it closes, and no click inside reaches the page,
 * so nothing in it can advance a turn.
 */
export function Sheet({
  title,
  titleMark,
  subtitle,
  actions,
  onDismiss,
  initialFocus,
  accentColor,
  centred = false,
  width = "md",
  describedBy,
  children,
  role = "dialog",
}: SheetProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const cardRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sheet takes focus once, as it opens
  useEffect(() => {
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    openSheets.push(id);
    const first =
      initialFocus?.current ??
      cardRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || openSheets[openSheets.length - 1] !== id)
        return;
      if (!onDismissRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      openSheets.splice(openSheets.indexOf(id), 1);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [id]);

  // Tab and Shift+Tab wrap inside the card.
  const trapFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const focusable = Array.from(
      cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <Backdrop
      layer={role === "alertdialog" ? "prompt" : "sheet"}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the card only keeps Tab inside itself */}
      <div
        ref={cardRef}
        className={cx(
          styles.card,
          width === "wide" && styles.wide,
          width === "grid" && styles.grid,
        )}
        style={
          accentColor
            ? ({ "--sheet-accent": accentColor } as CSSProperties)
            : undefined
        }
        onKeyDown={trapFocus}
      >
        <div className={styles.header}>
          <Heading level={2} id={titleId} className={styles.title}>
            {titleMark}
            <span>{title}</span>
          </Heading>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {children && (
          <div className={cx(styles.body, centred && styles.centred)}>
            {children}
          </div>
        )}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </Backdrop>
  );
}

export type PromptProps = Omit<SheetProps, "role">;

/**
 * A Sheet that interrupts: a question or announcement the table answers
 * before play goes on. Assistive tech hears it as an alert dialog, and it
 * sits beneath any Sheet opened from it.
 */
export function Prompt(props: PromptProps) {
  return <Sheet {...props} role="alertdialog" />;
}
