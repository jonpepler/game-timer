"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import styles from "./VictoryBanner.module.css";

interface Player {
  name: string;
  color: string;
  // Optional head crop / silhouette. When present, sits inside the
  // laurel as the hero's portrait. When absent (e.g. Generic flow
  // without per-faction artwork), the banner falls back to a
  // name-led layout — no decorative ring.
  iconSrc?: string;
}

interface VictoryBannerProps {
  victor: Player;
  // Optional laurel asset wrapping the head icon. The timer page
  // resolves it from the active definition's referenceCatalog
  // (Root ships `games/root/vp/laurel.png`). When omitted, the
  // banner collapses to a clean name-led layout.
  laurelSrc?: string;
  // When provided, the banner takes over the whole viewport as a
  // dismissable overlay — clicking the X (or anywhere on the
  // backdrop, or pressing Escape) calls this. When omitted, the
  // banner renders inline.
  onDismiss?: () => void;
}

export function VictoryBanner({
  victor,
  laurelSrc,
  onDismiss,
}: VictoryBannerProps) {
  const hasHero = laurelSrc != null && victor.iconSrc != null;
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
          color: victor.color,
          ["--victor-color" as string]: victor.color,
        } as React.CSSProperties
      }
    >
      {hasHero && (
        <div className={styles.wreath}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={laurelSrc}
            alt=""
            aria-hidden
            className={styles.laurelImg}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={victor.iconSrc}
            alt=""
            aria-hidden
            className={styles.headPortrait}
          />
        </div>
      )}
      <div className={styles.label}>
        <span className={styles.victorName}>{victor.name}</span>
        <span className={styles.suffix}>wins!</span>
      </div>
    </div>
  );

  if (!dismissable) return content;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        // Tap-anywhere dismiss — but inner content shouldn't
        // count if the user is e.g. tap-and-holding to copy
        // text. Only bubble-target dismisses.
        if (e.target === e.currentTarget) onDismiss?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Victory banner"
    >
      {content}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
        className={styles.dismissButton}
        aria-label="Dismiss victory banner"
      >
        <X size={20} aria-hidden />
      </button>
      <div className={styles.dismissHint} aria-hidden>
        Tap anywhere to dismiss
      </div>
    </div>
  );
}
