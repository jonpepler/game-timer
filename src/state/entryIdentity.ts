import { z } from "zod";

/**
 * Semantic type styles a definition may give a turn entry. The framework
 * maps each one to a self-hosted display face, weight, width and
 * tracking; a definition never names a font.
 */
export const TYPE_STYLES = [
  "condensed",
  "wide",
  "slab",
  "deco",
  "serif",
  "italic",
  "stencil",
] as const;
export const TypeStyleSchema = z.enum(TYPE_STYLES);
export type TypeStyle = z.infer<typeof TypeStyleSchema>;

/**
 * Symbols a definition may give a turn entry: a curated subset of the
 * lucide icon set, named by their lucide ids. Anything outside the list
 * is rejected, so a definition cannot pull in an arbitrary icon or asset.
 */
export const ENTRY_SYMBOLS = [
  "anchor",
  "anvil",
  "asterisk",
  "building-2",
  "chevrons-right",
  "circle",
  "cog",
  "drill",
  "ferris-wheel",
  "flask-conical",
  "globe",
  "hexagon",
  "house",
  "layers",
  "layout-panel-left",
  "link",
  "magnet",
  "moon",
  "orbit",
  "pickaxe",
  "sparkle",
  "sun-dim",
  "sunrise",
  "tent",
  "train-front-tunnel",
  "train-track",
  "tram-front",
  "triangle",
  "trophy",
  "waypoints",
  "wheat",
] as const;
export const EntrySymbolSchema = z.enum(ENTRY_SYMBOLS);
export type EntrySymbol = z.infer<typeof EntrySymbolSchema>;

/** How a turn entry looks beyond its colour. Both parts are optional. */
export const EntryIdentitySchema = z.strictObject({
  typeStyle: TypeStyleSchema.optional(),
  symbol: EntrySymbolSchema.optional(),
});
export type EntryIdentity = z.infer<typeof EntryIdentitySchema>;

/**
 * A structured display name. `title` is the entry's own name; `lineage`
 * names what it was combined from, in the order the table chose.
 */
export const NamePartsSchema = z.object({
  title: z.string().min(1),
  lineage: z.array(z.string().min(1)),
});
export type NameParts = z.infer<typeof NamePartsSchema>;

/**
 * "A B C": lineage names run together with no connector, so a combined
 * entry reads as one name rather than a list of what made it.
 */
export const joinLineage = (lineage: string[]): string => lineage.join(" ");

/** The flat label for logs, stored state and other plain-string uses. */
export const flatLabel = (parts: NameParts): string =>
  parts.lineage.length
    ? `${joinLineage(parts.lineage)} ${parts.title}`
    : parts.title;

/** The name as it should be read aloud: exactly as it is written. */
export const spokenName = flatLabel;
