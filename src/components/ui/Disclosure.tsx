"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { contained, cx } from "./contained";
import styles from "./Disclosure.module.css";

export interface DisclosureProps {
  /** The section's name, on the control that shows or hides it. */
  label: ReactNode;
  /** Set to control it; leave out and it keeps its own state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A section that stays folded until asked for, for choices most people
 * pass over. The control reports whether it is expanded and names the
 * region it reveals.
 */
export function Disclosure({
  label,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: DisclosureProps) {
  const panelId = useId();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const expanded = open ?? ownOpen;
  return (
    <div className={cx(styles.disclosure, className)}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={contained(() => {
          setOwnOpen(!expanded);
          onOpenChange?.(!expanded);
        })}
      >
        <ChevronRight aria-hidden className={styles.chevron} />
        <span>{label}</span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
