"use client";

import { useRef } from "react";
import { Button, ListRow, SectionLabel, Sheet } from "@/components/ui";
import styles from "./AddTurnEntrySheet.module.css";

export interface AddableEntry {
  id: string;
  name: string;
  color: string;
  kindLabel?: string;
}

interface AddTurnEntrySheetProps {
  title: string;
  entries: AddableEntry[];
  onAdd: (entryId: string) => void;
  onClose: () => void;
}

// Entries grouped by kind label, groups in first-seen order.
const groupByKind = (entries: AddableEntry[]) => {
  const groups = new Map<string, AddableEntry[]>();
  for (const e of entries) {
    const key = e.kindLabel ?? "";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return Array.from(groups.entries());
};

/**
 * Full-screen picker for putting known entries into a turn order. It
 * stays open so several can be added in a row; each added entry drops
 * out of the list because it is no longer available.
 */
export function AddTurnEntrySheet({
  title,
  entries,
  onAdd,
  onClose,
}: AddTurnEntrySheetProps) {
  const doneRef = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      title={title}
      width="wide"
      onDismiss={onClose}
      initialFocus={doneRef}
      actions={
        <Button ref={doneRef} variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {entries.length === 0 ? (
        <p className={styles.empty}>Everything is already in play.</p>
      ) : (
        groupByKind(entries).map(([kind, group]) => (
          <section
            key={kind || "other"}
            className={styles.group}
            aria-label={kind || undefined}
          >
            {kind && <SectionLabel as="h3">{kind}</SectionLabel>}
            <ul className={styles.list}>
              {group.map((e) => (
                <li key={e.id}>
                  <ListRow
                    color={e.color}
                    label={e.name}
                    onClick={() => onAdd(e.id)}
                    aria-label={`Add ${e.name}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Sheet>
  );
}
