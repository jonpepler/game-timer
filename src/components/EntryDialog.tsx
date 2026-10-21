"use client";

import type { ReactNode } from "react";
import { Chip, ChipRow, Disc, SectionLabel, Sheet } from "@/components/ui";
import type { EntrySymbol } from "@/state/entryIdentity";
import styles from "./EntrySheets.module.css";
import { EntryToken } from "./identity/EntryToken";

export interface ChipOption<T> {
  value: T;
  label: string;
  // Swatch colour shown before the label.
  color?: string;
  // Drawn as a token disc in `color` instead of the plain swatch.
  symbol?: EntrySymbol;
}

interface EntryDialogProps {
  title: ReactNode;
  // Colour mark beside the title, for the entry the dialog is about.
  color?: string;
  symbol?: EntrySymbol;
  subtitle?: string;
  // Pinned below the scrolling body.
  actions?: ReactNode;
  // "grid" when the body is a ChoiceGrid.
  width?: "wide" | "grid";
  onClose: () => void;
  children?: ReactNode;
}

/** The colour mark for an entry: its token when it has a symbol, else a Disc. */
export function EntryMark({
  color,
  symbol,
  size,
}: {
  color: string;
  symbol?: EntrySymbol;
  size: "md" | "lg";
}) {
  return symbol ? (
    <EntryToken color={color} symbol={symbol} size={size === "lg" ? 24 : 18} />
  ) : (
    <Disc color={color} size={size} />
  );
}

/**
 * The sheet for one turn entry: its colour beside the title. Escape
 * closes it and clicks never reach a turn-advancing ancestor.
 */
export function EntryDialog({
  title,
  color,
  symbol,
  subtitle,
  actions,
  width = "wide",
  onClose,
  children,
}: EntryDialogProps) {
  return (
    <Sheet
      title={title}
      titleMark={color && <EntryMark color={color} symbol={symbol} size="lg" />}
      subtitle={subtitle}
      actions={actions}
      onDismiss={onClose}
      width={width}
    >
      {children}
    </Sheet>
  );
}

interface ChipGroupProps<T> {
  legend: string;
  options: ChipOption<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
}

// A single-choice row of chips, each a toggle button.
export function ChipGroup<T extends string | number>({
  legend,
  options,
  selected,
  onSelect,
}: ChipGroupProps<T>) {
  return (
    <fieldset className={styles.section}>
      <SectionLabel as="legend">{legend}</SectionLabel>
      <ChipRow>
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            pressed={selected === o.value}
            leading={
              o.color && (
                <EntryMark color={o.color} symbol={o.symbol} size="md" />
              )
            }
            onPress={() => onSelect(o.value)}
          >
            {o.label}
          </Chip>
        ))}
      </ChipRow>
    </fieldset>
  );
}
