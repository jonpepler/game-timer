"use client";

/*
 * On-screen log panel for debugging real-device sessions where the
 * browser console isn't accessible. Tap the bug icon in the
 * bottom-right to open a panel listing the last N log entries
 * (filtered by level, with copy / clear actions). Hidden behind a
 * single chrome button so it doesn't intrude on normal use.
 */
import { Bug, Copy, Trash2, Wifi, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./DebugLogOverlay.module.css";
import {
  type LogEntry,
  type LogLevel,
  clearLogBuffer,
  createLogger,
  getLogBuffer,
  subscribeLogs,
} from "@/lib/logger";

// Build-time SHA from the GH Actions workflow; falls back to a
// readable placeholder for local dev builds.
const COMMIT_SHA =
  (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "").slice(0, 7) || "dev";

const probeLog = createLogger("ws-probe");
const envLog = createLogger("env");

// Open a RAW WebSocket and log every event with timing. Used by the
// diagnostic buttons to distinguish "broker rejects this device" from
// "device can't do WSS to anywhere". `tag` shows up in the log entry
// so two side-by-side probes are easy to tell apart.
function probeWss(tag: string, url: string) {
  probeLog.info(`${tag} probe opening`, { url });
  const start = Date.now();
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    probeLog.error(`${tag} probe constructor threw`, { error: String(err) });
    return;
  }
  const elapsed = () => `${Date.now() - start}ms`;
  ws.onopen = () =>
    probeLog.info(`${tag} probe onopen`, { elapsed: elapsed() });
  ws.onmessage = (e) =>
    probeLog.info(`${tag} probe onmessage`, {
      elapsed: elapsed(),
      data: typeof e.data === "string" ? e.data.slice(0, 200) : "(binary)",
    });
  ws.onerror = (e) =>
    probeLog.error(`${tag} probe onerror`, {
      elapsed: elapsed(),
      // ErrorEvent on WS is almost always opaque (no detail); we
      // log it anyway in case a future spec exposes more.
      type: e.type,
    });
  ws.onclose = (e) =>
    probeLog.warn(`${tag} probe onclose`, {
      elapsed: elapsed(),
      code: e.code,
      reason: e.reason || "(empty)",
      wasClean: e.wasClean,
    });
  // Cap the probe lifetime so it doesn't leak — 10s is plenty for
  // either success or any of the failure codes (1006 abnormal,
  // 1015 TLS, etc.).
  setTimeout(() => {
    if (ws.readyState <= 1) {
      probeLog.warn(`${tag} probe forced close`, { elapsed: elapsed() });
      ws.close();
    }
  }, 10_000);
}

function probeBroker() {
  probeWss(
    "broker",
    "wss://0.peerjs.com:443/peerjs?key=peerjs&id=probe-" +
      Math.random().toString(36).slice(2, 10) +
      "&token=probe&version=1.5.4",
  );
}

// Known-good public WSS echo (operated by Lob, no auth, returns hi
// frame on connect). If this also fails with 1006 then the device or
// its network is blocking WSS entirely; if it opens but the broker
// probe fails, the broker is rejecting this client specifically.
function probeEcho() {
  probeWss("echo", "wss://echo.websocket.events");
}

// One-shot environment snapshot — UA, screen, connection quality —
// logged the first time the overlay component mounts. Helps us tell
// what kind of device produced the rest of the log without asking the
// user to read it off the tablet manually.
let envLogged = false;
function logEnvOnce() {
  if (envLogged) return;
  envLogged = true;
  if (typeof window === "undefined") return;
  const conn = (
    navigator as unknown as {
      connection?: {
        effectiveType?: string;
        saveData?: boolean;
        downlink?: number;
        rtt?: number;
        type?: string;
      };
    }
  ).connection;
  envLog.info("device", {
    ua: navigator.userAgent,
    lang: navigator.language,
    online: navigator.onLine,
    cookieEnabled: navigator.cookieEnabled,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    conn: conn
      ? {
          effectiveType: conn.effectiveType,
          saveData: conn.saveData,
          downlink: conn.downlink,
          rtt: conn.rtt,
          type: conn.type,
        }
      : "(unavailable)",
  });
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const formatTime = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
};

