"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AddEntryDetailsSheet } from "@/components/AddEntryDetailsSheet";
import { CombineEntriesSheet } from "@/components/CombineEntriesSheet";
import { EntryActionsSheet } from "@/components/EntryActionsSheet";
import { LeadPrompt } from "@/components/LeadPrompt";
import { PhasePrompt } from "@/components/PhasePrompt";
import type { TurnOrderPanelData } from "@/components/TurnOrderPanel";
import { entryToRow } from "@/components/TurnOrderList";
import {
  type ValueSeries,
  ValueHistoryChart,
} from "@/components/ValueHistoryChart";
import {
  type ValueStepChoice,
  ValueStepPrompt,
} from "@/components/ValueStepPrompt";
import { combinesFromHistory } from "@/state/combineHistory";
import type { EntryValues } from "@/state/gameDefinition";
import {
  floorToTrack,
  type GameSessionState,
  newUndoGroup,
  selectAvailableTurnEntries,
  selectNeedsValueStep,
  selectTurnOrder,
  selectTurnPhases,
  stepAlongTrack,
  type TurnEntry,
} from "@/state/gameSession";
import { currentPhaseRef, type SessionCommand } from "@/state/sessionCommands";

export interface PlayerView {
  name: string;
  color: string;
  headIconSrc?: string;
  iconSrc?: string;
}

interface Options {
  state: GameSessionState;
  players: PlayerView[];
  /**
   * Carries out a command: the host runs it, a companion sends it to the
   * host. Either way the host checks it against the same policy.
   */
  run: (command: SessionCommand) => void;
  // No prompts while the game is over.
  disabled: boolean;
  // Turns the whole game is expected to run, for the value chart's x axis.
  domainTurns?: number;
}

/**
 * The value-step choices for an entry, each with the value it would end
 * on (absent when the step takes the entry out of play).
 */
export const valueStepChoices = (
  values: EntryValues,
  current: number | undefined,
): ValueStepChoice[] =>
  values.steps.map((step) => {
    if (step.effect === "remove") return { ...step };
    const result = stepAlongTrack(
      values.track,
      current ?? values.track[0],
      step.spaces,
    );
    return { ...step, result };
  });

/**
 * Series for the value chart: every entry that has had a value, live
 * while it is in some list. Live entries come in their lists' order (so
 * entries on one value are in turn order), then the rest in the order
 * they first got a value. A combined source records where it went.
 */
export const valueSeries = (state: GameSessionState): ValueSeries[] => {
  const entries = state.turnEntries ?? [];
  const inPlay = new Set((state.turnLists ?? []).flatMap((l) => l.order));
  const merges = combinesFromHistory(entries, state.valueHistory ?? []);
  const byEntry = new Map<string, ValueSeries>();
  for (const point of state.valueHistory ?? []) {
    let series = byEntry.get(point.entryId);
    if (!series) {
      const entry = entries.find((e) => e.id === point.entryId);
      const mergesInto = merges.get(point.entryId);
      series = {
        id: point.entryId,
        name: entry?.label ?? point.entryId,
        color: entry?.color ?? "var(--color-player-fallback)",
        ...(entry?.nameParts ? { nameParts: entry.nameParts } : {}),
        ...(entry?.identity?.symbol ? { symbol: entry.identity.symbol } : {}),
        ...(mergesInto ? { mergesInto } : {}),
        points: [],
        live: inPlay.has(point.entryId),
      };
      byEntry.set(point.entryId, series);
    }
    series.points.push({ turn: point.turn, value: point.value });
  }
  const position = new Map(
    (state.turnLists ?? []).flatMap((l) => l.order).map((id, i) => [id, i]),
  );
  const rank = (s: ValueSeries) =>
    position.get(s.id) ?? Number.MAX_SAFE_INTEGER;
  return Array.from(byEntry.values()).sort((a, b) => rank(a) - rank(b));
};

