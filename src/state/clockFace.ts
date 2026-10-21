import { z } from "zod";

/**
 * The clock face a theme may choose, as enumerated options only. A face
 * never carries SVG, sizes, positions or opacities: the framework owns the
 * geometry below and draws every option the same way for every theme. The
 * face's two colours are the `clock-track` and `clock-ornament` tokens,
 * set per scheme beside the theme's other colours.
 */

export const NUMERAL_FACES = [
  "body",
  "inter-600",
  "old-standard-700",
  "big-shoulders-800",
] as const;
export type NumeralFace = (typeof NUMERAL_FACES)[number];
export type ResolvedNumeralFace = Exclude<NumeralFace, "body">;

const TrackSchema = z.discriminatedUnion("style", [
  z.object({ style: z.literal("hairline") }).strict(),
  z.object({ style: z.literal("double-rule") }).strict(),
  z.object({ style: z.literal("band") }).strict(),
  // Divisions are fractions of the running average, never clock minutes.
  z
    .object({
      style: z.literal("ticks"),
      divisions: z.union([z.literal(10), z.literal(20), z.literal(40)]),
    })
    .strict(),
  z
    .object({
      style: z.literal("cells"),
      count: z.union([z.literal(10), z.literal(20), z.literal(24)]),
    })
    .strict(),
]);

const ProgressSchema = z
  .object({
    style: z.enum(["sweep", "fill"]),
    weight: z.enum(["light", "regular", "heavy"]).default("regular"),
    cap: z.enum(["round", "butt"]).default("round"),
    marker: z.enum(["none", "pointer"]).default("none"),
  })
  .strict();

export const ORNAMENT_KINDS = [
  "rule-diamond",
  "rule-star",
  "sunburst",
  "chevron-band",
  "diamond",
  "square-run",
] as const;
export type OrnamentKind = (typeof ORNAMENT_KINDS)[number];

const OrnamentSchema = z.discriminatedUnion("slot", [
  z.object({ slot: z.literal("none") }).strict(),
  z
    .object({
      slot: z.enum(["above", "below"]),
      kind: z.enum(ORNAMENT_KINDS),
      /**
       * How the ornament marks overtime. It always takes the
       * `clock-ornament-overtime` colour; `kind` swaps its shape too.
       */
      overtime: z
        .object({ kind: z.enum(ORNAMENT_KINDS).optional() })
        .strict()
        .default({}),
    })
    .strict(),
]);

const FaceOptionsSchema = z
  .object({
    track: TrackSchema,
    progress: ProgressSchema,
    ornament: OrnamentSchema.default({ slot: "none" }),
    numerals: z
      .object({ face: z.enum(NUMERAL_FACES).default("body") })
      .strict()
      .default({ face: "body" }),
    players: z
      .object({
        cap: z.enum(["round", "butt"]).default("round"),
        active: z.enum(["glow", "weight"]).default("glow"),
        keyline: z.boolean().default(false),
      })
      .strict()
      .default({ cap: "round", active: "glow", keyline: false }),
    overtime: z
      .object({ style: z.enum(["wash", "hatch"]) })
      .strict()
      .default({ style: "wash" }),
    paused: z
      .object({ cue: z.enum(["tone", "tone-hollow"]) })
      .strict()
      .default({ cue: "tone" }),
  })
  .strict()
  .superRefine((face, ctx) => {
    const discrete =
      face.track.style === "ticks" || face.track.style === "cells";
    if (face.track.style === "band" && face.progress.weight === "light") {
      ctx.addIssue({
        code: "custom",
        path: ["progress", "weight"],
        message: "a light sweep is lost inside a band",
      });
    }
    if (face.progress.style === "fill" && !discrete) {
      ctx.addIssue({
        code: "custom",
        path: ["progress", "style"],
        message: "fill needs a ticks or cells track",
      });
    }
    if (face.progress.style === "sweep" && face.track.style === "cells") {
      ctx.addIssue({
        code: "custom",
        path: ["progress", "style"],
        message: "a cells track is read by its cells; use fill",
      });
    }
    if (
      face.track.style === "ticks" &&
      face.progress.style === "sweep" &&
      face.progress.weight !== "light"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["progress", "weight"],
        message:
          "a sweep inside ticks must be light so the ticks stay readable",
      });
    }
    if (
      face.progress.marker === "pointer" &&
      face.progress.weight === "heavy"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["progress", "marker"],
        message: "a pointer on a heavy sweep is redundant",
      });
    }
  });

/**
 * Named faces a theme can start from. A theme sets `preset` and may
 * replace any of the preset's top-level options beside it, so swapping
 * one face for another is a one-word change.
 */
