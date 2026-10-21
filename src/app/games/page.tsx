"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, ButtonLink, Chip, Heading } from "@/components/ui";
import styles from "./page.module.css";
import { isBuiltIn, listDefinitions } from "@/state/definitionRegistry";
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
        <Heading level={1}>Games</Heading>
        <ButtonLink
          href="/timer"
          variant="ghost"
          size="sm"
          icon={<ArrowLeft aria-hidden />}
        >
          Back to timer
        </ButtonLink>
      </div>

      <div className={styles.actions}>
        <ButtonLink
          href="/games/new"
          variant="primary"
          icon={<Plus aria-hidden />}
        >
          New game definition
        </ButtonLink>
      </div>

      <ul className={styles.list}>
        {definitions.map((def) => {
          const builtIn = isBuiltIn(def.id);
          return (
            <li key={def.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>
                  {def.name}
                  {builtIn && <Chip tone="muted">Built-in</Chip>}
                </span>
                {def.description && (
                  <span className={styles.rowDescription}>
                    {def.description}
                  </span>
                )}
                <span className={styles.rowMeta}>
                  {def.defaultExpectedTurns} turns · {def.defaultAverageSeconds}
                  s avg
                  {(() => {
                    const pickStep = def.setupSteps?.find(
                      (s) => s.kind.type === "player-pick",
                    );
                    if (pickStep && pickStep.kind.type === "player-pick") {
                      return ` · ${pickStep.kind.options.length} ${pickStep.label.toLowerCase()}s`;
                    }
                    return " · anonymous players";
                  })()}
                  {def.setupSteps && def.setupSteps.length > 0
                    ? ` · ${def.setupSteps.length} setup steps`
                    : ""}
                  {def.score ? " · scored" : ""}
                </span>
              </div>
              {!builtIn && (
                <div className={styles.rowActions}>
                  <ButtonLink
                    href={`/games/edit?id=${encodeURIComponent(def.id)}`}
                    size="sm"
                    icon={<Pencil aria-hidden />}
                    aria-label={`Edit ${def.name}`}
                  >
                    Edit
                  </ButtonLink>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 aria-hidden />}
                    onClick={() => handleDelete(def)}
                    aria-label={`Delete ${def.name}`}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
