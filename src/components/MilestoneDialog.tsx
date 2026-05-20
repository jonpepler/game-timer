"use client";

/*
 * Fullscreen modal that appears whenever a player's score crosses a
 * configured milestone (see ScoreConfig.milestones). Blocks the rest
 * of the UI — taps anywhere outside the Acknowledge button are
 * ignored — so a quick double-tap on the score control can't dismiss
 * it before the active player notices.
 */
import { useEffect } from "react";
import type { PendingMilestone } from "@/state/gameSession";
import styles from "./MilestoneDialog.module.css";

interface MilestoneDialogProps {
  milestone: PendingMilestone;
  playerName: string;
  playerColor: string;
  playerHeadIconSrc?: string;
  playerIconSrc?: string;
  onDismiss: () => void;
}

export function MilestoneDialog({
  milestone,
  playerName,
  playerColor,
  playerHeadIconSrc,
  playerIconSrc,
  onDismiss,
}: MilestoneDialogProps) {
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
          /* eslint-disable-next-line @next/next/no-img-element */
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