const formatEntry = (e: LogEntry) => {
  const stamp = formatTime(e.timestamp);
  const tag = `[${e.namespace}]`;
  const dataStr =
    e.data === undefined
      ? ""
      : ` ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}`;
  return `${stamp} ${e.level.toUpperCase()} ${tag} ${e.message}${dataStr}`;
};

export function DebugLogOverlay() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [minLevel, setMinLevel] = useState<LogLevel>("debug");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Seed from the existing ring buffer + subscribe to new entries.
  useEffect(() => {
    // Log device info once per session so we know what produced the
    // rest of the log without asking the user to type it out.
    logEnvOnce();
    setEntries(getLogBuffer());
    return subscribeLogs((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        // Cap on-screen length to avoid runaway re-renders.
        if (next.length > 600) next.splice(0, next.length - 600);
        return next;
      });
    });
  }, []);

  // Auto-scroll to bottom when new entries arrive AND the panel is
  // open. The user can scroll up to inspect older history; we don't
  // pull them back to the bottom mid-read.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  const visible = entries.filter(
    (e) => LEVEL_RANK[e.level] >= LEVEL_RANK[minLevel],
  );

  const copyAll = async () => {
    const text = visible.map(formatEntry).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — fall back to a manual-select view.
    }
  };

  const clear = () => {
    clearLogBuffer();
    setEntries([]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.toggle}
        aria-label="Open debug log"
      >
        <Bug size={16} aria-hidden />
      </button>
    );
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="Debug log">
      <div className={styles.header}>
        <span className={styles.title}>
          Debug log <span className={styles.sha}>· {COMMIT_SHA}</span>
        </span>
        <div className={styles.headerActions}>
          <select
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value as LogLevel)}
            className={styles.select}
            aria-label="Minimum log level"
          >
            <option value="debug">debug+</option>
            <option value="info">info+</option>
            <option value="warn">warn+</option>
            <option value="error">error only</option>
          </select>
          <button
            type="button"
            onClick={probeBroker}
            className={styles.actionButton}
            aria-label="Probe broker WebSocket"
            title="Open a raw WSS to 0.peerjs.com and log the result"
          >
            <Wifi size={14} aria-hidden />
            Broker
          </button>
          <button
            type="button"
            onClick={probeEcho}
            className={styles.actionButton}
            aria-label="Probe known-good WebSocket echo"
            title="Open a raw WSS to a known-good echo server. If this fails too, the device is blocking WSS; if it opens but Broker fails, the broker is rejecting this client."
          >
            <Wifi size={14} aria-hidden />
            Echo
          </button>
          <button
            type="button"
            onClick={copyAll}
            className={styles.actionButton}
            aria-label="Copy log to clipboard"
          >
            <Copy size={14} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={clear}
            className={styles.actionButton}
            aria-label="Clear log"
          >
            <Trash2 size={14} aria-hidden />
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={styles.closeButton}
            aria-label="Close debug log"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className={styles.list} ref={listRef} role="log">
        {visible.length === 0 && (
          <div className={styles.empty}>No log entries.</div>
        )}
        {visible.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${i}`}
            className={`${styles.entry} ${styles[`level_${entry.level}`]}`}
          >
            <span className={styles.entryTime}>
              {formatTime(entry.timestamp)}
            </span>
            <span className={styles.entryLevel}>{entry.level}</span>
            <span className={styles.entryNs}>[{entry.namespace}]</span>
            <span className={styles.entryMsg}>{entry.message}</span>
            {entry.data !== undefined && (
              <span className={styles.entryData}>
                {typeof entry.data === "string"
                  ? entry.data
                  : JSON.stringify(entry.data)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
