/**
 * Pure operations on a setup seating list. The setup wizard, the host's
 * command path and its claim bookkeeping all go through these, so a seat
 * change made on any screen lands the same way.
 */

export interface Seat {
  // Stable for the life of the seat, so claims can follow it when the
  // list is reordered.
  id: string;
  name: string;
  colorId?: string;
}

export interface SeatColorOption {
  id: string;
  label: string;
  color: string;
}

// The longest seat name accepted from any screen.
export const MAX_SEAT_NAME = 40;

/** A fresh seat id; random-suffixed where `crypto` is unavailable. */
export const makeSeatId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seat-${Math.random().toString(36).slice(2, 11)}`;
};

/** The first colour no seat holds, for a newly added seat. */
export const freeColorId = (
  seats: ReadonlyArray<{ colorId?: string }>,
  colorOptions: ReadonlyArray<SeatColorOption> | undefined,
): string | undefined => {
  const taken = new Set(seats.map((s) => s.colorId));
  return colorOptions?.find((o) => !taken.has(o.id))?.id;
};

export const addSeat = (
  seats: Seat[],
  seat: { id: string; name?: string },
  colorOptions?: ReadonlyArray<SeatColorOption>,
): Seat[] => {
  const colorId = freeColorId(seats, colorOptions);
  return [
    ...seats,
    {
      id: seat.id,
      name: seat.name?.trim() || `Player ${seats.length + 1}`,
      ...(colorId ? { colorId } : {}),
    },
  ];
};

export const removeSeat = (seats: Seat[], index: number): Seat[] =>
  index >= 0 && index < seats.length
    ? seats.filter((_, i) => i !== index)
    : seats;

export const renameSeat = (
  seats: Seat[],
  index: number,
  name: string,
): Seat[] =>
  seats.map((s, i) => (i === index ? { ...s, name: name.trim() } : s));

/** Move the seat at `from` so it ends up at `to`. */
export const moveSeat = (seats: Seat[], from: number, to: number): Seat[] => {
  if (from === to || from < 0 || from >= seats.length) return seats;
  if (to < 0 || to >= seats.length) return seats;
  const next = [...seats];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * Colours stay one per seat: taking a colour another seat holds hands
 * that seat this seat's old colour.
 */
export const setSeatColor = (
  seats: Seat[],
  index: number,
  colorId: string,
): Seat[] => {
  const previous = seats[index]?.colorId;
  return seats.map((s, i) => {
    if (i === index) return { ...s, colorId };
    if (s.colorId === colorId) {
      const { colorId: _, ...rest } = s;
      return previous !== undefined ? { ...rest, colorId: previous } : rest;
    }
    return s;
  });
};

/**
 * Carry a peer-to-seat-index claim map across a change to the seating
 * list, matching seats by id: a claim follows its seat to its new index
 * and is dropped with a removed seat. Without a previous list (the
 * seating has just appeared) claims keep their index while it exists.
 * Returns `claims` itself when nothing moved.
 */
export const followSeats = (
  claims: Readonly<Record<string, number>>,
  before: ReadonlyArray<{ id: string }> | null,
  after: ReadonlyArray<{ id: string }>,
): Record<string, number> => {
  const newIndex = new Map(after.map((s, i) => [s.id, i]));
  const next: Record<string, number> = {};
  let changed = false;
  for (const [peer, index] of Object.entries(claims)) {
    const moved = before
      ? newIndex.get(before[index]?.id ?? "")
      : index < after.length
        ? index
        : undefined;
    if (moved !== undefined) next[peer] = moved;
    if (moved !== index) changed = true;
  }
  return changed ? next : (claims as Record<string, number>);
};
