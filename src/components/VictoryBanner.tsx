"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { Backdrop, Heading, IconButton, SectionLabel } from "@/components/ui";
import styles from "./VictoryBanner.module.css";

interface Player {
  name: string;
  color: string;
  // Optional head crop / silhouette. When present, sits inside the
  // laurel as the hero's portrait. When absent (a game without
  // per-player artwork), the banner falls back to a name-led layout
  // with no decorative ring.
  iconSrc?: string;
}

interface VictoryBannerProps {
  // Who won, when the game names a winner.
  victor?: Player;
  /**
   * How the game ended, as the game words it: the title heads the
   * banner (and stands in for a winner when there is none), the body
   * explains it.
   */
  outcome?: { title: string; body?: string };
  // What the table does next, as a short list under the banner.
  notes?: readonly string[];
  // Optional laurel asset wrapping the head icon. The timer page
  // resolves it from the active definition's referenceCatalog
  // (a game ships one under its own asset folder). When omitted, the
  // banner collapses to a clean name-led layout.
  laurelSrc?: string;
  // When provided, the banner takes over the whole viewport as a
  // dismissable overlay: clicking the X (or anywhere on the
  // backdrop, or pressing Escape) calls this. When omitted, the
  // banner renders inline.
  onDismiss?: () => void;
}

export function VictoryBanner({
  victor,
  outcome,
  notes,
  laurelSrc,
  onDismiss,
}: VictoryBannerProps) {
  const hasHero = laurelSrc != null && victor?.iconSrc != null;
  const dismissable = onDismiss != null;

  // Escape dismisses the overlay when it's active. Wired here so
  // any parent rendering the banner full-screen gets the keyboard
  // affordance for free.
  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissable, onDismiss]);

  const content = (
    <div
      role="status"
      aria-live="polite"
      className={styles.hero}
      style={
        {
          color: victor?.color ?? "var(--color-text)",
          ["--victor-color" as string]: victor?.color ?? "var(--color-text)",
        } as React.CSSProperties
      }
    >
      {victor && outcome && (
        <Heading
          level={2}
          size={1}
          align="center"
          className={styles.outcomeTitle}
        >
          {outcome.title}
        </Heading>
      )}
      {hasHero && (
        <div className={styles.wreath}>
          <img
            src={laurelSrc}
            alt=""
            aria-hidden
            className={styles.laurelImg}
          />
          <img
            src={victor.iconSrc}
            alt=""
            aria-hidden
            className={styles.headPortrait}
          />
        </div>
      )}
      {victor ? (
        <div className={styles.label}>
          {/* Without a portrait the name carries the identity: drawn in the
              ink so it reads on any ground, underlined in the winner's colour. */}
          <span
            className={hasHero ? styles.victorName : styles.victorNamePlain}
          >
            {victor.name}
          </span>
          <span className={styles.suffix}>wins!</span>
        </div>
      ) : (
        outcome && (
          <div className={styles.label}>
            <span className={styles.victorName}>{outcome.title}</span>
          </div>
        )
      )}
      {outcome?.body && <p className={styles.outcomeBody}>{outcome.body}</p>}
      {notes && notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!dismissable) return content;

  return (
    <Backdrop
      layer="hero"
      className={styles.overlay}
      onClick={(e) => {
        // Tap-anywhere dismiss, but a tap on the content itself (a
        // long-press to copy the name, say) does not count.
        if (e.target === e.currentTarget) onDismiss?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={victor ? "Victory banner" : "Game over"}
    >
      {content}
      <IconButton
        label="Dismiss victory banner"
        tone="filled"
        tooltipAlign="end"
        className={styles.dismissButton}
        onClick={() => onDismiss?.()}
      >
        <X aria-hidden />
      </IconButton>
      <SectionLabel className={styles.dismissHint} aria-hidden>
        Tap anywhere to dismiss
      </SectionLabel>
    </Backdrop>
  );
}
