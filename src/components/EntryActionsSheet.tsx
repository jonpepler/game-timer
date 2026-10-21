"use client";

import { ArrowDown, ArrowUp, Combine, Trash2 } from "lucide-react";
import type { EntrySymbol, NameParts } from "@/state/entryIdentity";
import { ChipGroup, EntryDialog } from "./EntryDialog";
import { EntryName } from "./identity/EntryName";
import { Button } from "@/components/ui";
import styles from "./EntrySheets.module.css";

interface PlayerChoice {
  name: string;
  color: string;
}

interface EntryActionsSheetProps {
  name: string;
  nameParts?: NameParts;
  color: string;
  symbol?: EntrySymbol;
  ownerIndex: number | null;
  players: PlayerChoice[];
  // Absent when the entry is never linked to a player.
  onSetOwner?: (playerIndex: number) => void;
  // Value controls, when the entry carries a value.
  value?: {
    label: string;
    current?: number;
    track: number[];
    onSet: (value: number) => void;
  };
  // Combining this entry with others, when allowed.
  combine?: { label: string; onStart: () => void };
  onRemove?: () => void;
  onClose: () => void;
}

/**
 * Everything the table can do to one entry outside its turn: change its
 * value, hand it to another player, combine it, or take it out of play.
 * Each change applies at once and closes the sheet.
 */
export function EntryActionsSheet({
  name,
  nameParts,
  color,
  symbol,
  ownerIndex,
  players,
  onSetOwner,
  value,
  combine,
  onRemove,
  onClose,
}: EntryActionsSheetProps) {
  const done = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const at =
    value?.current !== undefined ? value.track.indexOf(value.current) : -1;
  const below = at > 0 ? value?.track[at - 1] : undefined;
  const above =
    value && at >= 0 && at < value.track.length - 1
      ? value.track[at + 1]
      : undefined;

  return (
    <EntryDialog
      title={<EntryName name={name} parts={nameParts} />}
      color={color}
      symbol={symbol}
      subtitle={ownerIndex !== null ? players[ownerIndex]?.name : undefined}
      onClose={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {value && (
        <>
          {value.current !== undefined && (
            <p className={styles.currentValue}>
              {value.label} now <strong>{value.current}</strong>
            </p>
          )}
          {(below !== undefined || above !== undefined) && (
            <div className={styles.actions}>
              {below !== undefined && (
                <Button
                  icon={<ArrowDown aria-hidden />}
                  onClick={done(() => value.onSet(below))}
                >
                  Down to {below}
                </Button>
              )}
              {above !== undefined && (
                <Button
                  icon={<ArrowUp aria-hidden />}
                  onClick={done(() => value.onSet(above))}
                >
                  Up to {above}
                </Button>
              )}
            </div>
          )}
          <ChipGroup
            legend={`Set ${value.label}`}
            options={value.track.map((v) => ({ value: v, label: String(v) }))}
            selected={value.current ?? null}
            onSelect={(v) => {
              value.onSet(v);
              onClose();
            }}
          />
        </>
      )}
      {onSetOwner && players.length > 0 && (
        <ChipGroup
          legend="Owner"
          options={players.map((p, i) => ({
            value: i,
            label: p.name,
            color: p.color,
          }))}
          selected={ownerIndex}
          onSelect={(i) => {
            onSetOwner(i);
            onClose();
          }}
        />
      )}
      {(combine || onRemove) && (
        <div className={styles.actions}>
          {combine && (
            <Button
              icon={<Combine aria-hidden />}
              onClick={done(combine.onStart)}
            >
              {combine.label}
            </Button>
          )}
          {onRemove && (
            <Button
              variant="danger"
              icon={<Trash2 aria-hidden />}
              onClick={done(onRemove)}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </EntryDialog>
  );
}
