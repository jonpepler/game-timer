/*
 * Tiny typed wrapper around window.localStorage.
 *
 * All keys flow through a single namespace + schema-version prefix so
 * future versions can wipe cleanly without grepping for keys. Every
 * call is defensive: SSR (no window), private browsing (storage throws),
 * disabled storage, or quota exceeded all degrade silently.
 */
import { createLogger } from "./logger";

const log = createLogger("storage");

const NAMESPACE = "game-timer";
const VERSION = 1;

const key = (suffix: string) => `${NAMESPACE}:v${VERSION}:${suffix}`;

const safeStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    const probe = "__probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
};

export const loadJson = <T>(suffix: string): T | undefined => {
  const storage = safeStorage();
  if (!storage) return undefined;
  const raw = storage.getItem(key(suffix));
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    log.warn("failed to parse stored value; dropping", {
      suffix,
      error: String(e),
    });
    return undefined;
  }
};

export const saveJson = (suffix: string, value: unknown): void => {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key(suffix), JSON.stringify(value));
  } catch (e) {
    log.warn("failed to write to storage", { suffix, error: String(e) });
  }
};

export const clearKey = (suffix: string): void => {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(key(suffix));
  } catch (e) {
    log.warn("failed to clear storage key", { suffix, error: String(e) });
  }
};
