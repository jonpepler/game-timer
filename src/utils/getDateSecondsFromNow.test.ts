import { describe, expect, it, vi } from "vitest";
import { getDateSecondsFromNow } from "./getDateSecondsFromNow";

describe("getDateSecondsFromNow", () => {
  it("returns a Date offset by the given number of seconds", () => {
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
    try {
      expect(getDateSecondsFromNow(30).toISOString()).toBe(
        "2026-01-01T00:00:30.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
