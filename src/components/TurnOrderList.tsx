import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import {
  Button,
  Disc,
  IconButton,
  SectionLabel,
  Segmented,
  VisuallyHidden,
} from "@/components/ui";
import styles from "./TurnOrderList.module.css";
import { type AddableEntry, AddTurnEntrySheet } from "./AddTurnEntrySheet";
import type { TurnEntry } from "@/state/gameSession";
import {
  type EntrySymbol,
  type NameParts,
  spokenName,
  type TypeStyle,
} from "@/state/entryIdentity";
import { EntryName } from "./identity/EntryName";
import { EntryToken } from "./identity/EntryToken";
import { typeStyleFor } from "./identity/placement";
import { equalValueSpan } from "@/state/turnLists";

export interface TurnOrderRow {
  id: string;
  // The name as read aloud; see EntryName for how it is drawn.
  name: string;
  color: string;
  nameParts?: NameParts;
  symbol?: EntrySymbol;
  // The type style for this row, already filtered by placement rules.
  typeStyle?: TypeStyle;
  // Display label of the entry's kind, for grouping where entries are
  // added; rows do not show it.
  kindLabel?: string;
  // Linked player's name for entries that are not themselves a player.
  detail?: string;
  // Seat index for player entries, so callers can attach score controls.
  playerIndex: number | null;
  // Whether the row may be taken out of the order from this UI.
  removable: boolean;
  // The entry's value, in value-ordered lists.
  value?: number;
  // Already played this round: its token is turned face down (a hollow
  // disc when it has no symbol), and it is announced.
  spent?: boolean;
}

export interface TurnOrderListTabs {
  options: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}

interface TurnOrderListProps {
  label: string;
  rows: TurnOrderRow[];
  activeId: string | null;
  // Absent = read-only (no handles, no add / remove).
  onMove?: (entryId: string, toIndex: number) => void;
  /**
   * Moves stay among neighbours sharing a row's value, and only rows
   * with such a neighbour get a handle. For lists ordered by value.
   */
  moveWithinEqualValues?: boolean;
  onRemove?: (entryId: string) => void;
  available?: AddableEntry[];
  onAdd?: (entryId: string) => void;
  // Switches between several lists shown in the same panel.
  tabs?: TurnOrderListTabs;
  renderTrailing?: (row: TurnOrderRow) => ReactNode;
  // Opens the actions for one row. When set it replaces the remove
  // button, since removing is one of those actions.
  onRowActions?: (entryId: string) => void;
}

interface DragState {
  id: string;
  from: number;
  over: number;
  dy: number;
  startY: number;
  pointerId: number;
  // Row midpoints and the dragged row's height, measured at grab time.
  mids: number[];
  height: number;
}

interface PlayerLike {
  name: string;
  color: string;
}

/**
 * Project session turn entries onto display rows. A player entry takes
 * its name and colour from the player; any other entry uses its own
 * label and colour, falling back to its linked player's colour.
 */
export const entryToRow = (
  entry: TurnEntry,
  players: PlayerLike[],
  kindLabels: Record<string, string>,
): TurnOrderRow => {
  const player =
    entry.playerIndex !== null ? players[entry.playerIndex] : undefined;
  const ownLabel = entry.label !== undefined;
  const typeStyle = typeStyleFor("row", entry.identity);
  return {
    id: entry.id,
    name: entry.nameParts
      ? spokenName(entry.nameParts)
      : (entry.label ?? player?.name ?? entry.id),
    color: entry.color ?? player?.color ?? "var(--color-border-strong)",
    ...(entry.nameParts ? { nameParts: entry.nameParts } : {}),
    ...(entry.identity?.symbol ? { symbol: entry.identity.symbol } : {}),
    ...(typeStyle ? { typeStyle } : {}),
    kindLabel: entry.kind ? (kindLabels[entry.kind] ?? entry.kind) : undefined,
    detail: ownLabel && player ? player.name : undefined,
    playerIndex: ownLabel ? null : entry.playerIndex,
    removable: ownLabel,
    ...(entry.value !== undefined ? { value: entry.value } : {}),
  };
};

// Spoken for a row that has played, alongside its face-down token.
const PLAYED_LABEL = "played this round";

