"use client";

/*
 * Fullscreen, dismiss-required event modal. The score subsystem uses
 * it to announce milestone crossings, but the component is generic —
 * it just renders an avatar / headline / body and an Acknowledge
 * button. Anything that wants to interrupt the game with a "you must
 * see this" prompt can render an EventDialog.
 */
import { useEffect } from "react";
import type { PendingMilestone } from "@/state/gameSession";
import styles from "./EventDialog.module.css";

interface EventDialogProps {
  milestone: PendingMilestone;
  playerName: string;
  playerColor: string;
  playerHeadIconSrc?: string;
  playerIconSrc?: string;
  onDismiss: () => void;
}

export function EventDialog({
  milestone,
  playerName,
  playerColor,
  playerHeadIconSrc,
  playerIconSrc,
  onDismiss,
}: EventDialogProps) {
  // Allow Enter / Space to acknowledge — common keyboard shortcuts
  // for "accept this dialog". Escape is intentionally NOT wired so
  // the player can't dismiss without thinking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="milestone-title"
      aria-describedby="milestone-body"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.card} style={{ borderColor: playerColor }}>
        {playerHeadIconSrc ? (
          <img
            src={playerHeadIconSrc}
            alt=""
            aria-hidden
            className={styles.head}
          />
        ) : playerIconSrc ? (
          <span
            className={styles.meeple}
            aria-hidden
            style={{
              background: playerColor,
              WebkitMaskImage: `url(${playerIconSrc})`,
              maskImage: `url(${playerIconSrc})`,
            }}
          />
        ) : (
          <span
            className={styles.swatch}
            aria-hidden
            style={{ background: playerColor }}
          />
        )}
        <span className={styles.score} style={{ color: playerColor }}>
          {milestone.atScore}
        </span>
        <h2 id="milestone-title" className={styles.title}>
          {playerName} hit {milestone.atScore}
        </h2>
        <p id="milestone-body" className={styles.body}>
          {milestone.label}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className={styles.button}
          style={{ background: playerColor }}
          autoFocus
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}
