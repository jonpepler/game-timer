"use client";

/*
 * Must-answer picker for "who leads the next round?". The lead-relative
 * turn order renders this when a round ends with no control having
 * claimed the next lead, for games where the lead can change in ways the
 * timer can't observe. It lists the seated players and reports the
 * chosen index. No pre-selection: the table must tap an explicit answer.
 */
import { useEffect } from "react";
import { Button, Disc, ListRow, Prompt } from "@/components/ui";
import styles from "./LeadPrompt.module.css";

export interface LeadPromptPlayer {
  name: string;
  color: string;
  headIconSrc?: string;
  iconSrc?: string;
}

interface LeadPromptProps {
  label: string;
  players: LeadPromptPlayer[];
  onPick: (seatIndex: number) => void;
  // Optional way out, for pickers reached from an earlier choice that
  // the table may want to revisit.
  onBack?: () => void;
  backLabel?: string;
}

/** A player's face for a row: their head art, meeple or colour. */
export function PlayerMark({ player }: { player: LeadPromptPlayer }) {
  if (player.headIconSrc)
    return (
      <img
        src={player.headIconSrc}
        alt=""
        aria-hidden
        className={styles.head}
      />
    );
  if (player.iconSrc)
    return (
      <span
        className={styles.meeple}
        aria-hidden
        style={{
          background: player.color,
          WebkitMaskImage: `url(${player.iconSrc})`,
          maskImage: `url(${player.iconSrc})`,
        }}
      />
    );
  return <Disc color={player.color} size="lg" />;
}

export function LeadPrompt({
  label,
  players,
  onPick,
  onBack,
  backLabel = "Back",
}: LeadPromptProps) {
  // Number keys 1..9 select the matching seat, quick on a shared table
  // device. Escape is intentionally not wired: a round can't proceed
  // until the lead is named.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number.parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= players.length) {
        e.preventDefault();
        onPick(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [players.length, onPick]);

  return (
    <Prompt
      title={label}
      actions={
        onBack && (
          <Button variant="ghost" fullWidth onClick={onBack}>
            {backLabel}
          </Button>
        )
      }
    >
      <ul className={styles.list}>
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`}>
            <ListRow
              color={p.color}
              lead={<PlayerMark player={p} />}
              label={p.name}
              onClick={() => onPick(i)}
            />
          </li>
        ))}
      </ul>
    </Prompt>
  );
}
