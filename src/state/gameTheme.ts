import { z } from "zod";
import { washCap } from "@/lib/contrast";
import {
  type ClockFace,
  ClockFaceSchema,
  DEFAULT_CLOCK_FACE,
  type ResolvedNumeralFace,
} from "./clockFace";

/**
 * A game's theme: a JSON file beside its definition that may only set token
 * values, for a light and a dark scheme. It picks colours, faces from the
 * bundled list, corner radii, elevation, an ornament and a texture, and a
 * clock face from enumerated options. It never names a component, a layout
 * or a CSS property: `themeCss` turns a parsed theme into the custom
 * properties declared in src/app/globals.css, and nothing else reads it.
 */

export const GAME_THEME_SCHEMA_VERSION = 1;

export type ThemeScheme = "light" | "dark";

/**
 * Faces a theme may pick. next/font bundles them at build time (see
 * src/app/fonts.ts) without preloading, so a face is only downloaded once a
 * themed page draws text in it. `numerals` is the clock face's numeral set
 * when the theme's body face is chosen for the clock.
 */
export const THEME_FACES = {
  inter: {
    stack: "var(--font-face-inter)",
    numerals: "inter-600",
  },
  "old-standard": {
    stack: "var(--font-face-old-standard)",
    numerals: "old-standard-700",
  },
  "big-shoulders": {
    stack: "var(--font-face-big-shoulders)",
    numerals: "big-shoulders-800",
  },
  cinzel: {
    stack: "var(--font-face-cinzel)",
    numerals: null,
  },
} as const satisfies Record<
  string,
  { stack: string; numerals: ResolvedNumeralFace | null }
>;

export type ThemeFace = keyof typeof THEME_FACES;
const FaceSchema = z.enum(
  Object.keys(THEME_FACES) as [ThemeFace, ...ThemeFace[]],
);

/**
 * Colour tokens every scheme must set. Anything left to the defaults would
 * be the dark default palette, which is how the spike leaked dark-only
 * marks onto paper.
 */
export const REQUIRED_COLOUR_TOKENS = [
  "surface",
  "surface-elevated",
  "surface-muted",
  "text",
  "text-muted",
  "text-subtle",
  "text-dim",
  "text-inverse",
  "border",
  "border-strong",
  "ring",
  "accent",
  "danger",
  "on-danger-tint",
  "success",
  "on-success-tint",
  "warning",
  "on-warning-tint",
  "timer-paused",
  "timer-overtime",
  "player-fallback",
] as const;

/** Colour tokens a scheme may set; the defaults derive them from the required ones. */
export const OPTIONAL_COLOUR_TOKENS = [
  "timer-active",
  "focus",
  "on-light",
  "on-dark",
  "chart-grid",
  "chart-axis",
  "chart-ring",
  "clock-track",
  "clock-ornament",
  "clock-ornament-overtime",
  "frame",
  "texture",
] as const;

export const RADIUS_TOKENS = [
  "control",
  "field",
  "chip",
  "panel",
  "sheet",
  "chrome",
  "tooltip",
  "bar",
] as const;

/** Opaque hex: a palette colour. */
const SolidSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");
/** Hex with an optional alpha byte, for hairlines and scrims. */
const ColourSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    "a colour is #rrggbb or #rrggbbaa",
  );

const ColoursSchema = z
  .object({
    ...Object.fromEntries(REQUIRED_COLOUR_TOKENS.map((t) => [t, ColourSchema])),
    ...Object.fromEntries(
      OPTIONAL_COLOUR_TOKENS.map((t) => [t, ColourSchema.optional()]),
    ),
  } as {
    [K in (typeof REQUIRED_COLOUR_TOKENS)[number]]: typeof ColourSchema;
  } & {
    [K in (typeof OPTIONAL_COLOUR_TOKENS)[number]]: z.ZodOptional<
      typeof ColourSchema
    >;
  })
  .strict()
  // The surfaces are the ground every contrast check measures against.
  .superRefine((c, ctx) => {
    for (const key of [
      "surface",
      "surface-elevated",
      "surface-muted",
    ] as const) {
      if (!SolidSchema.safeParse(c[key]).success)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "a surface must be opaque",
        });
    }
  });

