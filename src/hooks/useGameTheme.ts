"use client";

import { useEffect, useSyncExternalStore } from "react";
import { type ClockFace, DEFAULT_CLOCK_FACE } from "@/state/clockFace";
import { builtInThemes } from "@/state/definitions";
import {
  type BundledTheme,
  clockNumerals,
  type ThemeScheme,
  themeCss,
} from "@/state/gameTheme";

/**
 * Applies the theme of the game in play to the html element, as two data
 * attributes that select the token block `themeCss` wrote. Two callers feed
 * it: a page names its running game, and the setup wizard names the game
 * being set up while it is open, which wins until it closes. Closing the
 * wizard without starting drops the preview, so a cancelled setup never
 * leaves its theme behind. Games without a theme keep the default tokens.
 *
 * Everything else learns about the theme only through tokens, with two
 * exceptions that are framework state rather than theme values: the active
 * scheme (light or dark) and the clock face's enumerated options.
 */

const STYLE_ID = "game-theme-tokens";
const preferenceKey = (definitionId: string) =>
  `game-timer:scheme:${definitionId}`;

let activeId: string | undefined;
let previewId: string | undefined;
let systemBound = false;
let version = 0;
// The device's picks, kept here too so a switch still holds for this
// session when storage is blocked.
const picked = new Map<string, ThemeScheme>();
const listeners = new Set<() => void>();

const themeFor = (id: string | undefined): BundledTheme | undefined =>
  id ? builtInThemes.find((t) => t.definitionId === id) : undefined;

const current = () => themeFor(previewId ?? activeId);

const readPreference = (definitionId: string): ThemeScheme | undefined => {
  try {
    const stored = localStorage.getItem(preferenceKey(definitionId));
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Blocked storage: fall back to this session's pick.
  }
  return picked.get(definitionId);
};

const systemScheme = (): ThemeScheme =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";

/** The scheme a theme shows: the device's own pick, the theme's default, then the system's. */
const schemeOf = (bundled: BundledTheme | undefined): ThemeScheme =>
  bundled
    ? (readPreference(bundled.definitionId) ??
      bundled.theme.defaultScheme ??
      systemScheme())
    : "dark";

const apply = () => {
  version++;
  if (typeof document !== "undefined") {
    const html = document.documentElement;
    const bundled = current();
    if (!bundled) {
      delete html.dataset.gameTheme;
      delete html.dataset.scheme;
    } else {
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = builtInThemes.map(themeCss).join("\n");
        document.head.appendChild(style);
      }
      html.dataset.gameTheme = bundled.definitionId;
      html.dataset.scheme = schemeOf(bundled);
    }
  }
  listeners.forEach((listener) => {
    listener();
  });
};

const bindSystem = () => {
  if (systemBound || typeof matchMedia !== "function") return;
  systemBound = true;
  matchMedia("(prefers-color-scheme: light)").addEventListener?.(
    "change",
    apply,
  );
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const useVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );

/** The running game's theme, from the page that hosts or follows it. */
export const useGameTheme = (definitionId: string | undefined) => {
  useEffect(() => {
    bindSystem();
    activeId = definitionId;
    apply();
    return () => {
      if (activeId === definitionId) activeId = undefined;
      apply();
    };
  }, [definitionId]);
};

/** The game picked in setup, shown while the wizard is open. Pass undefined once it closes. */
export const useGameThemePreview = (definitionId: string | undefined) => {
  useEffect(() => {
    bindSystem();
    previewId = definitionId;
    apply();
    return () => {
      previewId = undefined;
      apply();
    };
  }, [definitionId]);
};

/** The scheme on screen; the default look is dark. */
export const useColourScheme = (): ThemeScheme => {
  useVersion();
  return typeof document === "undefined" ? "dark" : schemeOf(current());
};

/** Whether a theme applies, its scheme, and a switch to the other scheme. */
export const useThemeScheme = () => {
  useVersion();
  const bundled = typeof document === "undefined" ? undefined : current();
  const scheme = schemeOf(bundled);
  const toggle = () => {
    if (!bundled) return;
    const next: ThemeScheme = scheme === "light" ? "dark" : "light";
    picked.set(bundled.definitionId, next);
    try {
      localStorage.setItem(preferenceKey(bundled.definitionId), next);
    } catch {
      // Blocked storage: the pick lasts for this session only.
    }
    apply();
  };
  return { themed: bundled !== undefined, scheme, toggle };
};

/** The clock face of the theme in play and the numerals it draws with. */
export const useClockFace = (): {
  face: ClockFace;
  numerals: ReturnType<typeof clockNumerals>;
} => {
  useVersion();
  const bundled = typeof document === "undefined" ? undefined : current();
  const face = bundled?.theme.clock ?? DEFAULT_CLOCK_FACE;
  return { face, numerals: clockNumerals(face, bundled?.theme) };
};
