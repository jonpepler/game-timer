"use client";

import { Loader2, Share2, X } from "lucide-react";
import { useState } from "react";
import styles from "./ShareSessionMenu.module.css";

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
  const [copied, setCopied] = useState(false);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sessionCode) return;
    try {
      await navigator.clipboard.writeText(sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context, permission denied) —
      // the code is still selectable in the UI.
    }
  };

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
    <div className={styles.openSession} onClick={stop}>
      <Share2 size={14} aria-hidden />
      <span className={styles.codeLabel}>Code</span>
      <code
        className={styles.code}
        onClick={handleCopy}
        title="Click to copy"
      >
        {sessionCode}
      </code>
      {copied && <span className={styles.copied}>copied</span>}
      <span className={styles.divider} aria-hidden />
      <span className={styles.count}>
        {connectedPeers.length}{" "}
        {connectedPeers.length === 1 ? "device" : "devices"}
      </span>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          close();
        }}
        className={styles.closeButton}
        aria-label="Stop sharing this session"
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
