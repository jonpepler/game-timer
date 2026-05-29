"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
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
// previous editor surfaced bespoke faction / score / maps / decks
// sections that don't match the new schema shape; the rich editor
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
        <label htmlFor="def-name" className={styles.label}>
          Name
        </label>
        <input
          id="def-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={styles.input}
          placeholder="e.g. Wingspan"
          required
        />
      </div>

      <div className={styles.section}>
        <label htmlFor="def-description" className={styles.label}>
          Description (optional)
        </label>
        <input
          id="def-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={styles.input}
          placeholder="A line of context shown in the Game picker."
        />
      </div>

      <div className={styles.row}>
        <div className={styles.section}>
          <label htmlFor="def-turns" className={styles.label}>
            Default expected turns
          </label>
          <NumberField
            id="def-turns"
            min={1}
            value={expectedTurns}
            onChange={setExpectedTurns}
            className={styles.input}
          />
        </div>
        <div className={styles.section}>
          <label htmlFor="def-average" className={styles.label}>
            Default average seconds per turn
          </label>
          <NumberField
            id="def-average"
            min={1}
            value={averageSeconds}
            onChange={setAverageSeconds}
            className={styles.input}
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
        <button type="button" onClick={onCancel} className={styles.secondary}>
          <X size={16} aria-hidden />
          Cancel
        </button>
        <button type="submit" className={styles.primary}>
          <Save size={16} aria-hidden />
          {initial ? "Save changes" : "Create game"}
        </button>
      </div>
    </form>
  );
}