export const CLOCK_FACE_PRESETS = {
  /** A sweep between two hairline rules, a double rule and diamond above the value. */
  "survey-plate": {
    track: { style: "double-rule" },
    progress: { style: "sweep", weight: "regular", cap: "butt" },
    ornament: { slot: "above", kind: "rule-diamond" },
    numerals: { face: "body" },
    players: { cap: "butt", active: "weight", keyline: true },
    overtime: { style: "wash" },
    paused: { cue: "tone-hollow" },
  },
  /** A dial graduated in twentieths of the average, a light rim sweep led by a pointer. */
  theodolite: {
    track: { style: "ticks", divisions: 20 },
    progress: {
      style: "sweep",
      weight: "light",
      cap: "butt",
      marker: "pointer",
    },
    ornament: { slot: "above", kind: "sunburst" },
    numerals: { face: "body" },
    players: { cap: "butt", active: "weight", keyline: true },
    overtime: { style: "wash" },
    paused: { cue: "tone-hollow" },
  },
} as const;
export const CLOCK_FACE_PRESET_NAMES = Object.keys(CLOCK_FACE_PRESETS) as Array<
  keyof typeof CLOCK_FACE_PRESETS
>;

const isPreset = (name: unknown): name is keyof typeof CLOCK_FACE_PRESETS =>
  typeof name === "string" && Object.hasOwn(CLOCK_FACE_PRESETS, name);

/**
 * A face, either spelled out in full or as `{ preset, ...overrides }`. An
 * unknown preset name is left in place, so the strict schema reports it.
 */
export const ClockFaceSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null || !("preset" in input))
    return input;
  if (!isPreset(input.preset)) return input;
  const overrides = Object.entries(input).filter(([key]) => key !== "preset");
  return {
    ...CLOCK_FACE_PRESETS[input.preset],
    ...Object.fromEntries(overrides),
  };
}, FaceOptionsSchema);

export type ClockFace = z.infer<typeof ClockFaceSchema>;

/** Today's ring: a hairline track, a round sweep and glowing seat segments. */
export const DEFAULT_CLOCK_FACE: ClockFace = ClockFaceSchema.parse({
  track: { style: "hairline" },
  progress: { style: "sweep" },
});

/**
 * Framework geometry in the 100-unit viewBox. Every face draws inside these
 * bands and boxes, so a face can change how the clock looks but never its
 * footprint. The value box and the ornament slots are measured from the
 * default numerals (Inter 600 at 20 units, "+00:00").
 */
export const CLOCK_GEOMETRY = {
  centre: 50,
  ring: { r: 46, inner: 42.5, outer: 50 },
  players: { r: 40, inner: 37.5, outer: 42.5, gapDeg: 6 },
  field: { r: 50 },
  value: { x: 14.963, y: 40.68, w: 70.075, h: 14.988, cy: 48.175 },
  slots: {
    above: { x: 32, y: 27.18, w: 36, h: 9 },
    below: { x: 32, y: 60.169, w: 36, h: 9 },
  },
} as const;

/**
 * Measured metrics of each numeral face at the size the clock sets it:
 * `size` and `dy` fit the face's ink into the value box; `cell` holds
 * advances per em for faces set in fixed-pitch cells because their digits
 * are not tabular (`spread` is the digit width spread with tabular-nums).
 */
export interface NumeralMetrics {
  size: number;
  dy: number;
  spread: number;
  cellMode: boolean;
  cell: { digit: number; colon: number; plus: number };
  /**
   * Set for a face whose own "+" reads poorly beside its figures (too wide,
   * too thin): the framework draws the sign instead, in em, `width` across
   * with bars `bar` thick, centred `cy` from the set line (the figures' ink
   * centre). The glyph stays in the text, unpainted, for assistive tech.
   */
  drawnSign?: { width: number; bar: number; cy: number };
}

export const NUMERAL_METRICS: Record<ResolvedNumeralFace, NumeralMetrics> = {
  "inter-600": {
    size: 20,
    dy: 0,
    spread: 0,
    cellMode: false,
    cell: { digit: 0.647, colon: 0.269, plus: 0.647 },
  },
  "old-standard-700": {
    size: 19.795,
    dy: 0.53,
    spread: 0,
    cellMode: false,
    cell: { digit: 0.58, colon: 0.28, plus: 0.94 },
    drawnSign: { width: 0.46, bar: 0.12, cy: -0.125 },
  },
  "big-shoulders-800": {
    size: 18.31,
    dy: 0.005,
    spread: 0.469,
    cellMode: true,
    cell: { digit: 0.48, colon: 0.239, plus: 0.512 },
  },
};

/** The stroke weights a sweep may take. */
export const SWEEP_WEIGHT = { light: 1.6, regular: 3, heavy: 4.6 } as const;

/** The only properties a clock part may animate; the motion lint holds this. */
export const CLOCK_ANIMATABLE = [
  "stroke-dashoffset",
  "fill-opacity",
  "rotate",
] as const;