const SchemeSchema = z
  .object({
    colors: ColoursSchema,
    elevation: z
      .object({
        /** The scrim behind a sheet or prompt. */
        backdrop: ColourSchema,
        /** The colour shadows are cast in; the framework sets their strength. */
        shadow: SolidSchema,
      })
      .strict(),
    ornament: z
      .object({
        /** Drawn around the viewport in the `frame` colour. */
        frame: z.enum(["none", "double-rule", "spine"]).default("none"),
        /** Generated over the surface in the `texture` colour, never scanned art. */
        texture: z
          .enum(["none", "grain", "weave", "flecks", "rain", "paper", "dust"])
          .default("none"),
      })
      .strict()
      .default({ frame: "none", texture: "none" }),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.ornament.frame !== "none" && !s.colors.frame)
      ctx.addIssue({
        code: "custom",
        path: ["colors", "frame"],
        message: "a frame needs a frame colour",
      });
    if (s.ornament.texture !== "none" && !s.colors.texture)
      ctx.addIssue({
        code: "custom",
        path: ["colors", "texture"],
        message: "a texture needs a texture colour",
      });
  });

export const GameThemeSchema = z
  .object({
    schemaVersion: z.literal(GAME_THEME_SCHEMA_VERSION),
    name: z.string().min(1),
    /** Absent: follow the device's preference. */
    defaultScheme: z.enum(["light", "dark"]).optional(),
    fonts: z
      .object({
        body: FaceSchema,
        /** Headings at 20px and up. */
        display: FaceSchema,
        /** Section labels and small headings. */
        label: FaceSchema,
        /** Numbers the table reads; must have tabular figures. */
        numeric: FaceSchema,
      })
      .strict(),
    display: z
      .object({
        case: z.enum(["as-written", "uppercase"]).default("as-written"),
        /** Extra tracking for display headings, in em. */
        tracking: z.number().min(0).max(0.08).default(0),
      })
      .strict()
      .default({ case: "as-written", tracking: 0 }),
    radius: z
      .object(
        Object.fromEntries(
          RADIUS_TOKENS.map((t) => [
            t,
            z.number().int().min(0).max(24).optional(),
          ]),
        ) as {
          [K in (typeof RADIUS_TOKENS)[number]]: z.ZodOptional<z.ZodNumber>;
        },
      )
      .strict()
      .default({}),
    clock: ClockFaceSchema.default(DEFAULT_CLOCK_FACE),
    light: SchemeSchema,
    dark: SchemeSchema,
  })
  .strict()
  .superRefine((t, ctx) => {
    if (THEME_FACES[t.fonts.numeric].numerals === null)
      ctx.addIssue({
        code: "custom",
        path: ["fonts", "numeric"],
        message: "the numeric face needs tabular figures",
      });
  });

export type GameTheme = z.infer<typeof GameThemeSchema>;
type Scheme = z.infer<typeof SchemeSchema>;

/** A theme bundled with a built-in definition. */
export interface BundledTheme {
  definitionId: string;
  theme: GameTheme;
}

export const parseGameTheme = (json: unknown): GameTheme =>
  GameThemeSchema.parse(json);

/** The numeral set the clock draws with under `theme`. */
export const clockNumerals = (
  face: ClockFace,
  theme: GameTheme | undefined,
): ResolvedNumeralFace | "default" => {
  if (face.numerals.face !== "body") return face.numerals.face;
  if (!theme) return "default";
  return THEME_FACES[theme.fonts.body].numerals ?? "default";
};

const svgUri = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/**
 * Fractal noise tinted to one colour. The SVG has no size of its own, so
 * it is drawn once at the size of the whole background (the viewport, as
 * every texture is fixed) and never repeats.
 */
const noise = (
  tint: string,
  frequency: number,
  strength: number,
  octaves = 3,
) =>
  svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${strength} ${(-strength * 0.43).toFixed(3)}"/><feComposite in="SourceGraphic" operator="in"/></filter><rect width="100%" height="100%" fill="${tint}" filter="url(#n)"/></svg>`,
  );

/** Sparse points scattered on a fixed seed, so every load draws the same field. */
const scatter = (count: number, size: number, seed: number) => {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: count }, () => [
    Math.round(next() * size),
    Math.round(next() * size),
    next(),
  ]);
};

/**
 * Tile sizes for scattered marks, pairwise coprime: three layers laid
 * over each other only line up again after millions of pixels, so no
 * repeat shows at any viewport size.
 */
const LAYER_SIZES = [307, 419, 557] as const;

