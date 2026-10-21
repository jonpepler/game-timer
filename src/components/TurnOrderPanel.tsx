import { useEffect, useState } from "react";
import { Stepper } from "@/components/ui";
import styles from "./TurnOrderPanel.module.css";
import {
  entryToRow,
  TurnOrderList,
  type TurnOrderRow,
} from "@/components/TurnOrderList";
import type { ScoreConfig } from "@/state/gameDefinition";
import type { TurnEntry, TurnOrderView } from "@/state/gameSession";

interface Player {
  name: string;
  color: string;
  iconSrc?: string;
  headIconSrc?: string;
}

export interface TurnOrderPanelData {
  // The running list.
  view: TurnOrderView;
  onMove?: (entryId: string, toIndex: number) => void;
  onRemove?: (entryId: string) => void;
  onAdd?: (entryId: string) => void;
  available?: TurnEntry[];
  // Every list, when there are several, so lists that are not running
  // can be viewed and edited too (e.g. adding entries ahead of the
  // phase that runs them).
  lists?: Array<{ view: TurnOrderView; available: TurnEntry[] }>;
  // Opens the actions for one entry (value, owner, combine, remove).
  onRowActions?: (entryId: string) => void;
  // Shown where a score track would be, for games without scores.
  chart?: React.ReactNode;
}

interface TurnOrderPanelProps {
  players: Player[];
  turnOrder: TurnOrderPanelData;
  scores?: Record<number, number>;
  // When it shows scores, each player's row carries their +/- controls,
  // so the score panel needs no catch-up stack of its own.
  scoreConfig?: ScoreConfig;
  onIncrement?: (playerIndex: number, delta: number) => void;
  readOnly?: boolean;
}

/**
 * A variable turn order: the running list, tabs for any other lists, and
 * the actions on their entries. Always open, so who is up next can be
 * seen at a glance.
 */
export function TurnOrderPanel({
  players,
  turnOrder,
  scores = {},
  scoreConfig,
  onIncrement,
  readOnly = false,
}: TurnOrderPanelProps) {
  // Which list is shown; follows the running list whenever that changes.
  const runningListId = turnOrder.view.listId;
  const [shownListId, setShownListId] = useState(runningListId);
  useEffect(() => {
    setShownListId(runningListId);
  }, [runningListId]);

  const scoresShown =
    scoreConfig !== undefined &&
    scoreConfig.displayStyle !== "hidden" &&
    players.length > 0;

  const scoreControlsFor = (row: TurnOrderRow) => {
    const i = row.playerIndex;
    if (i === null || !scoreConfig || !scoresShown || readOnly || !onIncrement)
      return null;
    const { min, max, increment: step } = scoreConfig;
    const score = scores[i] ?? min;
    return (
      <Stepper
        framed={false}
        value={score}
        onDecrement={() => onIncrement(i, -step)}
        onIncrement={() => onIncrement(i, step)}
        canDecrement={score > min}
        canIncrement={max === undefined || score < max}
        decrementLabel={`Decrease score for ${row.name}`}
        incrementLabel={`Increase score for ${row.name}`}
      />
    );
  };

  const shown = turnOrder.lists?.find((l) => l.view.listId === shownListId) ?? {
    view: turnOrder.view,
    available: turnOrder.available ?? [],
  };
  // The active row only means something for the list that is running.
  const shownIsRunning = shown.view.listId === runningListId;

  return (
    <section className={styles.panel} aria-label="Turn order">
      <TurnOrderList
        label={shown.view.listLabel}
        rows={shown.view.entries.map((e) => ({
          ...entryToRow(e, players, shown.view.kindLabels),
          spent: shown.view.playedIds.includes(e.id),
        }))}
        activeId={shownIsRunning ? shown.view.activeId : null}
        onMove={
          readOnly || shown.view.valueOrdered ? undefined : turnOrder.onMove
        }
        onRemove={readOnly ? undefined : turnOrder.onRemove}
        onRowActions={
          readOnly || !shown.view.valueOrdered
            ? undefined
            : turnOrder.onRowActions
        }
        onAdd={readOnly ? undefined : turnOrder.onAdd}
        available={shown.available.map((e) => {
          const row = entryToRow(e, players, shown.view.kindLabels);
          return {
            id: e.id,
            name: row.name,
            color: row.color,
            kindLabel: row.kindLabel,
          };
        })}
        tabs={
          turnOrder.lists && turnOrder.lists.length > 1
            ? {
                options: turnOrder.lists.map((l) => ({
                  id: l.view.listId,
                  label: l.view.listLabel,
                })),
                activeId: shown.view.listId,
                onChange: setShownListId,
              }
            : undefined
        }
        renderTrailing={scoreControlsFor}
      />
    </section>
  );
}
