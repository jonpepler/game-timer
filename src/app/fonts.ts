import {
  Alfa_Slab_One,
  Archivo,
  Big_Shoulders_Display,
  Cinzel,
  Old_Standard_TT,
  Poiret_One,
  Saira_Stencil_One,
} from "next/font/google";

/*
 * Display faces behind the entry type styles (see
 * src/components/identity/typeStyles.module.css). Downloaded at build
 * time and served from the static export, Latin only. None are
 * preloaded: they only show for entries that ask for a type style.
 */

const condensed = Big_Shoulders_Display({
  subsets: ["latin"],
  weight: "800",
  display: "swap",
  preload: false,
  variable: "--font-type-condensed",
});

// Variable on width and weight: the wide style runs it at 125% width.
const grotesk = Archivo({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["wdth"],
  display: "swap",
  preload: false,
  variable: "--font-type-grotesk",
});

const slab = Alfa_Slab_One({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-type-slab",
});

const deco = Poiret_One({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-type-deco",
});

// Bold upright for the serif style, italic for the lineage ampersand.
const serif = Old_Standard_TT({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
  variable: "--font-type-serif",
});

const stencil = Saira_Stencil_One({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-type-stencil",
});

/** Class names that define every type style font variable. */
export const typeStyleFontVariables = [
  condensed,
  grotesk,
  slab,
  deco,
  serif,
  stencil,
]
  .map((font) => font.variable)
  .join(" ");

/*
 * Faces only a game theme uses (src/state/gameTheme.ts lists every face a
 * theme may pick). Not preloaded, so a page without that theme never
 * downloads them. Big Shoulders and Old Standard above double as theme
 * faces.
 */
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: "700",
  display: "swap",
  preload: false,
  variable: "--font-theme-cinzel",
});

export const themeFontVariables = cinzel.variable;
