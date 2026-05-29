export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  namespace: string;
  message: string;
  data?: unknown;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class RingBuffer {
  private buffer: LogEntry[] = [];

  constructor(private readonly capacity: number) {}

  push(entry: LogEntry) {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  snapshot(): LogEntry[] {
    return [...this.buffer];
  }

  clear() {
    this.buffer.length = 0;
  }
}

const ringBuffer = new RingBuffer(500);

const consoleSink: LogSink = {
  write(entry) {
    const tag = `[${entry.namespace}]`;
    const args =
      entry.data === undefined
        ? [tag, entry.message]
        : [tag, entry.message, entry.data];
    if (entry.level === "error") console.error(...args);
    else if (entry.level === "warn") console.warn(...args);
    else if (entry.level === "info") console.info(...args);
    else console.debug(...args);
  },
};

const sinks: LogSink[] = [consoleSink];
let minLevel: LogLevel = "debug";
// Live-update subscribers (e.g. the on-screen DebugLogOverlay).
// Separate from `sinks` so subscribers can re-render on tick.
const listeners = new Set<(entry: LogEntry) => void>();

function emit(
  level: LogLevel,
  namespace: string,
  message: string,
  data?: unknown,
) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    namespace,
    message,
    data,
  };
  ringBuffer.push(entry);
  for (const sink of sinks) sink.write(entry);
  listeners.forEach((fn) => {
    fn(entry);
  });
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(namespace: string): Logger {
  return {
    debug: (message, data) => emit("debug", namespace, message, data),
    info: (message, data) => emit("info", namespace, message, data),
    warn: (message, data) => emit("warn", namespace, message, data),
    error: (message, data) => emit("error", namespace, message, data),
  };
}

export function setMinLogLevel(level: LogLevel) {
  minLevel = level;
}

export function addLogSink(sink: LogSink) {
  sinks.push(sink);
}

export function getLogBuffer(): LogEntry[] {
  return ringBuffer.snapshot();
}

export function clearLogBuffer() {
  ringBuffer.clear();
}

// Subscribe to live log events. Returns an unsubscribe function.
export function subscribeLogs(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