// Each open sheet is one flow, and everything it dispatches shares its
// `undoGroup`, so one undo takes the whole flow back.
type Sheet = (
  | { kind: "add"; entryId: string }
  | { kind: "actions"; entryId: string }
  | { kind: "combine"; sourceIds: string[] }
  // Opened for one entry's turn; stale once that turn is over.
  | { kind: "value-step"; entryId: string; atTurn: number }
) & { undoGroup: string };

const inSomeList = (state: GameSessionState, entryId: string) =>
  (state.turnLists ?? []).some((l) => l.order.includes(entryId));

/**
 * Whether an open sheet still fits the state. Another screen may have
 * acted first (added the entry, removed it, ended the turn); the host's
 * state is the truth, so a sheet it has overtaken closes.
 */
const sheetStillFits = (sheet: Sheet, state: GameSessionState): boolean => {
  switch (sheet.kind) {
    case "add":
      return !inSomeList(state, sheet.entryId);
    case "actions":
      return inSomeList(state, sheet.entryId);
    case "combine":
      return sheet.sourceIds.every((id) => inSomeList(state, id));
    case "value-step":
      return (
        state.turns.length === sheet.atTurn &&
        selectTurnOrder(state)?.activeId === sheet.entryId
      );
  }
};

/**
 * The turn-entry interactions layered over the timer: the value question
 * at the end of a turn, adding entries with their value and owner, the
 * per-entry actions sheet, combining entries, the value chart, and the
 * end-of-phase flow (exit question, then which phase comes next). The
 * page wires `advance` to its tap target and renders `overlays`.
 */
