import { describe, expect, it } from "vitest";
import {
  type GameSessionAction,
  type GameSessionState,
  newUndoGroup,
  selectCurrentPlayerIndex,
  selectNeedsValueStep,
  selectTurnPhases,
} from "./gameSession";
import {
  active,
  add,
  end,
  order,
  phase,
  played,
  run,
  setValue,
  threeEntries,
  view,
} from "./valuedFixture";

const undo: GameSessionAction = { type: "UNDO" };

const inGroup = (
  undoGroup: string,
  ...actions: GameSessionAction[]
): GameSessionAction[] => actions.map((a) => ({ ...a, undoGroup }));

const depth = (s: GameSessionState) => s.undoStack?.length ?? 0;

// The parts of a session an undo is expected to restore exactly.
const observable = (s: GameSessionState) => ({
  order: order(s),
  played: played(s),
  active: active(s),
  phase: s.activePhaseId,
  turns: s.turns,
  history: s.valueHistory,
  pending: selectTurnPhases(s)?.pendingPrompt,
  currentTurnStartedAt: s.currentTurnStartedAt,
  entries: s.turnEntries,
});

describe("undo groups", () => {
  it("stores one snapshot for consecutive actions sharing a group", () => {
    const before = threeEntries();
    const g = newUndoGroup();
    const after = run(
      before,
      ...inGroup(g, setValue("c", 100), setValue("b", 60)),
    );
    expect(depth(after)).toBe(depth(before) + 1);
    expect(observable(run(after, undo))).toEqual(observable(before));
  });

  it("keeps ungrouped actions and different groups as separate events", () => {
    const before = threeEntries();
    const ungrouped = run(before, setValue("c", 100), setValue("b", 60));
    expect(depth(ungrouped)).toBe(depth(before) + 2);
    const split = run(
      before,
      ...inGroup(newUndoGroup(), setValue("c", 100)),
      ...inGroup(newUndoGroup(), setValue("b", 60)),
    );
    expect(depth(split)).toBe(depth(before) + 2);
    expect(order(run(split, undo))).toEqual(
      order(run(before, setValue("c", 100))),
    );
  });

  it("ignores actions in a group that UNDO never takes back", () => {
    const before = threeEntries();
    const g = newUndoGroup();
    const after = run(
      before,
      ...inGroup(g, setValue("c", 100), { type: "DISMISS_PHASE_PROMPT" }),
    );
    expect(depth(after)).toBe(depth(before) + 1);
  });

  it("starts a fresh event when a group id is reused after its undo", () => {
    const before = threeEntries();
    const g = newUndoGroup();
    const once = run(before, ...inGroup(g, setValue("c", 100)), undo);
    const again = run(once, ...inGroup(g, setValue("b", 60)));
    expect(depth(again)).toBe(depth(before) + 1);
    expect(observable(run(again, undo))).toEqual(observable(before));
  });

  it("hands out distinct ids", () => {
    expect(newUndoGroup()).not.toBe(newUndoGroup());
  });
});

describe("one undo per flow", () => {
  it("ending a turn with its value answer undoes to the same entry, asking again", () => {
    const before = run(threeEntries(), end("down"));
    expect(active(before)).toBe("b");
    expect(selectNeedsValueStep(before)).toBe(true);
    const after = run(before, ...inGroup(newUndoGroup(), end("up2", 45)));
    expect(active(after)).toBe("c");
    const undone = run(after, undo);
    expect(observable(undone)).toEqual(observable(before));
    expect(active(undone)).toBe("b");
    expect(selectNeedsValueStep(undone)).toBe(true);
    // Ending it again applies the new answer to the same entry.
    const replayed = run(undone, end("same", 50));
    expect(replayed.turns.at(-1)?.entryId).toBe("b");
    expect(played(replayed)).toEqual(["a", "b"]);
  });

  it("adding an entry with its value and owner undoes as one", () => {
    const before = threeEntries();
    const g = newUndoGroup();
    const details = run(before, ...inGroup(g, add("d", 90, 2)));
    expect(order(details)).toContain("d90");
    expect(observable(run(details, undo))).toEqual(observable(before));
    // The same flow, applied as separate steps, is still one event.
    const steps = run(
      before,
      ...inGroup(
        g,
        { type: "ACTIVATE_TURN_ENTRY", entry: { id: "d" } },
        setValue("d", 90),
        { type: "SET_TURN_ENTRY_PLAYER", entryId: "d", playerIndex: 2 },
      ),
    );
    expect(depth(steps)).toBe(depth(before) + 1);
    expect(observable(run(steps, undo))).toEqual(observable(before));
  });

  it("combining entries, including the acting one mid-turn, undoes as one", () => {
    const before = threeEntries();
    expect(active(before)).toBe("a");
    const after = run(
      before,
      ...inGroup(newUndoGroup(), {
        type: "COMBINE_TURN_ENTRIES",
        sourceIds: ["a", "c"],
        targetId: "t",
        playerIndex: 1,
        value: 70,
        at: 5,
        elapsedSeconds: 30,
      }),
    );
    expect(after.turns).toHaveLength(before.turns.length + 1);
    const undone = run(after, undo);
    expect(observable(undone)).toEqual(observable(before));
    expect(active(undone)).toBe("a");
  });

  it("the end-of-phase flow (exit answer, then the next phase) undoes as one", () => {
    // Every entry has played, so the table is asked what comes next.
    const over = run(threeEntries(), end("same"), end("same"), end("same"));
    expect(selectTurnPhases(over)?.pendingPrompt).toBe(true);
    const after = run(
      over,
      ...inGroup(newUndoGroup(), phase("select", { exitFirstEntryId: "c" })),
    );
    expect(after.activePhaseId).toBe("select");
    const undone = run(after, undo);
    expect(observable(undone)).toEqual(observable(over));
    expect(selectTurnPhases(undone)?.pendingPrompt).toBe(true);
    // The next undo goes back into the last turn, not further.
    expect(active(run(undone, undo))).toBe("c");
  });

  it("an end-of-phase flow opened mid-turn undoes the turn it closed too", () => {
    const before = run(threeEntries(), end("same"));
    const after = run(
      before,
      ...inGroup(newUndoGroup(), phase("open", { elapsedSeconds: 20, at: 9 })),
    );
    expect(after.turns).toHaveLength(before.turns.length + 1);
    expect(observable(run(after, undo))).toEqual(observable(before));
  });

  it("a value and owner change from the actions sheet undo as one", () => {
    const before = run(threeEntries(), end("down"));
    const after = run(
      before,
      ...inGroup(newUndoGroup(), setValue("c", 120), {
        type: "SET_TURN_ENTRY_PLAYER",
        entryId: "c",
        playerIndex: 0,
      }),
    );
    expect(order(after)?.[0]).toBe("c120");
    const undone = run(after, undo);
    expect(observable(undone)).toEqual(observable(before));
    expect(selectCurrentPlayerIndex(undone)).toBe(1);
    expect(view(undone)?.entries.find((e) => e.id === "c")?.value).toBe(70);
  });
});
