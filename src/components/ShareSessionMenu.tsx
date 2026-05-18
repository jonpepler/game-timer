"use client";

import { Copy, Loader2, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./ShareSessionMenu.module.css";
import { QrCode } from "./QrCode";
import { buildCompanionUrl } from "@/lib/sessionCode";

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
  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Auto-open the popover when the session goes from opening → open
  // (the user just clicked Share; they want to see the QR).
  useEffect(() => {
    if (status === "open") setPopoverOpen(true);
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

  const copy = async (text: string, key: "code" | "url") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard unavailable — values are still selectable in the UI.
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
  const url = sessionCode ? buildCompanionUrl(sessionCode) : "";

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
        <div className={styles.popover} role="dialog" aria-label="Share session">
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>
              <Share2 size={12} aria-hidden />
              Sharing session
            </span>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className={styles.closeButton}
              aria-label="Close share panel"
            >
              <X aria-hidden />
            </button>
          </div>

          <div className={styles.qrFrame}>
            <QrCode value={url} size={160} alt="QR code for the companion URL" />
          </div>

          <div className={styles.codeRow}>
            <span className={styles.codeLabel}>Code</span>
            <div className={styles.codeValue}>
              <span>{sessionCode}</span>
              <button
                type="button"
                onClick={() => copy(sessionCode, "code")}
                className={styles.copyButton}
                aria-label="Copy session code"
              >
                <Copy aria-hidden />
                {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className={styles.codeRow}>
            <span className={styles.codeLabel}>Link</span>
            <div className={styles.urlValue}>{url}</div>
            <button
              type="button"
              onClick={() => copy(url, "url")}
              className={styles.copyButton}
              aria-label="Copy companion URL"
            >
              <Copy aria-hidden />
              {copied === "url" ? "Copied" : "Copy link"}
            </button>
          </div>

          <p className={styles.help}>
            Scan the QR, or open the link in a browser on a phone to join.
          </p>

          <div className={styles.footerActions}>
            <span className={styles.chipCount}>
              {connectedPeers.length}{" "}
              {connectedPeers.length === 1 ? "device" : "devices"} connected
            </span>
            <button
              type="button"
              onClick={() => {
                close();
                setPopoverOpen(false);
              }}
              className={styles.stopButton}
            >
              Stop sharing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