export function useTurnEntryControls({
  state,
  players,
  run,
  disabled,
  domainTurns,
}: Options) {
  const [openSheet, setSheet] = useState<Sheet | null>(null);
  // The end-of-phase flow's undo group while it is open.
  const [phaseFlowGroup, setPhaseFlowGroup] = useState<string | null>(null);
  const phaseFlowOpen = phaseFlowGroup !== null;
  const openPhaseFlow = () => setPhaseFlowGroup(newUndoGroup());
  // The exit question's answer; undefined until asked.
  const [exitAnswer, setExitAnswer] = useState<string | null | undefined>();

  const sheet =
    openSheet && sheetStillFits(openSheet, state) ? openSheet : null;
  useEffect(() => {
    if (openSheet && !sheet) setSheet(null);
  }, [openSheet, sheet]);

  // A phase change made anywhere ends any end-of-phase flow in progress
  // here, so a second screen never answers a prompt already answered.
  const phase = currentPhaseRef(state);
  const phaseKey = phase ? `${phase.phaseId}:${phase.run}` : "";
  const shownPhaseKey = useRef(phaseKey);
  useEffect(() => {
    if (shownPhaseKey.current === phaseKey) return;
    shownPhaseKey.current = phaseKey;
    setPhaseFlowGroup(null);
    setExitAnswer(undefined);
  }, [phaseKey]);

  const turnOrder = state.turnOrder;
  const values = turnOrder?.entryValues;
  const kinds = turnOrder?.entryKinds ?? [];
  const kindLabels = Object.fromEntries(kinds.map((k) => [k.id, k.label]));
  const ownerless = (entry: TurnEntry | undefined) =>
    kinds.some((k) => k.id === entry?.kind && k.ownerless);
  const phases = selectTurnPhases(state);
  const running = selectTurnOrder(state);
  const currentPhase = phases?.phases.find((p) => p.id === phases.activeId);
  const findEntry = (id: string) => state.turnEntries?.find((e) => e.id === id);
  const listViewOf = (entryId: string) =>
    (state.turnLists ?? [])
      .map((l) => selectTurnOrder(state, l.id))
      .find(
        (v) =>
          v?.entries.some((e) => e.id === entryId) ||
          selectAvailableTurnEntries(state, v?.listId).some(
            (e) => e.id === entryId,
          ),
      ) ?? null;

  const needsValueStep = selectNeedsValueStep(state);
  const phaseOver =
    (running?.valueOrdered ?? false) && running?.activeId === null;

  const advance = () => {
    if (disabled || sheet !== null) return;
    if (state.started && phaseOver) {
      openPhaseFlow();
      return;
    }
    if (needsValueStep && running?.activeId) {
      setSheet({
        kind: "value-step",
        entryId: running.activeId,
        atTurn: state.turns.length,
        undoGroup: newUndoGroup(),
      });
      return;
    }
    run({ type: "END_TURN", atTurn: state.turns.length });
  };

  const closeFlow = () => {
    setPhaseFlowGroup(null);
    setExitAnswer(undefined);
  };

  const dismissPrompt = () =>
    run({ type: "DISMISS_PHASE_PROMPT", ...(phase ? { from: phase } : {}) });

  /**
   * Whether adding an entry asks for its value: only in a value-ordered
   * list, and not for a kind that joins at the top of a list that
   * already has values.
   */
  const asksValue = (
    view: ReturnType<typeof listViewOf>,
    entry: TurnEntry | undefined,
  ) =>
    (view?.valueOrdered ?? false) &&
    values !== undefined &&
    !(
      kinds.some((k) => k.id === entry?.kind && k.joinsAtTop) &&
      view?.entries.some((e) => e.value !== undefined)
    );

  const addEntry = (entryId: string) => {
    const view = listViewOf(entryId);
    const entry = findEntry(entryId);
    const needsOwner = (view?.ownerRequired ?? false) && !ownerless(entry);
    if (asksValue(view, entry) || needsOwner) {
      setSheet({ kind: "add", entryId, undoGroup: newUndoGroup() });
      return;
    }
    run({ type: "ACTIVATE_ENTRY", entryId });
  };

  const chart = useMemo(() => {
    if (!values) return null;
    const series = valueSeries(state);
    if (series.length === 0) return null;
    return (
      <ValueHistoryChart
        label={values.label}
        series={series}
        currentTurn={state.turns.length}
        // Tokens name the lines when every entry has one.
        variant={series.every((s) => s.symbol) ? "compact" : "labelled"}
        domainTurns={domainTurns}
      />
    );
  }, [state, values, domainTurns]);

  const rowFor = (entry: TurnEntry) => entryToRow(entry, players, kindLabels);

  let overlay: ReactNode = null;
  if (sheet?.kind === "value-step" && values && running?.activeId) {
    const entry = findEntry(running.activeId);
    if (entry) {
      const row = rowFor(entry);
      overlay = (
        <ValueStepPrompt
          entryName={row.name}
          entryParts={row.nameParts}
          entryColor={row.color}
          entrySymbol={row.symbol}
          ownerName={row.detail}
          valueLabel={values.label}
          stepsLabel={values.stepsLabel}
          value={entry.value}
          steps={valueStepChoices(values, entry.value)}
          onChoose={(valueStepId) => {
            setSheet(null);
            run({
              type: "END_TURN",
              valueStepId,
              atTurn: sheet.atTurn,
              undoGroup: sheet.undoGroup,
            });
          }}
          onCancel={() => setSheet(null)}
        />
      );
    }
  } else if (sheet?.kind === "add") {
    const entry = findEntry(sheet.entryId);
    const view = listViewOf(sheet.entryId);
    if (entry) {
      const row = rowFor(entry);
      const needsOwner = (view?.ownerRequired ?? false) && !ownerless(entry);
      overlay = (
        <AddEntryDetailsSheet
          name={row.name}
          color={row.color}
          symbol={row.symbol}
          value={
            values && asksValue(view, entry)
              ? {
                  label: values.label,
                  options: values.startValues ?? values.track,
                }
              : undefined
          }
          owners={needsOwner ? players : undefined}
          onConfirm={(details) => {
            setSheet(null);
            run({
              type: "ACTIVATE_ENTRY",
              entryId: entry.id,
              ...details,
              undoGroup: sheet.undoGroup,
            });
          }}
          onCancel={() => setSheet(null)}
        />
      );
    }
  } else if (sheet?.kind === "actions") {
    const { undoGroup } = sheet;
    const entry = findEntry(sheet.entryId);
    const view = listViewOf(sheet.entryId);
    const combine = turnOrder?.combine;
    if (entry) {
      const row = rowFor(entry);
      overlay = (
        <EntryActionsSheet
          name={row.name}
          nameParts={row.nameParts}
          color={row.color}
          symbol={row.symbol}
          ownerIndex={entry.playerIndex}
          players={players}
          onSetOwner={
            ownerless(entry)
              ? undefined
              : (i) =>
                  run({
                    type: "SET_ENTRY_OWNER",
                    entryId: entry.id,
                    playerIndex: i,
                    undoGroup,
                  })
          }
          value={
            view?.valueOrdered && values
              ? {
                  label: values.label,
                  current: entry.value,
                  track: values.track,
                  onSet: (v) =>
                    run({
                      type: "SET_ENTRY_VALUE",
                      entryId: entry.id,
                      value: v,
                      undoGroup,
                    }),
                }
              : undefined
          }
          combine={
            combine && entry.kind === combine.sourceKind
              ? {
                  label: combine.label,
                  onStart: () =>
                    setTimeout(() =>
                      setSheet({
                        kind: "combine",
                        sourceIds: [entry.id],
                        undoGroup,
                      }),
                    ),
                }
              : undefined
          }
          onRemove={() =>
            run({ type: "DEACTIVATE_ENTRY", entryId: entry.id, undoGroup })
          }
          onClose={() => setSheet((s) => (s?.kind === "actions" ? null : s))}
        />
      );
    }
  } else if (sheet?.kind === "combine" && turnOrder?.combine) {
    const combine = turnOrder.combine;
    const view = listViewOf(sheet.sourceIds[0]);
    if (view) {
      const toCandidate = (e: TurnEntry) => {
        const row = rowFor(e);
        return {
          id: e.id,
          name: row.name,
          color: row.color,
          ...(row.symbol ? { symbol: row.symbol } : {}),
          ...(e.value !== undefined ? { value: e.value } : {}),
        };
      };
      overlay = (
        <CombineEntriesSheet
          label={combine.label}
          count={combine.count}
          sources={view.entries
            .filter((e) => e.kind === combine.sourceKind)
            .map(toCandidate)}
          extraSources={
            combine.extraSources && {
              label: combine.extraSources.label,
              candidates: combine.extraSources.entries.map((e) => ({
                id: e.id,
                name: e.label,
                color: e.color ?? "var(--color-border-strong)",
                ...(e.identity?.symbol ? { symbol: e.identity.symbol } : {}),
              })),
            }
          }
          targets={selectAvailableTurnEntries(state, view.listId)
            .filter((e) => e.kind === combine.targetKind)
            .map(toCandidate)}
          players={players}
          value={
            values && view.valueOrdered
              ? {
                  label: values.label,
                  track: values.track,
                  defaultFor: (ids) => {
                    // Stand-ins carry no value; the real sources set it.
                    const real = ids.filter((id) => findEntry(id));
                    const vs = real
                      .map((id) => findEntry(id)?.value)
                      .filter((v): v is number => v !== undefined);
                    if (vs.length === 0 || vs.length !== real.length)
                      return undefined;
                    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
                    return floorToTrack(values.track, Math.floor(mean));
                  },
                }
              : undefined
          }
          headings={combine.steps}
          initialSourceIds={sheet.sourceIds}
          onConfirm={(result) => {
            setSheet(null);
            run({
              type: "COMBINE_ENTRIES",
              ...result,
              undoGroup: sheet.undoGroup,
            });
          }}
          onCancel={() => setSheet(null)}
        />
      );
    }
  }

  // The end-of-phase flow: the phase's exit question first, if it has
  // one, then which phase comes next.
  const flowOpen =
    !disabled &&
    phases !== null &&
    phases.phases.length > 1 &&
    (phaseFlowOpen || phases.pendingPrompt);
  const exitEntries = (() => {
    const list = currentPhase
      ? selectTurnOrder(
          state,
          phases?.phases.find((p) => p.id === currentPhase.id)?.list,
        )
      : null;
    return (list?.entries ?? []).map((e) => {
      const row = rowFor(e);
      return { id: e.id, name: row.name, color: row.color };
    });
  })();
  let phaseOverlay: ReactNode = null;
  // A flow the reducer opened (every entry has played) gets its group on
  // the first answer.
  const flowGroup = phaseFlowGroup ?? newUndoGroup();
  if (flowOpen && phases && currentPhase) {
    if (
      currentPhase.exitPrompt &&
      exitAnswer === undefined &&
      exitEntries.length > 1
    ) {
      phaseOverlay = (
        <LeadPrompt
          label={currentPhase.exitPrompt}
          players={exitEntries}
          onPick={(i) => {
            setPhaseFlowGroup(flowGroup);
            setExitAnswer(exitEntries[i].id);
          }}
          onBack={() => {
            closeFlow();
            if (phases.pendingPrompt) dismissPrompt();
          }}
          backLabel="Cancel"
        />
      );
    } else {
      const entriesFor = (phaseId: string) => {
        const listId = phases.phases.find((p) => p.id === phaseId)?.list;
        return (selectTurnOrder(state, listId)?.entries ?? []).map((e) => {
          const row = rowFor(e);
          return { id: e.id, name: row.name, color: row.color };
        });
      };
      phaseOverlay = (
        <PhasePrompt
          title={
            phases.pendingPrompt
              ? `${currentPhase.label} complete`
              : `End ${currentPhase.label}?`
          }
          phases={phases.phases}
          currentId={phases.activeId}
          defaultNextId={phases.defaultNextId}
          entriesFor={entriesFor}
          onStart={(phaseId, firstEntryId) => {
            const exitFirstEntryId = exitAnswer ?? undefined;
            closeFlow();
            run({
              type: "SET_PHASE",
              phaseId,
              ...(phase ? { from: phase } : {}),
              ...(firstEntryId !== undefined ? { firstEntryId } : {}),
              ...(exitFirstEntryId !== undefined ? { exitFirstEntryId } : {}),
              undoGroup: flowGroup,
            });
          }}
          onDismiss={() => {
            closeFlow();
            if (phases.pendingPrompt) dismissPrompt();
          }}
          dismissLabel={
            phases.pendingPrompt
              ? "Not yet"
              : `Keep playing ${currentPhase.label}`
          }
        />
      );
    }
  }

  const openActions = (entryId: string) =>
    setSheet({ kind: "actions", entryId, undoGroup: newUndoGroup() });

  // The turn order panel's data and actions, the same on every screen.
  const turnOrderPanel: TurnOrderPanelData | undefined = running
    ? {
        view: running,
        onMove: (entryId, toIndex) =>
          run({ type: "REORDER_ENTRY", entryId, toIndex }),
        onRemove: (entryId) => run({ type: "DEACTIVATE_ENTRY", entryId }),
        onAdd: addEntry,
        onRowActions: openActions,
        chart: chart ?? undefined,
        available: selectAvailableTurnEntries(state),
        lists: (state.turnLists ?? []).flatMap((l) => {
          const view = selectTurnOrder(state, l.id);
          return view
            ? [{ view, available: selectAvailableTurnEntries(state, l.id) }]
            : [];
        }),
      }
    : undefined;

  return {
    advance,
    endPhase: openPhaseFlow,
    addEntry,
    openActions,
    turnOrderPanel,
    chart,
    overlays: (
      <>
        {overlay}
        {phaseOverlay}
      </>
    ),
    dialogOpen: sheet !== null || flowOpen,
  };
}
