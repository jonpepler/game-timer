"use client";

import { Loader2, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./ShareSessionMenu.module.css";
import { SharePanel } from "./SharePanel";

interface ShareSessionMenuProps {
  status: "idle" | "opening" | "open" | "error";
  sessionCode: string | null;
  connectedPeers: string[];
  error: Error | null;
  open: () => void;
  close: () => void;
}

export function ShareSessionMenu({
  status,
  sessionCode,
  connectedPeers,
  error,
  open,
  close,
}: ShareSessionMenuProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Collapse the popover whenever the session drops to idle (user
  // hit Stop sharing). The popover no longer auto-opens on
  // status → open: with the wizard's side-pane SharePanel showing
  // the QR on first mount, auto-popping the chrome popover stacked
  // two copies of the same UI. Users open the chrome popover
  // explicitly by clicking the chip.
  useEffect(() => {
    if (status === "idle") setPopoverOpen(false);
  }, [status]);

  // Click-outside to dismiss the popover.
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [popoverOpen]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (status === "idle") {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          open();
        }}
        className={styles.button}
        aria-label="Share this session"
      >
        <Share2 size={16} aria-hidden />
        Share
      </button>
    );
  }

  if (status === "opening") {
    return (
      <span className={styles.opening} role="status">
        <Loader2 size={14} aria-hidden />
        Opening…
      </span>
    );
  }

  if (status === "error") {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          open();
        }}
        className={styles.button}
        aria-label="Retry opening the share session"
      >
        <Share2 size={16} aria-hidden />
        <span className={styles.errorMessage}>
          {error?.message ?? "Failed"}
        </span>
        Retry
      </button>
    );
  }

  // status === "open"
  return (
    <div className={styles.openWrapper} ref={wrapperRef} onClick={stop}>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        className={styles.openChip}
        aria-expanded={popoverOpen}
        aria-label={`Sharing session ${sessionCode ?? ""}, ${connectedPeers.length} connected`}
      >
        <span className={styles.dot} aria-hidden />
        <span className={styles.chipCode}>{sessionCode}</span>
        <span className={styles.chipCount}>· {connectedPeers.length}</span>
      </button>

      {popoverOpen && sessionCode && (
        <div className={styles.popoverWrap}>
          <SharePanel
            status={status}
            sessionCode={sessionCode}
            connectedPeers={connectedPeers}
            error={error}
            onClose={() => {
              close();
              setPopoverOpen(false);
            }}
            onDismiss={() => setPopoverOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
