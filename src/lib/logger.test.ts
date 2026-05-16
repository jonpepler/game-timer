import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addLogSink,
  clearLogBuffer,
  createLogger,
  getLogBuffer,
  setMinLogLevel,
  type LogEntry,
} from "./logger";

afterEach(() => {
  clearLogBuffer();
  setMinLogLevel("debug");
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("captures entries in the ring buffer with namespace and level", () => {
    const log = createLogger("timer");
    log.info("started");
    log.warn("slow turn", { ms: 9000 });

    const entries = getLogBuffer();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "info",
      namespace: "timer",
      message: "started",
    });
    expect(entries[1]).toMatchObject({
      level: "warn",
      namespace: "timer",
      message: "slow turn",
      data: { ms: 9000 },
    });
  });

  it("filters entries below the configured minimum level", () => {
    setMinLogLevel("warn");
    const log = createLogger("peer");
    log.debug("ignored");
    log.info("ignored");
    log.warn("kept");

    const entries = getLogBuffer();
    expect(entries.map((e) => e.message)).toEqual(["kept"]);
  });

  it("dispatches to additional sinks", () => {
    const captured: LogEntry[] = [];
    addLogSink({ write: (entry) => captured.push(entry) });
    const log = createLogger("score");
    log.error("boom");

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: "error",
      namespace: "score",
      message: "boom",
    });
  });
});