// Diameter of a row's token, in pixels.
const TOKEN_SIZE = 32;

// Vertical gap between rows; keep in sync with .list's `gap`.
const ROW_GAP = 4;

/**
 * Turn-order list with drag handles. Dragging uses pointer events on
 * the handle only (mouse, pen and touch alike) with pointer capture, so
 * the rest of each row stays tappable and the page does not scroll
 * while a handle is held. Arrow keys on a focused handle move the row
 * one place; Home / End move it to the ends. Every move is announced
 * through a polite live region.
 */
export function TurnOrderList({
  label,
  rows,
  activeId,
  onMove,
  moveWithinEqualValues = false,
  onRemove,
  available,
  onAdd,
  tabs,
  renderTrailing,
  onRowActions,
}: TurnOrderListProps) {
  const instructionsId = useId();
  const [adding, setAdding] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const nameOf = (id: string | null) =>
    rows.find((r) => r.id === id)?.name ?? "";

  const values = rows.map((r) => r.value);
  // The indexes a row may move between.
  const spanOf = (index: number): [number, number] =>
    moveWithinEqualValues
      ? equalValueSpan(values, index)
      : [0, rows.length - 1];
  const movable = (index: number) => {
    const [first, last] = spanOf(index);
    return onMove !== undefined && first < last;
  };

  const commitMove = (id: string, from: number, to: number) => {
    const [first, last] = spanOf(from);
    if (!onMove || to < first || to > last || to === from) return;
    onMove(id, to);
    // Work out who is next after the move for the announcement.
    const order = rows.map((r) => r.id).filter((x) => x !== id);
    order.splice(to, 0, id);
    const at = activeId ? order.indexOf(activeId) : -1;
    const next = order.length > 1 ? order[(at + 1) % order.length] : null;
    setAnnouncement(
      `${nameOf(id)} moved to position ${to + 1} of ${rows.length}.` +
        // Who follows in a value-ordered list is not simply the next row.
        (next && !moveWithinEqualValues ? ` Next up: ${nameOf(next)}.` : ""),
    );
  };

  const onHandleKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    id: string,
    index: number,
  ) => {
    const to =
      e.key === "ArrowUp"
        ? index - 1
        : e.key === "ArrowDown"
          ? index + 1
          : e.key === "Home"
            ? spanOf(index)[0]
            : e.key === "End"
              ? spanOf(index)[1]
              : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    commitMove(id, index, to);
  };

  const onPointerDown = (
    e: PointerEvent<HTMLButtonElement>,
    id: string,
    index: number,
  ) => {
    if (!onMove || drag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rects = rows.map((r) =>
      rowRefs.current.get(r.id)?.getBoundingClientRect(),
    );
    setDrag({
      id,
      from: index,
      over: index,
      dy: 0,
      startY: e.clientY,
      pointerId: e.pointerId,
      mids: rects.map((r) => (r ? r.top + r.height / 2 : 0)),
      height: rects[index]?.height ?? 0,
    });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    const dy = e.clientY - drag.startY;
    const centre = drag.mids[drag.from] + dy;
    // The drop slot is the number of other rows whose midpoint the
    // dragged row's centre has passed.
    let over = 0;
    drag.mids.forEach((mid, i) => {
      if (i !== drag.from && mid < centre) over++;
    });
    const [first, last] = spanOf(drag.from);
    over = Math.max(first, Math.min(last, over));
    setDrag({ ...drag, dy, over });
  };

  const endDrag = (e: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    if (commit) commitMove(drag.id, drag.from, drag.over);
    setDrag(null);
  };

  // How far a non-dragged row shifts to open the drop slot.
  const shiftFor = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    const step = drag.height + ROW_GAP;
    if (drag.from < drag.over && index > drag.from && index <= drag.over)
      return -step;
    if (drag.over < drag.from && index >= drag.over && index < drag.from)
      return step;
    return 0;
  };

  const canAdd = onAdd !== undefined && (available?.length ?? 0) > 0;

  return (
    // Taps inside the list never reach a turn-advancing ancestor.
    // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not an interactive element
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard only, not an interactive element
    <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        {tabs && tabs.options.length > 1 ? (
          <Segmented
            label="Show list"
            options={tabs.options.map((t) => ({ value: t.id, label: t.label }))}
            value={tabs.activeId}
            onChange={tabs.onChange}
          />
        ) : (
          <SectionLabel as="span">{label}</SectionLabel>
        )}
        {canAdd && (
          <Button
            size="sm"
            icon={<Plus aria-hidden />}
            onClick={() => setAdding(true)}
            aria-label={`Add to ${label}`}
          >
            Add
          </Button>
        )}
      </div>
      {onMove && (
        <VisuallyHidden as="p" id={instructionsId}>
          {moveWithinEqualValues
            ? "Drag a handle, or focus it and use the up and down arrow keys, to change the order among entries that share a value."
            : "Drag a handle, or focus it and use the up and down arrow keys, to change who goes next."}
        </VisuallyHidden>
      )}
      <ol className={styles.list} aria-label={label}>
        {rows.map((row, index) => {
          const isActive = row.id === activeId;
          const isDragged = drag?.id === row.id;
          const shift = isDragged ? (drag?.dy ?? 0) : shiftFor(index);
          const playedNote = row.spent ? `, ${PLAYED_LABEL}` : "";
          return (
            <li
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              className={[
                styles.row,
                isActive ? styles.active : "",
                row.spent ? styles.spent : "",
                isDragged ? styles.dragging : "",
                drag && !isDragged ? styles.shifting : "",
              ].join(" ")}
              style={{
                transform: shift ? `translateY(${shift}px)` : undefined,
                ["--row-color" as string]: row.color,
              }}
              aria-current={isActive ? "step" : undefined}
              data-entry-id={row.id}
            >
              {movable(index) ? (
                <IconButton
                  label={`Reorder ${row.name}${playedNote}, position ${index + 1} of ${rows.length}`}
                  tone="plain"
                  tooltip={false}
                  className={styles.handle}
                  aria-describedby={instructionsId}
                  onPointerDown={(e) => onPointerDown(e, row.id, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => endDrag(e, true)}
                  onPointerCancel={(e) => endDrag(e, false)}
                  onKeyDown={(e) => onHandleKeyDown(e, row.id, index)}
                >
                  <GripVertical aria-hidden />
                </IconButton>
              ) : (
                onMove && <span className={styles.handleSlot} />
              )}
              {row.symbol ? (
                <EntryToken
                  color={row.color}
                  symbol={row.symbol}
                  size={TOKEN_SIZE}
                  faceDown={row.spent}
                />
              ) : (
                <span className={styles.discSlot}>
                  <Disc color={row.color} size="lg" hollow={row.spent} />
                </span>
              )}
              <span className={styles.name}>
                <span className={styles.nameText}>
                  {row.nameParts || row.typeStyle ? (
                    <EntryName
                      name={row.name}
                      parts={row.nameParts}
                      typeStyle={row.typeStyle}
                      layout="title"
                    />
                  ) : (
                    row.name
                  )}
                </span>
                {row.spent && <VisuallyHidden>{playedNote}</VisuallyHidden>}
                {row.detail && (
                  <span className={styles.detail}>{row.detail}</span>
                )}
              </span>
              {row.value !== undefined && (
                <span className={styles.value}>{row.value}</span>
              )}
              {renderTrailing?.(row)}
              {onRowActions && (
                <IconButton
                  label={`Actions for ${row.name}${playedNote}`}
                  tooltip={false}
                  onClick={() => onRowActions(row.id)}
                >
                  <MoreHorizontal aria-hidden />
                </IconButton>
              )}
              {!onRowActions && onRemove && row.removable && (
                <IconButton
                  label={`Remove ${row.name} from turn order`}
                  tooltip={false}
                  onClick={() => onRemove(row.id)}
                >
                  <X aria-hidden />
                </IconButton>
              )}
            </li>
          );
        })}
      </ol>
      {adding && onAdd && (
        <AddTurnEntrySheet
          title={`Add to ${label}`}
          entries={available ?? []}
          onAdd={onAdd}
          onClose={() => setAdding(false)}
        />
      )}
      <VisuallyHidden as="div" aria-live="polite" role="status">
        {announcement}
      </VisuallyHidden>
    </div>
  );
}
