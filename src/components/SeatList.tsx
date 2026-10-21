"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { MAX_SEAT_NAME, type SeatColorOption } from "@/state/seating";
import { CommitTextInput } from "./CommitTextInput";
import { Button, Disc, IconButton } from "@/components/ui";
import styles from "./SeatList.module.css";

export interface SeatListSeat {
  id: string;
  name: string;
  colorId?: string;
}

interface SeatListProps {
  seats: SeatListSeat[];
  // Accessible name of the list.
  label: string;
  colorOptions?: SeatColorOption[];
  minPlayers?: number;
  maxPlayers?: number;
  // Each control appears only when its handler is given, so the same
  // list serves an editor and a read-only view.
  onRename?: (index: number, name: string) => void;
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  // Seats whose remove button is offered at all; defaults to every seat.
  canRemove?: (index: number) => boolean;
  onAdd?: () => void;
  onColor?: (index: number, colorId: string) => void;
  // Seats whose name and colour this screen may change; defaults to every
  // seat. Other rows show their name and colour read-only.
  canEdit?: (index: number) => boolean;
  // Trailing content for a row, such as who holds the seat.
  seatNote?: (index: number) => ReactNode;
}

/**
 * The seating list: one row per seat with its name, order and colour.
 * The setup wizard, a companion's seat list and the players sheet all
 * render this, each passing the edits it may make.
 */
export function SeatList({
  seats,
  label,
  colorOptions = [],
  minPlayers = 1,
  maxPlayers = Number.POSITIVE_INFINITY,
  onRename,
  onMove,
  onRemove,
  canRemove = () => true,
  onAdd,
  onColor,
  canEdit = () => true,
  seatNote,
}: SeatListProps) {
  return (
    <div className={styles.seating}>
      <ol className={styles.list} aria-label={label}>
        {seats.map((seat, i) => {
          const color = colorOptions.find((o) => o.id === seat.colorId);
          const displayName = seat.name || `Seat ${i + 1}`;
          const editable = canEdit(i);
          const recolours = onColor && editable && colorOptions.length > 0;
          return (
            <li key={seat.id} className={styles.row}>
              <span className={styles.index} aria-hidden>
                {i + 1}
              </span>
              {onRename && editable ? (
                <CommitTextInput
                  value={seat.name}
                  aria-label={`Seat ${i + 1} name`}
                  maxLength={MAX_SEAT_NAME}
                  autoComplete="off"
                  className={styles.name}
                  onCommit={(name) => onRename(i, name)}
                />
              ) : (
                <span className={styles.nameText}>
                  {color && !recolours && <Disc color={color.color} />}
                  {displayName}
                </span>
              )}
              {seatNote?.(i)}
              {onMove && (
                <>
                  <IconButton
                    label={`Move seat ${i + 1} up`}
                    tooltip={false}
                    onClick={() => onMove(i, i - 1)}
                    disabled={i === 0}
                  >
                    <ArrowUp aria-hidden />
                  </IconButton>
                  <IconButton
                    label={`Move seat ${i + 1} down`}
                    tooltip={false}
                    onClick={() => onMove(i, i + 1)}
                    disabled={i === seats.length - 1}
                  >
                    <ArrowDown aria-hidden />
                  </IconButton>
                </>
              )}
              {onRemove && canRemove(i) && (
                <IconButton
                  label={`Remove seat ${i + 1}`}
                  tooltip={false}
                  onClick={() => onRemove(i)}
                  disabled={seats.length <= minPlayers}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              )}
              {recolours && (
                <div
                  role="radiogroup"
                  aria-label={`${displayName} colour`}
                  className={styles.colors}
                >
                  {colorOptions.map((o) => (
                    <label
                      key={o.id}
                      className={styles.color}
                      style={{ background: o.color }}
                      title={o.label}
                    >
                      <input
                        type="radio"
                        name={`seat-color-${seat.id}`}
                        checked={seat.colorId === o.id}
                        onChange={() => onColor(i, o.id)}
                        aria-label={o.label}
                      />
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {onAdd && (
        <Button
          icon={<Plus aria-hidden />}
          onClick={onAdd}
          disabled={seats.length >= maxPlayers}
          className={styles.add}
        >
          Add seat
        </Button>
      )}
    </div>
  );
}
