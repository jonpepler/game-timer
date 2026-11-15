import { Disc } from "@/components/ui";
import type { PlayerRole } from "@/state/gameDefinition";
import { EntryToken } from "./EntryToken";

interface RoleTokenProps {
  color: string;
  role: PlayerRole | undefined;
  // Diameter in pixels when the role carries a mark.
  size: number;
}

/** A player's colour with their role's mark in it, or a plain disc. */
export function RoleToken({ color, role, size }: RoleTokenProps) {
  return role?.mark ? (
    <EntryToken color={color} symbol={role.mark} size={size} />
  ) : (
    <Disc color={color} size="lg" />
  );
}
