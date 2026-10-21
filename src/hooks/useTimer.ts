import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { selectPrediction } from "@/state/prediction";
import {
  type StopwatchResult,
  type TimerResult,
  useStopwatch,
  useTimer as useInternalTimer,
} from "react-timer-hook";
import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { useSounds } from "./useSounds";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  projectAverageAfterTurn,
  selectAvailableControls,
  selectCurrentPlayerIndex,
  selectNeedsValueStep,
  selectTurnElapsedSecondsList,
  selectTurnOrder,
  selectTurnPhases,
  selectUntimedTurnLabel,
  type GameSessionAction,
  type GameSessionState,
  type Player,
  type TurnEntryInput,
  type TurnRecord,
} from "@/state/gameSession";
import type { Control, ScoreConfig, TurnOrder } from "@/state/gameDefinition";
import { loadSession, saveSession } from "@/state/sessionPersistence";

type UseTimerProps = {
  initialTime: number;
  initialExpectedTurns: number;
  height: number;
  width: number;
};

export type { Player, TurnRecord, GameSessionState };

export const useTimer = ({
  initialTime,
  initialExpectedTurns,
  height,
  width,
}: UseTimerProps) => {
  const [state, dispatchToReducer] = useReducer(
    gameSessionReducer,
    {
      initialAverageSeconds: initialTime,
      expectedTurns: initialExpectedTurns,
      players: undefined,
    },
    (params) => loadSession() ?? createInitialGameSessionState(params),
  );

  const {
    playNext,
    playOvertime,
    unlockAudio,
    followCountdown,
    pauseLoop,
    stopLoop,
  } = useSounds(state.definitionId);

  // The undo group that actions dispatched right now belong to, set by
  // inUndoGroup for the length of one synchronous call.
  const undoGroupRef = useRef<string | null>(null);
  const dispatch = useCallback((action: GameSessionAction) => {
    const undoGroup = undoGroupRef.current;
    dispatchToReducer(undoGroup !== null ? { ...action, undoGroup } : action);
  }, []);
  /**
   * Run `fn` with every action it dispatches tagged with `undoGroup`, so
   * a flow that dispatches across several calls (each wrapped with the
   * same id) undoes as one event.
   */
  const inUndoGroup = useCallback((undoGroup: string, fn: () => void) => {
    const outer = undoGroupRef.current;
    undoGroupRef.current = undoGroup;
    try {
      fn();
    } finally {
      undoGroupRef.current = outer;
    }
  }, []);
  // Overtime the restored turn had already run when an undo lands it past
  // its countdown; the stopwatch picks it up when the countdown expires.
  const overtimeOnExpireRef = useRef<number | null>(null);

  // Persist on every reducer change. Reducer state only changes on user
  // actions (tap, undo, score) — not on the per-second timer ticks — so
  // write frequency tracks user activity, not the clock.
  useEffect(() => {
    saveSession(state);
  }, [state]);

  const stopwatch = useStopwatch({ autoStart: false });
  const timer = useInternalTimer({
    autoStart: false,
    expiryTimestamp: new Date(),
    onExpire: () => {
      const overtime = overtimeOnExpireRef.current;
      overtimeOnExpireRef.current = null;
      if (overtime !== null) {
        stopwatch.reset(new Date(Date.now() - overtime * 1000));
        followCountdown(-overtime);
        return;
      }
      stopwatch.reset();
      followCountdown(0);
      playOvertime();
    },
  });

  const untimedLabel = selectUntimedTurnLabel(state);
  const untimed = untimedLabel !== null;
  /**
   * An untimed turn holds the clock still: whichever action landed in it
   * (a tap, an undo, a phase switch) restarted the countdown, so it is
   * stopped here, along with any overtime. The reducer records the turn
   * as zero seconds regardless of what the clock says.
   */
  useEffect(() => {
    if (!untimed) return;
    if (timer.isRunning) timer.pause();
    if (stopwatch.isRunning) stopwatch.reset(undefined, false);
    stopLoop();
  }, [untimed, timer, stopwatch, stopLoop]);

  const timerFinished = timer.totalSeconds === 0 && state.started && !untimed;
  // An untimed turn is not a user pause, so it never reads as paused.
  const prediction = selectPrediction(state);
  const paused = useMemo(
    () => !untimed && !timer.isRunning && !stopwatch.isRunning,
    [untimed, timer, stopwatch],
  );

  const startTimer = () => {
    unlockAudio();
    timer.restart(getDateSecondsFromNow(state.averageSeconds));
    followCountdown(state.averageSeconds);
    dispatch({ type: "START", at: Date.now() });
  };

  // Time the running turn has taken so far, as the reducer records it.
  const elapsedSoFar = () =>
    state.averageSeconds -
    timer.totalSeconds +
    (timerFinished ? stopwatch.totalSeconds : 0);

  // `valueStepId` answers the running phase's value question for the
  // entry whose turn is ending.
  const resetTimer = (options: { valueStepId?: string } = {}) => {
    if (!state.started) {
      startTimer();
      return;
    }
    const elapsedSeconds = elapsedSoFar();
    // Compute the next countdown length synchronously — React hasn't
    // committed the reducer update yet, but timer.restart needs a value now.
    const nextAverage = projectAverageAfterTurn(state, elapsedSeconds);
    dispatch({
      type: "NEXT_TURN",
      elapsedSeconds,
      at: Date.now(),
      ...(options.valueStepId !== undefined
        ? { valueStepId: options.valueStepId }
        : {}),
    });
    unlockAudio();
    stopLoop();
    timer.restart(getDateSecondsFromNow(nextAverage));
    followCountdown(nextAverage);
    playNext();
  };

  /**
   * Dispatch an action that may close the running turn early (a phase
   * switch, or combining the acting entry). The reducer decides whether
   * a turn is recorded; if one is, or the phase changed, the countdown
   * restarts for whoever acts next.
   */
  const dispatchClosingTurn = (action: GameSessionAction) => {
    const next = gameSessionReducer(state, action);
    if (next === state) return;
    dispatch(action);
    if (
      state.started &&
      (next.turns.length !== state.turns.length ||
        next.activePhaseId !== state.activePhaseId)
    ) {
      timer.restart(getDateSecondsFromNow(next.averageSeconds), !paused);
      stopwatch.reset(undefined, false);
      stopLoop();
      if (!paused) followCountdown(next.averageSeconds);
    }
  };

  const undo = () => {
    // Project the reducer's UNDO synchronously so the imperative timer
    // restarts with the right (possibly per-phase) average. Undoing an
    // action that recorded no turn leaves the clock alone.
    const next = gameSessionReducer(state, { type: "UNDO" });
    if (next === state) return;
    dispatch({ type: "UNDO" });
    if (
      next.turns.length === state.turns.length &&
      next.activePhaseId === state.activePhaseId
    )
      return;
    stopwatch.reset(undefined, false);
    stopLoop();
    overtimeOnExpireRef.current = null;
    /**
     * The turn the undo lands back in carries on from the time it had
     * when it was ended (the first turn the undo dropped), rather than
     * starting a fresh countdown. Overtime resumes once the countdown,
     * already at zero, expires.
     */
    const resumed = state.turns[next.turns.length];
    const elapsed =
      next.turns.length < state.turns.length && resumed
        ? resumed.elapsedSeconds
        : 0;
    const remaining = Math.max(next.averageSeconds - elapsed, 0);
    if (elapsed > next.averageSeconds)
      overtimeOnExpireRef.current = elapsed - next.averageSeconds;
    timer.restart(getDateSecondsFromNow(remaining), !paused);
    // At zero the countdown expires at once and picks up the overtime.
    if (!paused && remaining > 0) followCountdown(remaining);
  };

  const getTimeString = (t: TimerResult | StopwatchResult) =>
    `${t.hours ? `${t.hours}:` : ""}${t.minutes.toString().padStart(2, "0")}:${t.seconds.toString().padStart(2, "0")}`;

  const getTimerString = () => getTimeString(timer);
  const getStopwatchString = () => getTimeString(stopwatch);

  // 55% of the smaller window dimension, capped at 520px. Smaller
  // than 2/3 was — leaves more vertical room below for the score
  // panel + time-share + footer without crowding the timer.
  const size = Math.min(Math.min(height, width) * 0.55, 520);

  const pause = () => {
    timer.pause();
    stopwatch.pause();
    pauseLoop();
  };
  const unpause = () => {
    if (!timerFinished) timer.resume();
    stopwatch.start();
    unlockAudio();
    followCountdown(
      timerFinished ? -stopwatch.totalSeconds : timer.totalSeconds,
    );
  };

  const reset = () => {
    dispatch({ type: "RESET" });
    // Park the imperative timer at zero so the next tap can call
    // startTimer cleanly with the new (post-RESET) average.
    timer.restart(new Date(), false);
    stopwatch.reset(undefined, false);
    stopLoop();
  };

  const setExpectedTurns = (n: number) =>
    dispatch({ type: "SET_EXPECTED_TURNS", expectedTurns: n });
  const setStartingAverage = (seconds: number) =>
    dispatch({ type: "SET_STARTING_AVERAGE", seconds });
  const setPlayers = (players: Player[] | undefined) =>
    dispatch({ type: "SET_PLAYERS", players });
  const setPlayer = (playerIndex: number, player: Player) =>
    dispatch({ type: "SET_PLAYER", playerIndex, player });
  const setScoreConfig = (scoreConfig: ScoreConfig | undefined) =>
    dispatch({ type: "SET_SCORE_CONFIG", scoreConfig });
  const setDefinitionId = (definitionId: string | undefined) =>
    dispatch({ type: "SET_DEFINITION_ID", definitionId });
  const setScore = (playerIndex: number, value: number) =>
    dispatch({ type: "SET_SCORE", playerIndex, value });
  const incrementScore = (playerIndex: number, delta: number) =>
    dispatch({ type: "INCREMENT_SCORE", playerIndex, delta });
  const endGame = (victor: number | null) =>
    dispatch({ type: "END_GAME", victor });
  const dismissMilestone = () => dispatch({ type: "DISMISS_MILESTONE" });
  const setTurnOrder = (turnOrder: TurnOrder | undefined) =>
    dispatch({ type: "SET_TURN_ORDER", turnOrder });
  const setControls = (controls: Control[] | undefined) =>
    dispatch({ type: "SET_CONTROLS", controls });
  const triggerControl = (controlId: string) =>
    dispatch({ type: "TRIGGER_CONTROL", controlId });
  const reorderTurnEntry = (entryId: string, toIndex: number) =>
    dispatch({ type: "REORDER_TURN_ENTRY", entryId, toIndex });
  const activateTurnEntry = (
    entry: TurnEntryInput,
    options: { listId?: string; toIndex?: number } = {},
  ) => dispatch({ type: "ACTIVATE_TURN_ENTRY", entry, ...options });
  const deactivateTurnEntry = (entryId: string) =>
    dispatch({ type: "DEACTIVATE_TURN_ENTRY", entryId });
  const setTurnEntryPlayer = (entryId: string, playerIndex: number | null) =>
    dispatch({ type: "SET_TURN_ENTRY_PLAYER", entryId, playerIndex });
  /**
   * Switch phase. An entry that is mid-turn has its time so far recorded;
   * `exitFirstEntryId` answers the outgoing phase's exit question.
   */
  const setPhase = (
    phaseId: string,
    options: { firstEntryId?: string; exitFirstEntryId?: string } = {},
  ) =>
    dispatchClosingTurn({
      type: "SET_PHASE",
      phaseId,
      at: Date.now(),
      ...(state.started ? { elapsedSeconds: elapsedSoFar() } : {}),
      ...options,
    });
  const setEntryValue = (entryId: string, value: number) =>
    dispatch({ type: "SET_ENTRY_VALUE", entryId, value });
  const combineEntries = (combine: {
    sourceIds: string[];
    targetId: string;
    playerIndex: number | null;
    value?: number;
  }) =>
    dispatchClosingTurn({
      type: "COMBINE_TURN_ENTRIES",
      ...combine,
      at: Date.now(),
      ...(state.started ? { elapsedSeconds: elapsedSoFar() } : {}),
    });
  const dismissPhasePrompt = () => dispatch({ type: "DISMISS_PHASE_PROMPT" });
  const setLead = (seatIndex: number) =>
    dispatch({ type: "SET_LEAD", seatIndex });

  return {
    state,
    dispatch,
    getTimerString,
    getStopwatchString,
    size,
    pause,
    unpause,
    resetTimer,
    undo,
    inUndoGroup,
    canUndo: state.turns.length > 0 || (state.undoStack?.length ?? 0) > 0,
    paused,
    timerTotalSeconds: timer.totalSeconds,
    stopwatchTotalSeconds: stopwatch.totalSeconds,
    averageTime: state.averageSeconds,
    timerFinished,
    untimedLabel,
    times: selectTurnElapsedSecondsList(state),
    remainingTurns: prediction.turns,
    remainingSeconds: prediction.seconds,
    turnsModelled: prediction.modelled,
    remainingCount: prediction.remaining,
    currentPlayerIndex: selectCurrentPlayerIndex(state),
    setExpectedTurns,
    setStartingAverage,
    setPlayers,
    setPlayer,
    setScoreConfig,
    setDefinitionId,
    setScore,
    incrementScore,
    endGame,
    dismissMilestone,
    pendingMilestones: state.pendingMilestones,
    reset,
    scores: state.scores,
    scoreConfig: state.scoreConfig,
    victor: state.victor,
    definitionId: state.definitionId,
    setTurnOrder,
    setControls,
    triggerControl,
    setLead,
    turnOrder: state.turnOrder,
    leadIndex: state.leadIndex ?? 0,
    pendingLeadPrompt: state.pendingLeadPrompt ?? false,
    availableControls: selectAvailableControls(state),
    turnOrderView: selectTurnOrder(state),
    turnPhases: selectTurnPhases(state),
    reorderTurnEntry,
    activateTurnEntry,
    deactivateTurnEntry,
    setTurnEntryPlayer,
    setEntryValue,
    combineEntries,
    setPhase,
    dismissPhasePrompt,
    needsValueStep: selectNeedsValueStep(state),
  };
};
