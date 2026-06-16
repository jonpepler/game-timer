"use client";

/*
 * Fullscreen, dismiss-required picker for "who leads the next round?".
 * The lead-relative turn order renders this when a round ends with no
 * interrupt (Arcs: nobody seized, so the highest surpasser — which the
 * timer can't observe — takes initiative). Generic: it just lists the
 * seated players and reports the chosen index. No pre-selection — the
 * table must tap an explicit answer.
 */
import { useEffect } from "react";
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
}

export function LeadPrompt({ label, players, onPick }: LeadPromptProps) {
  // Number keys 1..9 select the matching seat — quick on a shared
  // table device. Escape is intentionally NOT wired: a round can't
  // proceed until the lead is named.
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
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="lead-prompt-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.card}>
        <h2 id="lead-prompt-title" className={styles.title}>
          {label}
        </h2>
        <ul className={styles.list}>
          {players.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button
                type="button"
                className={styles.option}
                style={{ borderColor: p.color }}
                onClick={() => onPick(i)}
              >
                {p.headIconSrc ? (
                  <img
                    src={p.headIconSrc}
                    alt=""
                    aria-hidden
                    className={styles.head}
                  />
                ) : p.iconSrc ? (
                  <span
                    className={styles.meeple}
                    aria-hidden
                    style={{
                      background: p.color,
                      WebkitMaskImage: `url(${p.iconSrc})`,
                      maskImage: `url(${p.iconSrc})`,
                    }}
                  />
                ) : (
                  <span
                    className={styles.swatch}
                    aria-hidden
                    style={{ background: p.color }}
                  />
                )}
                <span className={styles.name}>{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
