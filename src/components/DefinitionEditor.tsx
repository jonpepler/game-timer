"use client";

import { useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import styles from "./DefinitionEditor.module.css";
import {
  GAME_DEFINITION_SCHEMA_VERSION,
  type Faction,
  type GameDefinition,
  type ScoreConfig,
} from "@/state/gameDefinition";
import { generateDefinitionId } from "@/state/customDefinitions";

interface DefinitionEditorProps {
  initial?: GameDefinition;
  onSave: (def: GameDefinition) => void;
  onCancel: () => void;
}

const FACTION_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
  "#9E47E8",
  "#D9D9D9",
];

const defaultScore: ScoreConfig = {
  displayStyle: "linearTrack",
  min: 0,
  max: 30,
  increment: 1,
  victory: { type: "firstToMax" },
};

const factionId = (name: string, fallbackIndex: number): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || `faction-${fallbackIndex + 1}`;
};

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
  const [factions, setFactions] = useState<Faction[]>(
    initial?.factions
      ? initial.factions.map((f) => ({ ...f }))
      : [],
  );
  const [scoreEnabled, setScoreEnabled] = useState<boolean>(
    !!initial?.score,
  );
  const [score, setScore] = useState<ScoreConfig>(
    initial?.score ?? defaultScore,
  );
  const [error, setError] = useState<string | null>(null);

  const addFaction = () => {
    const palette = FACTION_PALETTE[factions.length % FACTION_PALETTE.length];
    const draftName = `Faction ${factions.length + 1}`;
    setFactions([
      ...factions,
      {
        id: factionId(draftName, factions.length),
        name: draftName,
        color: palette,
      },
    ]);
  };

  const updateFaction = (
    index: number,
    field: keyof Faction,
    value: string,
  ) => {
    setFactions((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const next = { ...f, [field]: value };
        // Re-derive the id when the name changes to keep it readable.
        // Ids must round-trip through JSON; we drop arbitrary chars.
        if (field === "name") next.id = factionId(value, i);
        return next;
      }),
    );
  };

  const removeFaction = (index: number) => {
    setFactions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give the game a name before saving.");
      return;
    }
    // Faction ids must be unique within a definition (foreign key from
    // PlayerSlot.factionId).
    const ids = factions.map((f) => f.id);
    if (new Set(ids).size !== ids.length) {
      setError(
        "Two factions ended up with the same id — rename them to keep them distinct.",
      );
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
      factions: factions.length > 0 ? factions : undefined,
      score: scoreEnabled ? score : undefined,
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
          <input
            id="def-turns"
            type="number"
            min={1}
            value={expectedTurns}
            onChange={(e) =>
              setExpectedTurns(Math.max(1, parseInt(e.target.value) || 1))
            }
            className={styles.input}
          />
        </div>
        <div className={styles.section}>
          <label htmlFor="def-average" className={styles.label}>
            Default average seconds per turn
          </label>
          <input
            id="def-average"
            type="number"
            min={1}
            value={averageSeconds}
            onChange={(e) =>
              setAverageSeconds(Math.max(1, parseInt(e.target.value) || 1))
            }
            className={styles.input}
          />
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Factions (optional)</span>
        <p className={styles.help}>
          When set, the player rows in Game Setup pre-fill from this list
          instead of generic Player N rows.
        </p>
        <ul className={styles.factionList}>
          {factions.map((faction, i) => (
            <li key={i} className={styles.factionRow}>
              <input
                type="color"
                value={faction.color}
                onChange={(e) => updateFaction(i, "color", e.target.value)}
                className={styles.colorSwatch}
                aria-label={`Colour for faction ${i + 1}`}
              />
              <input
                type="text"
                value={faction.name}
                onChange={(e) => updateFaction(i, "name", e.target.value)}
                className={styles.input}
                aria-label={`Faction ${i + 1} name`}
              />
              <button
                type="button"
                onClick={() => removeFaction(i)}
                className={styles.iconButton}
                aria-label={`Remove faction ${i + 1}`}
              >
                <Trash2 aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={addFaction} className={styles.addRow}>
          <Plus size={14} aria-hidden />
          Add faction
        </button>
      </div>

      <div className={styles.section}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={scoreEnabled}
            onChange={(e) => setScoreEnabled(e.target.checked)}
          />
          Track score
        </label>
        {scoreEnabled && (
          <div className={styles.subPanel}>
            <div className={styles.row}>
              <div className={styles.section}>
                <label htmlFor="score-min" className={styles.label}>
                  Min
                </label>
                <input
                  id="score-min"
                  type="number"
                  value={score.min}
                  onChange={(e) =>
                    setScore({ ...score, min: parseInt(e.target.value) || 0 })
                  }
                  className={styles.input}
                />
              </div>
              <div className={styles.section}>
                <label htmlFor="score-max" className={styles.label}>
                  Max (blank = no cap)
                </label>
                <input
                  id="score-max"
                  type="number"
                  value={score.max ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setScore({
                      ...score,
                      max: raw === "" ? undefined : parseInt(raw) || 0,
                    });
                  }}
                  className={styles.input}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.section}>
                <label htmlFor="score-increment" className={styles.label}>
                  Increment
                </label>
                <input
                  id="score-increment"
                  type="number"
                  min={1}
                  value={score.increment}
                  onChange={(e) =>
                    setScore({
                      ...score,
                      increment: Math.max(1, parseInt(e.target.value) || 1),
                    })
                  }
                  className={styles.input}
                />
              </div>
              <div className={styles.section}>
                <label htmlFor="score-display" className={styles.label}>
                  Display style
                </label>
                <select
                  id="score-display"
                  value={score.displayStyle}
                  onChange={(e) =>
                    setScore({
                      ...score,
                      displayStyle: e.target
                        .value as ScoreConfig["displayStyle"],
                    })
                  }
                  className={styles.select}
                >
                  <option value="linearTrack">Linear track</option>
                  <option value="leaderboard">Leaderboard</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>
            </div>
            <div className={styles.section}>
              <label htmlFor="score-victory" className={styles.label}>
                Victory rule
              </label>
              <select
                id="score-victory"
                value={score.victory?.type ?? "none"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "none") {
                    setScore({ ...score, victory: undefined });
                  } else {
                    setScore({
                      ...score,
                      victory: { type: val as "firstToMax" | "highestAtTurnLimit" },
                    });
                  }
                }}
                className={styles.select}
              >
                <option value="none">No automatic victory</option>
                <option value="firstToMax">First to max wins</option>
                <option value="highestAtTurnLimit">
                  Highest at turn limit wins
                </option>
              </select>
            </div>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.secondary}
        >
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
