"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import styles from "./page.module.css";
import {
  isBuiltIn,
  listDefinitions,
} from "@/state/definitionRegistry";
import { deleteCustomDefinition } from "@/state/customDefinitions";
import type { GameDefinition } from "@/state/gameDefinition";

export default function GamesLibrary() {
  const [definitions, setDefinitions] = useState<GameDefinition[]>([]);

  const refresh = useCallback(() => setDefinitions(listDefinitions()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = (def: GameDefinition) => {
    if (
      !window.confirm(
        `Delete "${def.name}"? Saved games using this definition will fall back to Generic.`,
      )
    ) {
      return;
    }
    deleteCustomDefinition(def.id);
    refresh();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Games</h1>
        <Link href="/timer" className={styles.backLink}>
          ← Back to timer
        </Link>
      </div>

      <div className={styles.actions}>
        <Link href="/games/new" className={styles.primary}>
          <Plus size={16} aria-hidden />
          New game definition
        </Link>
      </div>

      <ul className={styles.list}>
        {definitions.map((def) => {
          const builtIn = isBuiltIn(def.id);
          return (
            <li key={def.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>
                  {def.name}
                  {builtIn && <span className={styles.badge}>Built-in</span>}
                </span>
                {def.description && (
                  <span className={styles.rowDescription}>
                    {def.description}
                  </span>
                )}
                <span className={styles.rowMeta}>
                  {def.defaultExpectedTurns} turns ·{" "}
                  {def.defaultAverageSeconds}s avg
                  {def.factions
                    ? ` · ${def.factions.length} factions`
                    : " · anonymous players"}
                  {def.score ? " · scored" : ""}
                </span>
              </div>
              {!builtIn && (
                <div className={styles.rowActions}>
                  <Link
                    href={`/games/edit?id=${encodeURIComponent(def.id)}`}
                    className={styles.iconButton}
                    aria-label={`Edit ${def.name}`}
                  >
                    <Pencil aria-hidden />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(def)}
                    className={styles.iconButton}
                    aria-label={`Delete ${def.name}`}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
