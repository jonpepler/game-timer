import type { EntryIdentity, TypeStyle } from "@/state/entryIdentity";

/**
 * Where an entry's name is shown. The banner and list rows use the
 * entry's face, so a row reads as the same piece as the banner; sheets,
 * prompts and everywhere else use the UI face.
 */
export type NamePlacement = "banner" | "row" | "other";

export const typeStyleFor = (
  placement: NamePlacement,
  identity: EntryIdentity | undefined,
): TypeStyle | undefined => {
  if (!identity?.typeStyle) return undefined;
  if (placement === "banner" || placement === "row") return identity.typeStyle;
  return undefined;
};
