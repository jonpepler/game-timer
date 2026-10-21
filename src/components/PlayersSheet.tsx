"use client";

import { EntryDialog } from "./EntryDialog";
import { Button } from "@/components/ui";
import { SeatList } from "./SeatList";

interface PlayersSheetProps {
  players: ReadonlyArray<{ name: string }>;
  onRename: (playerIndex: number, name: string) => void;
  // Players this screen may rename; defaults to all of them.
  canEdit?: (playerIndex: number) => boolean;
  onClose: () => void;
}

/**
 * Rename the players of a running game. Seats keep their order and
 * colour once play starts, so names are the only edit offered. The host
 * renames anyone; a seated companion renames only its own player.
 */
export function PlayersSheet({
  players,
  onRename,
  canEdit,
  onClose,
}: PlayersSheetProps) {
  return (
    <EntryDialog
      title="Players"
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <SeatList
        seats={players.map((p, i) => ({ id: String(i), name: p.name }))}
        label="Players"
        onRename={onRename}
        canEdit={canEdit}
      />
    </EntryDialog>
  );
}
