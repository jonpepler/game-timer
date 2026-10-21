"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Button, Field, SectionLabel } from "@/components/ui";
import styles from "./DefinitionEditor.module.css";
import { NumberField } from "./NumberField";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type GameDefinition,
} from "@/state/gameDefinition";
import { generateDefinitionId } from "@/state/customDefinitions";

interface DefinitionEditorProps {
  initial?: GameDefinition;
  onSave: (def: GameDefinition) => void;
  onCancel: () => void;
}

// Minimal editor while the SetupStep authoring UI is being built. The
// previous editor surfaced bespoke per-game sections that don't match the new schema shape; the rich editor
// comes back as a setupSteps authoring flow in a follow-up commit.
export function DefinitionEditor({
  initial,
  onSave,
  onCancel,
}: DefinitionEditorProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [expectedTurns, setExpectedTurns] = useState<number>(
    initial?.defaultExpectedTurns ?? 60,
  );
  const [averageSeconds, setAverageSeconds] = useState<number>(
    initial?.defaultAverageSeconds ?? 180,
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give the game a name before saving.");
      return;
    }
    setError(null);

    const def: GameDefinition = {
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      id: initial?.id ?? generateDefinitionId(trimmedName),
      name: trimmedName,
      description: description.trim() || undefined,
      defaultExpectedTurns: Math.max(1, Math.round(expectedTurns)),
      defaultAverageSeconds: Math.max(1, Math.round(averageSeconds)),
      // Carry forward anything the previous editor had set so we don't
      // accidentally clobber a richer-than-this-editor-knows-about
      // definition while we wait for the setupSteps authoring UI.
      score: initial?.score,
      maxPlayers: initial?.maxPlayers,
      setupSteps: initial?.setupSteps,
      playerVisualFrom: initial?.playerVisualFrom,
      playerSubheadingFrom: initial?.playerSubheadingFrom,
    };
    onSave(def);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.section}>
        <SectionLabel as="label" htmlFor="def-name">
          Name
        </SectionLabel>
        <Field
          id="def-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Wingspan"
          required
        />
      </div>

      <div className={styles.section}>
        <SectionLabel as="label" htmlFor="def-description">
          Description (optional)
        </SectionLabel>
        <Field
          id="def-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A line of context shown in the Game picker."
        />
      </div>

      <div className={styles.row}>
        <div className={styles.section}>
          <SectionLabel as="label" htmlFor="def-turns">
            Default expected turns
          </SectionLabel>
          <NumberField
            id="def-turns"
            min={1}
            value={expectedTurns}
            onChange={setExpectedTurns}
          />
        </div>
        <div className={styles.section}>
          <SectionLabel as="label" htmlFor="def-average">
            Default average seconds per turn
          </SectionLabel>
          <NumberField
            id="def-average"
            min={1}
            value={averageSeconds}
            onChange={setAverageSeconds}
          />
        </div>
      </div>

      <p className={styles.help}>
        Authoring of setup steps, score rules, and per-player options is being
        rebuilt against the generic SetupStep schema. Until that ships, the
        editor only covers the basics; existing custom definitions are preserved
        verbatim on save.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <Button icon={<X aria-hidden />} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={<Save aria-hidden />}>
          {initial ? "Save changes" : "Create game"}
        </Button>
      </div>
    </form>
  );
}
