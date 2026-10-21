"use client";

import { useRef, useState } from "react";
import { LeadPrompt, type LeadPromptPlayer } from "./LeadPrompt";
import { Button, Prompt } from "@/components/ui";
import styles from "./PhasePrompt.module.css";

export interface PhasePromptPhase {
  id: string;
  label: string;
  // Question to ask for the first entry when this phase starts.
  firstEntryPrompt?: string;
}

export interface PhasePromptEntry extends LeadPromptPlayer {
  id: string;
}

interface PhasePromptProps {
  title: string;
  phases: PhasePromptPhase[];
  currentId: string;
  defaultNextId: string;
  // The entries a phase would run, offered when it asks who goes first.
  entriesFor: (phaseId: string) => PhasePromptEntry[];
  onStart: (phaseId: string, firstEntryId?: string) => void;
  onDismiss: () => void;
  dismissLabel: string;
}

/**
 * Full-screen "what comes next?" picker for games played in phases.
 * The default next phase is the primary button; every other phase is
 * offered below it, each named exactly as the game names it. A phase that asks who goes first moves on to a
 * second screen listing its entries. Escape and the dismiss button
 * leave the current phase running.
 */
export function PhasePrompt({
  title,
  phases,
  currentId,
  defaultNextId,
  entriesFor,
  onStart,
  onDismiss,
  dismissLabel,
}: PhasePromptProps) {
  const [choosingFirstFor, setChoosingFirstFor] =
    useState<PhasePromptPhase | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const choose = (phase: PhasePromptPhase) => {
    if (phase.firstEntryPrompt && entriesFor(phase.id).length > 1) {
      setChoosingFirstFor(phase);
      return;
    }
    onStart(phase.id);
  };

  if (choosingFirstFor) {
    const entries = entriesFor(choosingFirstFor.id);
    return (
      <LeadPrompt
        label={choosingFirstFor.firstEntryPrompt ?? choosingFirstFor.label}
        players={entries}
        onPick={(i) => onStart(choosingFirstFor.id, entries[i].id)}
        onBack={() => setChoosingFirstFor(null)}
      />
    );
  }

  const primary = phases.find((p) => p.id === defaultNextId);
  // The current phase is offered too: playing it again is a legitimate
  // choice the table may need.
  const others = phases.filter((p) => p.id !== defaultNextId);

  return (
    <Prompt
      title={title}
      initialFocus={primaryRef}
      onDismiss={onDismiss}
      actions={
        <Button variant="ghost" fullWidth onClick={onDismiss}>
          {dismissLabel}
        </Button>
      }
    >
      {primary && (
        <Button
          ref={primaryRef}
          variant="primary"
          fullWidth
          onClick={() => choose(primary)}
        >
          {primary.label}
        </Button>
      )}
      {others.length > 0 && (
        <ul className={styles.list}>
          {others.map((p) => (
            <li key={p.id}>
              <Button fullWidth onClick={() => choose(p)}>
                {p.id === currentId ? `${p.label} again` : p.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Prompt>
  );
}
