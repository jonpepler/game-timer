"use client";

import { useState } from "react";
import type { EntrySymbol } from "@/state/entryIdentity";
import { ChipGroup, EntryDialog } from "./EntryDialog";
import { Button } from "@/components/ui";

interface AddEntryDetailsSheetProps {
  name: string;
  color: string;
  symbol?: EntrySymbol;
  // The value to start at, when the entry carries one.
  value?: { label: string; options: number[] };
  // Seated players to choose the owner from, when one is needed.
  owners?: Array<{ name: string; color: string }>;
  onConfirm: (details: { value?: number; playerIndex?: number }) => void;
  onCancel: () => void;
}

/**
 * The details an entry needs before it can join a list: its starting
 * value and its owner. Nothing is added until both are chosen.
 */
export function AddEntryDetailsSheet({
  name,
  color,
  symbol,
  value,
  owners,
  onConfirm,
  onCancel,
}: AddEntryDetailsSheetProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [owner, setOwner] = useState<number | null>(null);
  const ready =
    (value === undefined || picked !== null) &&
    (owners === undefined || owner !== null);

  return (
    <EntryDialog
      title={`Add ${name}`}
      color={color}
      symbol={symbol}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() =>
              onConfirm({
                ...(picked !== null ? { value: picked } : {}),
                ...(owner !== null ? { playerIndex: owner } : {}),
              })
            }
          >
            Add {name}
          </Button>
        </>
      }
    >
      {value && (
        <ChipGroup
          legend={value.label}
          options={value.options.map((v) => ({ value: v, label: String(v) }))}
          selected={picked}
          onSelect={setPicked}
        />
      )}
      {owners && (
        <ChipGroup
          legend="Owner"
          options={owners.map((p, i) => ({
            value: i,
            label: p.name,
            color: p.color,
          }))}
          selected={owner}
          onSelect={setOwner}
        />
      )}
    </EntryDialog>
  );
}
