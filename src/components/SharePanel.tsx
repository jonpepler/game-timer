"use client";

/*
 * Standalone "what's in the share popover" content: the QR + code +
 * URL + footer that appears when the user clicks Share in the timer
 * chrome.
 *
 * Extracted so the wizard can render the same content as a floating
 * side pane next to its first screen (so a host can hand a code to a
 * companion without having to dismiss the wizard first).
 *
 * The component owns its own copy-to-clipboard "Copied" toast state.
 * Status / sessionCode / connectedPeers / close all come from the
 * caller: we don't own the underlying peer session.
 */
import { Copy, Loader2, Share2, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, SectionLabel } from "@/components/ui";
import { QrCode } from "./QrCode";
import { buildCompanionUrl } from "@/lib/sessionCode";
import styles from "./SharePanel.module.css";

interface SharePanelProps {
  status: "idle" | "opening" | "open" | "error";
  sessionCode: string | null;
  connectedPeers: string[];
  error: Error | null;
  // Stops the share session: called when the user clicks "Stop
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
      // Clipboard unavailable: values are still selectable in the UI.
    }
  };

  const url = sessionCode ? buildCompanionUrl(sessionCode) : "";

  return (
    <div className={styles.panel} role="dialog" aria-label="Share session">
      <div className={styles.header}>
        <SectionLabel as="span" className={styles.title}>
          <Share2 aria-hidden />
          {status === "open" ? "Sharing session" : "Share session"}
        </SectionLabel>
        {onDismiss && (
          <IconButton
            label="Close share panel"
            tooltip={false}
            onClick={onDismiss}
          >
            <X aria-hidden />
          </IconButton>
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
            {error?.message === "Lost connection to server."
              ? "The PeerJS broker dropped our connection. This usually fixes itself in a few seconds: try again, or switch networks if it persists."
              : `Couldn't open a share session: ${error?.message ?? "unknown error"}`}
          </p>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
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
            <SectionLabel as="span">Code</SectionLabel>
            <div className={styles.codeValue}>
              <span>{sessionCode}</span>
              <Button
                size="sm"
                icon={<Copy aria-hidden />}
                className={styles.copyButton}
                onClick={() => copy(sessionCode, "code")}
                aria-label="Copy session code"
              >
                {copied === "code" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className={styles.codeRow}>
            <SectionLabel as="span">Link</SectionLabel>
            <div className={styles.urlValue}>{url}</div>
            <Button
              size="sm"
              icon={<Copy aria-hidden />}
              className={styles.copyButton}
              onClick={() => copy(url, "url")}
              aria-label="Copy companion URL"
            >
              {copied === "url" ? "Copied" : "Copy link"}
            </Button>
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
              <Button size="sm" onClick={onClose}>
                Stop sharing
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
