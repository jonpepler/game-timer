"use client";

import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import type { EntrySymbol, NameParts } from "@/state/entryIdentity";
import {
  Button,
  Chip,
  ChipRow,
  Disc,
  Disclosure,
  ListRow,
  type SheetStep,
  StepSheet,
} from "@/components/ui";
import { ChipGroup, EntryMark } from "./EntryDialog";
import styles from "./EntrySheets.module.css";
import { EntryName } from "./identity/EntryName";

export interface CombineCandidate {
  id: string;
  name: string;
  color: string;
  symbol?: EntrySymbol;
  value?: number;
}

// The target is named from the sources in `sourceIds` order.
export interface CombineResult {
  sourceIds: string[];
  targetId: string;
  playerIndex: number;
  value?: number;
}

export interface CombineStepHeadings {
  sources?: string;
  target?: string;
  owner?: string;
  confirm?: string;
}

interface CombineEntriesSheetProps {
  label: string;
  count: number;
  sources: CombineCandidate[];
  /**
   * Names that can stand in for a source, offered folded under `label`.
   * At least one real source always takes part.
   */
  extraSources?: { label: string; candidates: CombineCandidate[] };
  targets: CombineCandidate[];
  players: Array<{ name: string; color: string }>;
  // Value controls, when entries carry values. `defaultFor` proposes the
  // combined value from the chosen sources.
  value?: {
    label: string;
    track: number[];
    defaultFor: (sourceIds: string[]) => number | undefined;
  };
  // The question each step asks; generic ones stand in for any missing.
  headings?: CombineStepHeadings;
  initialSourceIds?: string[];
  onConfirm: (result: CombineResult) => void;
  onCancel: () => void;
}

/**
 * Combining entries, one decision per step: the entries to combine, the
 * one they become, its owner, then a check of the result with its name
 * order and value. A single choice moves on by itself; Back returns to
 * change it. The target keeps its name as the title, with the sources in
 * the chosen order as its lineage.
 */