const layered = (mark: (size: number, seed: number) => string) =>
  LAYER_SIZES.map((size, i) =>
    svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${mark(size, 7 + i * 13)}</svg>`,
    ),
  );

const textureImage = (kind: Scheme["ornament"]["texture"], tint: string) => {
  switch (kind) {
    case "none":
      return "none";
    case "grain":
      return noise(tint, 0.85, 0.36);
    case "weave": {
      const thread = `${tint.slice(0, 7)}0d`;
      return [
        `repeating-linear-gradient(0deg, ${thread} 0 1px, transparent 1px 3px)`,
        `repeating-linear-gradient(90deg, ${thread} 0 1px, transparent 1px 3px)`,
        noise(tint, 0.6, 0.3),
      ].join(", ");
    }
    case "flecks":
      return layered((size, seed) => {
        const dots = scatter(Math.round(size / 16), size, seed)
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.7"/>`)
          .join("");
        return `<g fill="${tint}" fill-opacity="0.55">${dots}</g>`;
      }).join(", ");
    case "rain":
      return layered((size, seed) => {
        const strokes = scatter(Math.round(size / 30), size, seed)
          .map(([x, y]) => `<path d="M${x} ${y}l-6 14"/>`)
          .join("");
        return `<g stroke="${tint}" stroke-opacity="0.16" stroke-width="1">${strokes}</g>`;
      }).join(", ");
    case "paper":
      // Fibre mottle, fine tooth and specks of two sizes.
      return [
        ...layered((size, seed) => {
          const specks = scatter(Math.round(size / 5), size, seed)
            .map(
              ([x, y, k]) =>
                `<circle cx="${x}" cy="${y}" r="${k > 0.85 ? 1.1 : 0.5}" fill-opacity="${(0.25 + k * 0.35).toFixed(2)}"/>`,
            )
            .join("");
          return `<g fill="${tint}">${specks}</g>`;
        }),
        noise(tint, 0.9, 0.3, 2),
        noise(tint, 0.012, 0.22, 4),
      ].join(", ");
    case "dust":
      // Tiny squares at odd angles.
      return [
        ...layered((size, seed) => {
          const motes = scatter(Math.round(size / 9), size, seed)
            .map(([x, y, k]) => {
              const side = k > 0.9 ? 2 : 1.2;
              return `<rect x="${x}" y="${y}" width="${side}" height="${side}" transform="rotate(${Math.round(k * 90)} ${x} ${y})" fill-opacity="${(0.2 + k * 0.5).toFixed(2)}"/>`;
            })
            .join("");
          return `<g fill="${tint}">${motes}</g>`;
        }),
      ].join(", ");
  }
};

/**
 * Every custom property a scheme of `theme` sets, by name. The token guard
 * checks each name is declared in src/app/globals.css.
 */
export const schemeTokens = (
  theme: GameTheme,
  scheme: ThemeScheme,
): Record<string, string> => {
  const s = theme[scheme];
  const out: Record<string, string> = {};
  for (const [token, value] of Object.entries(s.colors)) {
    if (value !== undefined) out[`--color-${token}`] = value;
  }
  out["--font-body"] = THEME_FACES[theme.fonts.body].stack;
  out["--font-display"] = THEME_FACES[theme.fonts.display].stack;
  out["--font-label"] = THEME_FACES[theme.fonts.label].stack;
  out["--font-numeric"] = THEME_FACES[theme.fonts.numeric].stack;
  out["--text-transform-display"] =
    theme.display.case === "uppercase" ? "uppercase" : "none";
  out["--letter-spacing-display"] = `${theme.display.tracking}em`;
  for (const [token, px] of Object.entries(theme.radius)) {
    if (px !== undefined) out[`--radius-${token}`] = `${px}px`;
  }
  out["--elevation-backdrop"] = s.elevation.backdrop;
  out["--elevation-shadow"] = s.elevation.shadow;
  out["--ornament-frame"] = s.ornament.frame === "none" ? "none" : "block";
  out["--ornament-frame-rule"] =
    s.ornament.frame === "double-rule" ? "1px" : "0px";
  out["--ornament-frame-spine"] = s.ornament.frame === "spine" ? "6px" : "0px";
  out["--ornament-texture"] = textureImage(
    s.ornament.texture,
    s.colors.texture ?? s.colors.text,
  );
  out["--clock-wash-cap"] = String(
    washCap(s.colors.text, s.colors["timer-overtime"], s.colors.surface),
  );
  // Pale seat colours vanish at 0.3 on a light ground.
  out["--clock-inactive-opacity"] = scheme === "light" ? "0.5" : "0.3";
  out["--seat-text-ink"] = scheme === "light" ? "100%" : "0%";
  return out;
};

/** The stylesheet that applies `theme` while its id is on the html element. */
export const themeCss = ({ definitionId, theme }: BundledTheme): string =>
  (["light", "dark"] as const)
    .map((scheme) => {
      const body = Object.entries(schemeTokens(theme, scheme))
        .map(([name, value]) => `  ${name}: ${value};`)
        .join("\n");
      return `html[data-game-theme="${definitionId}"][data-scheme="${scheme}"] {\n  color-scheme: ${scheme};\n${body}\n}`;
    })
    .join("\n");
