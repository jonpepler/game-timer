"use client";

/*
 * Standalone "what's in the share popover" content — the QR + code +
 * URL + footer that appears when the user clicks Share in the timer
 * chrome.
 *
 * Extracted so the wizard can render the same content as a floating
 * side pane next to its first screen (so a host can hand a code to a
 * companion without having to dismiss the wizard first).
 *
 * The component owns its own copy-to-clipboard "Copied" toast state.
 * Status / sessionCode / connectedPeers / close all come from the
 * caller — we don't own the underlying peer session.
 */
import { Copy, Loader2, Share2, X } from "lucide-react";
import { useState } from "react";
import { QrCode } from "./QrCode";
import { buildCompanionUrl } from "@/lib/sessionCode";
import styles from "./SharePanel.module.css";

interface SharePanelProps {
  status: "idle" | "opening" | "open" | "error";
  sessionCode: string | null;
  connectedPeers: string[];
  error: Error | null;
  // Stops the share session — called when the user clicks "Stop
  // sharing" in the footer.
  onClose?: () => void;
  // Dismisses the panel itself without stopping the session. Used by
  // the menu version which can collapse its popover; the wizard
  // version omits this so the X button isn't rendered.
  onDismiss?: () => void;
  // Optional callback used to re-attempt opening from the error
  // state. Defaults to noop; ShareSessionMenu passes its `open` here.
  onRetry?: () => void;
}

export function SharePanel({
  status,
  sessionCode,
  connectedPeers,
  error,
  onClose,
  onDismiss,
  onRetry,
}: SharePanelProps) {
  const [copied, setCopied] = useState<"code" | "url" | null>(null);

  const copy = async (text: string, key: "code" | "url") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard unavailable — values are still selectable in the UI.
    }
  };

  const url = sessionCode ? buildCompanionUrl(sessionCode) : "";

  return (
    <div className={styles.panel} role="dialog" aria-label="Share session">
      <div className={styles.header}>
        <span className={styles.title}>
          <Share2 size={12} aria-hidden />
          {status === "open" ? "Sharing session" : "Share session"}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={styles.closeButton}
            aria-label="Close share panel"
          >
            <X aria-hidden />
          </button>
        )}
      </div>

      {status === "opening" && (
        <div className={styles.loading} role="status">
          <Loader2 size={16} aria-hidden /> Opening session…
        </div>
      )}

      {status === "error" && (
        <div className={styles.errorBlock}>
          <p className={styles.errorMessage}>
            Couldn&apos;t open a share session:{" "}
            {error?.message ?? "unknown error"}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={styles.retryButton}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {status === "open" && sessionCode && (
        <>
          <div className={styles.qrFrame}>
            <QrCode
              value={url}
              size={160}
              alt="QR code for the companion URL"
            />
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

          {onClose && (
            <div className={styles.footerActions}>
              <span className={styles.deviceCount}>
                {connectedPeers.length}{" "}
                {connectedPeers.length === 1 ? "device" : "devices"} connected
              </span>
              <button
                type="button"
                onClick={onClose}
                className={styles.stopButton}
              >
                Stop sharing
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
