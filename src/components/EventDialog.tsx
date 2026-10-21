"use client";

/*
 * Must-see event prompt. The score subsystem uses it to announce
 * milestone crossings, but the component is generic: it renders an
 * avatar, a headline, a body and an Acknowledge button.
 */
import { useEffect, useId, useRef } from "react";
import { Button, Prompt } from "@/components/ui";
import type { PendingMilestone } from "@/state/gameSession";
import styles from "./EventDialog.module.css";
import { PlayerMark } from "./LeadPrompt";

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
  const bodyId = useId();
  const acknowledgeRef = useRef<HTMLButtonElement>(null);

  // Enter or Space acknowledges. Escape is intentionally not wired so the
  // player can't dismiss it without reading it.
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
    <Prompt
      title={`${playerName} hit ${milestone.atScore}`}
      accentColor={playerColor}
      describedBy={bodyId}
      initialFocus={acknowledgeRef}
      centred
      actions={
        <Button
          ref={acknowledgeRef}
          variant="primary"
          fullWidth
          onClick={onDismiss}
        >
          Acknowledge
        </Button>
      }
    >
      <span className={styles.avatar}>
        <PlayerMark
          player={{
            name: playerName,
            color: playerColor,
            headIconSrc: playerHeadIconSrc,
            iconSrc: playerIconSrc,
          }}
        />
      </span>
      <span className={styles.score} style={{ color: playerColor }}>
        {milestone.atScore}
      </span>
      <p id={bodyId} className={styles.body}>
        {milestone.label}
      </p>
    </Prompt>
  );
}
