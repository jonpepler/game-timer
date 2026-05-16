import { afterEach, describe, expect, it } from "vitest";
import { clearKey, loadJson, saveJson } from "./storage";

afterEach(() => {
  // Tests share the jsdom localStorage; clear what we wrote.
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("storage", () => {
  it("round-trips JSON-serialisable values", () => {
    saveJson("session", { hello: "world", n: 42, list: [1, 2] });
    const loaded = loadJson<{ hello: string; n: number; list: number[] }>(
      "session",
    );
    expect(loaded).toEqual({ hello: "world", n: 42, list: [1, 2] });
  });

  it("returns undefined for unknown keys", () => {
    expect(loadJson<unknown>("nothing-here")).toBeUndefined();
  });

  it("returns undefined for malformed JSON without throwing", () => {
    window.localStorage.setItem("game-timer:v1:bad", "{not json");
    expect(loadJson<unknown>("bad")).toBeUndefined();
  });

  it("clearKey removes the namespaced entry", () => {
    saveJson("session", { x: 1 });
    expect(loadJson<unknown>("session")).toEqual({ x: 1 });
    clearKey("session");
    expect(loadJson<unknown>("session")).toBeUndefined();
  });

  it("namespaces keys under game-timer:v1:", () => {
    saveJson("scoped", { ok: true });
    expect(window.localStorage.getItem("game-timer:v1:scoped")).toContain("ok");
  });
});