export function CombineEntriesSheet({
  label,
  count,
  sources,
  extraSources,
  targets,
  players,
  value,
  headings = {},
  initialSourceIds = [],
  onConfirm,
  onCancel,
}: CombineEntriesSheetProps) {
  const [step, setStep] = useState(0);
  const [sourceIds, setSourceIds] = useState<string[]>(
    initialSourceIds.slice(0, count),
  );
  const [targetId, setTargetId] = useState<string | null>(null);
  const [owner, setOwner] = useState<number | null>(null);
  const [chosenValue, setChosenValue] = useState<number | null>(null);
  const extras = extraSources?.candidates ?? [];
  const isExtra = (id: string) => extras.some((c) => c.id === id);
  const [extrasOpen, setExtrasOpen] = useState(
    initialSourceIds.some((id) => isExtra(id)),
  );

  const nameOf = (list: CombineCandidate[], id: string) =>
    list.find((c) => c.id === id)?.name ?? id;
  const toggleSource = (id: string) => {
    setSourceIds((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : ids.length < count
          ? [...ids, id]
          : ids,
    );
    setChosenValue(null);
  };
  const complete = sourceIds.length === count;
  const extrasFull = sourceIds.filter(isExtra).length >= count - 1;
  const sourceRow = (c: CombineCandidate, unavailable: boolean) => {
    const chosen = sourceIds.includes(c.id);
    return (
      <li key={c.id}>
        <ListRow
          pressed={chosen}
          disabled={!chosen && unavailable}
          lead={<EntryMark color={c.color} symbol={c.symbol} size="lg" />}
          label={c.name}
          trailing={c.value}
          aria-label={c.value !== undefined ? `${c.name} ${c.value}` : c.name}
          onClick={() => toggleSource(c.id)}
        />
      </li>
    );
  };
  const proposed = complete ? value?.defaultFor(sourceIds) : undefined;
  const effectiveValue = chosenValue ?? proposed ?? null;
  const target = targets.find((t) => t.id === targetId);
  const nameParts: NameParts | null =
    complete && targetId
      ? {
          title: nameOf(targets, targetId),
          lineage: sourceIds.map((id) => nameOf([...sources, ...extras], id)),
        }
      : null;
  const ready =
    complete &&
    targetId !== null &&
    owner !== null &&
    (value === undefined || effectiveValue !== null);
  const next = () => setStep((i) => i + 1);

  const steps: SheetStep[] = [
    {
      id: "sources",
      title: headings.sources ?? `Choose ${count}`,
      ready: complete,
      content: (
        <>
          <ul className={styles.rows}>
            {sources.map((c) => sourceRow(c, complete))}
          </ul>
          {extraSources && extras.length > 0 && (
            <Disclosure
              label={extraSources.label}
              open={extrasOpen}
              onOpenChange={setExtrasOpen}
            >
              <ul className={styles.rows}>
                {extras.map((c) => sourceRow(c, complete || extrasFull))}
              </ul>
            </Disclosure>
          )}
        </>
      ),
    },
    {
      id: "target",
      title: headings.target ?? "Becomes",
      ready: targetId !== null,
      content: (
        <ChipRow>
          {targets.map((t) => (
            <Chip
              key={t.id}
              pressed={targetId === t.id}
              leading={
                <EntryMark color={t.color} symbol={t.symbol} size="md" />
              }
              onPress={() => {
                setTargetId(t.id);
                next();
              }}
            >
              {t.name}
            </Chip>
          ))}
        </ChipRow>
      ),
    },
    {
      id: "owner",
      title: headings.owner ?? "Owner",
      ready: owner !== null,
      content: (
        <ul className={styles.rows}>
          {players.map((p, i) => (
            <li key={p.name}>
              <ListRow
                pressed={owner === i}
                lead={<Disc color={p.color} size="lg" />}
                label={p.name}
                aria-label={p.name}
                onClick={() => {
                  setOwner(i);
                  next();
                }}
              />
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "confirm",
      title: headings.confirm ?? label,
      ready,
      content: (
        <>
          {nameParts && (
            <div className={styles.previewRow}>
              {target?.symbol && (
                <EntryMark
                  color={target.color}
                  symbol={target.symbol}
                  size="lg"
                />
              )}
              <p className={styles.preview} aria-live="polite">
                <EntryName
                  name={nameParts.title}
                  parts={nameParts}
                  color={target?.color}
                />
              </p>
              {count > 1 && (
                <Button
                  icon={<ArrowLeftRight aria-hidden />}
                  onClick={() =>
                    setSourceIds((ids) => [...ids.slice(1), ids[0]])
                  }
                  aria-label="Swap name order"
                >
                  Swap
                </Button>
              )}
            </div>
          )}
          {owner !== null && players[owner] && (
            // The owner under the name, as in the turn order rows.
            <p className={styles.ownerLine}>
              <Disc color={players[owner].color} size="md" />
              {players[owner].name}
            </p>
          )}
          {value && complete && (
            <>
              <ChipGroup
                legend={value.label}
                options={value.track.map((v) => ({
                  value: v,
                  label: String(v),
                }))}
                selected={effectiveValue}
                onSelect={setChosenValue}
              />
              {proposed !== undefined && (
                <p className={styles.note}>
                  Suggested {proposed}: their average, rounded down to the
                  track.
                </p>
              )}
            </>
          )}
        </>
      ),
    },
  ];

  return (
    <StepSheet
      title={label}
      steps={steps}
      index={step}
      onIndexChange={setStep}
      onDismiss={onCancel}
      finish={
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => {
            if (!ready || targetId === null || owner === null) return;
            onConfirm({
              sourceIds,
              targetId,
              playerIndex: owner,
              ...(effectiveValue !== null ? { value: effectiveValue } : {}),
            });
          }}
        >
          {label}
        </Button>
      }
    />
  );
}
