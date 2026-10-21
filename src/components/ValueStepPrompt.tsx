"use client";

import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronsDown,
  ChevronsUp,
  Equal,
} from "lucide-react";
import { useId } from "react";
import type { EntrySymbol, NameParts } from "@/state/entryIdentity";
import { EntryDialog } from "./EntryDialog";
import { EntryName } from "./identity/EntryName";
import { Button, ChoiceGrid, ListRow, SectionLabel } from "@/components/ui";
import styles from "./EntrySheets.module.css";

export interface ValueStepChoice {
  id: string;
  label: string;
  hint?: string;
  effect: "move" | "remove";
  // Track spaces moved, for "move" steps.
  spaces?: number;
  // The value the entry ends on, when it stays in play.
  result?: number;
}

interface ValueStepPromptProps {
  entryName: string;
  entryParts?: NameParts;
  entryColor?: string;
  entrySymbol?: EntrySymbol;
  ownerName?: string;
  valueLabel: string;
  // Heading over the answers; the list is named after the value without it.
  stepsLabel?: string;
  value?: number;
  steps: ValueStepChoice[];
  onChoose: (stepId: string) => void;
  onCancel: () => void;
}

// The icon for a step comes from what it does, never from the game.
const StepIcon = ({ step }: { step: ValueStepChoice }) => {
  if (step.effect === "remove") return <Ban aria-hidden />;
  const spaces = step.spaces ?? 0;
  if (spaces <= -2) return <ChevronsDown aria-hidden />;
  if (spaces < 0) return <ArrowDown aria-hidden />;
  if (spaces === 0) return <Equal aria-hidden />;
  if (spaces === 1) return <ArrowUp aria-hidden />;
  return <ChevronsUp aria-hidden />;
};

/**
 * Asked as an entry's turn ends: how did its value move? Each answer
 * shows the value the entry will end on, so the table can check it
 * against the board before committing.
 */
export function ValueStepPrompt({
  entryName,
  entryParts,
  entryColor,
  entrySymbol,
  ownerName,
  valueLabel,
  stepsLabel,
  value,
  steps,
  onChoose,
  onCancel,
}: ValueStepPromptProps) {
  const headingId = useId();
  return (
    <EntryDialog
      title={
        <>
          End <EntryName name={entryName} parts={entryParts} />
          {"’s turn"}
        </>
      }
      color={entryColor}
      symbol={entrySymbol}
      subtitle={ownerName}
      onClose={onCancel}
      width="grid"
      actions={<Button onClick={onCancel}>Keep playing</Button>}
    >
      {value !== undefined && (
        <p className={styles.currentValue}>
          {valueLabel} now <strong>{value}</strong>
        </p>
      )}
      <div className={styles.section}>
        {stepsLabel && (
          <SectionLabel as="h3" id={headingId}>
            {stepsLabel}
          </SectionLabel>
        )}
        <ChoiceGrid
          {...(stepsLabel
            ? { "aria-labelledby": headingId }
            : { "aria-label": `New ${valueLabel}` })}
        >
          {steps.map((step) => (
            <li key={step.id}>
              <ListRow
                tone={step.effect === "remove" ? "danger" : "default"}
                layout="adaptive"
                lead={<StepIcon step={step} />}
                leadWell
                label={step.label}
                hint={step.hint}
                trailing={step.result}
                onClick={() => onChoose(step.id)}
                aria-label={
                  step.result !== undefined
                    ? `${step.label}, ${valueLabel} ${step.result}`
                    : step.label
                }
              />
            </li>
          ))}
        </ChoiceGrid>
      </div>
    </EntryDialog>
  );
}
