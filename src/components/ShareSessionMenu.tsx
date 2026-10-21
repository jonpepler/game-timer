"use client";

import { Loader2, RotateCw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Disc, IconButton, VisuallyHidden } from "@/components/ui";
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
      <IconButton label="Share this session" shape="square" onClick={open}>
        <Share2 aria-hidden />
      </IconButton>
    );
  }

  if (status === "opening") {
    return (
      <span className={styles.chip} role="status">
        <Loader2 aria-hidden />
        <VisuallyHidden>Opening…</VisuallyHidden>
      </span>
    );
  }

  if (status === "error") {
    return (
      <IconButton
        label="Retry opening the share session"
        tooltip={`${error?.message ?? "Failed"}: retry`}
        shape="square"
        onClick={open}
      >
        <RotateCw aria-hidden />
      </IconButton>
    );
  }

  // status === "open": the code stays readable in the bar, since the
  // table reads it aloud to anyone joining.
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not an interactive element
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard only, not an interactive element
    <div className={styles.openWrapper} ref={wrapperRef} onClick={stop}>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        className={styles.chip}
        aria-expanded={popoverOpen}
        aria-label={`Sharing session ${sessionCode ?? ""}, ${connectedPeers.length} connected`}
      >
        <Disc color="var(--color-success)" size="sm" />
        <span className={styles.code}>{sessionCode}</span>
        <span className={styles.count}>· {connectedPeers.length}</span>
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
