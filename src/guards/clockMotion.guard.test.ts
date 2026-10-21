import { CLOCK_ANIMATABLE } from "@/state/clockFace";
import { listFiles } from "./ratchet";
import { codeOf } from "./styleScan";

/**
 * The clock may only move by stroke-dashoffset (the sweep), fill-opacity
 * (the overtime wash) and rotate (a pointer): properties the compositor or
 * a cheap repaint can carry while a turn runs for minutes on a phone. A
 * theme cannot add motion, and neither can the clock's own code: no
 * transition on any other property, no CSS animation, no SMIL. Zero
 * tolerance.
 */

const CLOCK_FILES = listFiles("src/components/timer", [
  ".ts",
  ".tsx",
  ".css",
]).filter(
  (f) => /\/(TimerRing|clockPaths)[.]/.test(f) && !f.includes(".test."),
);

/** Every transitioned or animated property, and every other kind of motion, in a source. */
const motionIn = (source: string): string[] => {
  const found: string[] = [];
  for (const m of source.matchAll(
    /\btransition(?:-property|Property)?["']?\s*:\s*["'`]?([^;"'`}\n]+)/g,
  )) {
    for (const part of m[1].split(",")) {
      const property = part.trim().split(/\s+/)[0];
      if (property) found.push(property);
    }
  }
  if (/\banimation(?:-name|Name)?["']?\s*:/.test(source))
    found.push("animation");
  if (/@keyframes\b/.test(source)) found.push("@keyframes");
  if (/<animate\w*\b/.test(source)) found.push("<animate>");
  return found;
};

describe("clock motion lint", () => {
  it("reads transitions in a stylesheet and an inline style", () => {
    expect(
      motionIn(
        [
          ".a { transition: opacity 0.2s, stroke-dashoffset 1s; }",
          'style={{ transition: "stroke-width var(--duration-base)" }}',
          "@keyframes spin {}",
          "<animateTransform />",
        ].join("\n"),
      ),
    ).toEqual([
      "opacity",
      "stroke-dashoffset",
      "stroke-width",
      "@keyframes",
      "<animate>",
    ]);
  });

  it("scans the clock", () => {
    expect(CLOCK_FILES).toContain("src/components/timer/TimerRing.tsx");
  });

  it("animates nothing but stroke-dashoffset, fill-opacity and rotate", () => {
    const allowed = new Set<string>(CLOCK_ANIMATABLE);
    const offenders = CLOCK_FILES.flatMap((file) =>
      motionIn(codeOf(file))
        .filter((p) => !allowed.has(p))
        .map((p) => `${file}: ${p}`),
    );
    expect(
      offenders,
      `The clock may only animate ${CLOCK_ANIMATABLE.join(", ")}. Change the value without a transition, or move it onto one of those.`,
    ).toEqual([]);
  });
});
