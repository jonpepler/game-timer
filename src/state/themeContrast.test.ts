import { describe, expect, it } from "vitest";
import {
  contrast,
  contrastHex,
  lightness,
  over,
  parseHex,
} from "@/lib/contrast";
import { LIGHT_PLAYER_PALETTE } from "@/lib/playerVisual";
import { builtInDefinitions, builtInThemes } from "./definitions";
import { schemeTokens, type ThemeScheme } from "./gameTheme";

/*
 * WCAG contrast for every bundled theme, in both schemes: 4.5:1 for text,
 * 3:1 for large text and marks the table must see. The clock's own checks
 * follow: the value, the paused tone, and each seat colour against the
 * strongest overtime wash.
 */

const SURFACES = ["surface", "surface-elevated", "surface-muted"] as const;
const TEXT = [
  "text",
  "text-muted",
  "text-subtle",
  "text-dim",
  "accent",
  "danger",
  "timer-overtime",
] as const;
const MARKS = ["border-strong", "timer-paused", "success", "warning"] as const;
const TINTS = [
  ["danger", "on-danger-tint", 0.25],
  ["success", "on-success-tint", 0.25],
  ["warning", "on-warning-tint", 0.3],
] as const;

const SCHEMES: ThemeScheme[] = ["light", "dark"];

/** Seat colours the ring can show for this game in this scheme. */
const seatColours = (definitionId: string, scheme: ThemeScheme): string[] => {
  const def = builtInDefinitions.find((d) => d.id === definitionId);
  const step = def?.setupSteps?.find((s) => s.id === def.playerColorFrom);
  if (!step) return scheme === "light" ? [...LIGHT_PLAYER_PALETTE] : [];
  return [...new Set(JSON.stringify(step).match(/#[0-9a-fA-F]{6}\b/g) ?? [])];
};

const cases = builtInThemes.flatMap((bundled) =>
  SCHEMES.map((scheme) => ({
    name: `${bundled.theme.name} ${scheme}`,
    bundled,
    scheme,
    c: bundled.theme[scheme].colors,
  })),
);

describe.each(cases)("$name", ({ bundled, scheme, c }) => {
  it("text reads at 4.5:1 on every surface", () => {
    const fails = SURFACES.flatMap((s) =>
      TEXT.map((t) => [t, s, contrastHex(c[t], c[s])] as const),
    ).filter(([, , ratio]) => ratio < 4.5);
    expect(fails).toEqual([]);
    expect(contrastHex(c["text-inverse"], c.accent)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("status text reads at 4.5:1 on its own tint", () => {
    for (const [tone, on, strength] of TINTS) {
      for (const s of SURFACES) {
        const ground = over(parseHex(c[tone]), parseHex(c[s]), strength);
        expect(
          contrast(parseHex(c[on]), ground),
          `${on} on ${tone} tint over ${s}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("marks and controls stand out at 3:1 on every surface", () => {
    const fails = SURFACES.flatMap((s) =>
      MARKS.map((t) => [t, s, contrastHex(c[t], c[s])] as const),
    ).filter(([, , ratio]) => ratio < 3);
    expect(fails).toEqual([]);
  });

  it("the clock's value reads at 4.5:1 and its paused tone at 3:1", () => {
    expect(contrastHex(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastHex(c["timer-paused"], c.surface)).toBeGreaterThanOrEqual(3);
  });

  it("paused differs from running by lightness or by shape", () => {
    const gap = Math.abs(
      lightness(parseHex(c.text)) - lightness(parseHex(c["timer-paused"])),
    );
    const hollow = bundled.theme.clock.paused.cue === "tone-hollow";
    expect(gap >= 20 || hollow).toBe(true);
  });

  it("the value keeps 3:1 on the strongest overtime wash", () => {
    const cap = Number(schemeTokens(bundled.theme, scheme)["--clock-wash-cap"]);
    const wash = over(parseHex(c["timer-overtime"]), parseHex(c.surface), cap);
    expect(contrast(parseHex(c.text), wash)).toBeGreaterThanOrEqual(3);
  });

  it("the overtime ornament reads at 3:1 on the strongest overtime wash", () => {
    const face = bundled.theme.clock;
    if (face.ornament.slot === "none" || face.overtime.style !== "wash") return;
    const cap = Number(schemeTokens(bundled.theme, scheme)["--clock-wash-cap"]);
    const wash = over(parseHex(c["timer-overtime"]), parseHex(c.surface), cap);
    const ink = c["clock-ornament-overtime"] ?? c["clock-ornament"] ?? c.accent;
    expect(contrast(parseHex(ink), wash)).toBeGreaterThanOrEqual(3);
  });

  it("each seat stays apart from the overtime wash, or the face separates them", () => {
    const face = bundled.theme.clock;
    const cap = Number(schemeTokens(bundled.theme, scheme)["--clock-wash-cap"]);
    const wash = over(parseHex(c["timer-overtime"]), parseHex(c.surface), cap);
    const weak = seatColours(bundled.definitionId, scheme).filter(
      (seat) => contrast(parseHex(seat), wash) < 3,
    );
    // A hatch keeps the wash off the seat band; an ink keyline outlines the
    // acting seat in a colour that already holds 3:1 on the wash.
    if (weak.length > 0)
      expect(
        face.overtime.style === "hatch" || face.players.keyline,
        `seats under 3:1 on the wash: ${weak.join(", ")}`,
      ).toBe(true);
  });

  it("each seat holds 3:1 on the surface, or the acting one is keylined", () => {
    const weak = seatColours(bundled.definitionId, scheme).filter(
      (seat) => contrastHex(seat, c.surface) < 3,
    );
    if (weak.length > 0)
      expect(
        bundled.theme.clock.players.keyline,
        `seats under 3:1: ${weak.join(", ")}`,
      ).toBe(true);
  });
});

it("every bundled theme is checked", () => {
  expect(cases.length).toBe(builtInThemes.length * 2);
  expect(builtInThemes.length).toBeGreaterThan(0);
});
