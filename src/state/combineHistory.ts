import type { TurnEntry, ValuePoint } from "./turnLists";

/** Where a combined source went: the entry it joined and the turn count then. */
export interface CombineLink {
  entryId: string;
  turn: number;
}

/**
 * Which entries were combined into which, read back from what a session
 * already stores, since a combine keeps no link between its sources and
 * its target. A combined entry's lineage names its sources by label; each
 * label is matched to the one other entry with that label and a value
 * history. A label that matches none (a stand-in, which only lends its
 * name) or several is skipped. The combine turn is the target's first
 * value point at or after its matched sources' last ones, which is the
 * point a combine records for it. Returns each source's link by id.
 */
export const combinesFromHistory = (
  entries: TurnEntry[],
  history: ValuePoint[],
): Map<string, CombineLink> => {
  const turnsOf = new Map<string, number[]>();
  for (const point of history) {
    const turns = turnsOf.get(point.entryId) ?? [];
    turns.push(point.turn);
    turnsOf.set(point.entryId, turns);
  }
  const charted = entries.filter((e) => turnsOf.has(e.id));
  const links = new Map<string, CombineLink>();
  for (const target of charted) {
    const lineage = target.nameParts?.lineage ?? [];
    if (lineage.length === 0) continue;
    const sourceIds = lineage.flatMap((label) => {
      const matches = charted.filter(
        (e) => e.id !== target.id && e.label === label,
      );
      return matches.length === 1 ? [matches[0].id] : [];
    });
    if (sourceIds.length === 0) continue;
    const sourcesEnd = Math.max(
      ...sourceIds.map((id) => Math.max(...(turnsOf.get(id) ?? []))),
    );
    const turn = (turnsOf.get(target.id) ?? []).find((t) => t >= sourcesEnd);
    if (turn === undefined) continue;
    for (const id of sourceIds) links.set(id, { entryId: target.id, turn });
  }
  return links;
};
