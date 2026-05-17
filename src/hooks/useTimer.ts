import { useEffect, useMemo, useReducer } from "react";
import {
  StopwatchResult,
  TimerResult,
  useStopwatch,
  useTimer as useInternalTimer,
} from "react-timer-hook";
import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { useSounds } from "./useSounds";
import {
  createInitialGameSessionState,
  gameSessionReducer,
  projectAverageAfterTurn,
  selectCurrentPlayerIndex,
  selectRemainingTurns,
  selectTurnElapsedSecondsList,
  type GameSessionState,
  type Player,
  type TurnRecord,
} from "@/state/gameSession";
import type { ScoreConfig } from "@/state/gameDefinition";
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
  const { playNext, playOvertime } = useSounds();

  const [state, dispatch] = useReducer(
    gameSessionReducer,
    {
      initialAverageSeconds: initialTime,
      expectedTurns: initialExpectedTurns,
      players: undefined,
    },
    (params) => loadSession() ?? createInitialGameSessionState(params),
  );

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
      stopwatch.reset();
      if (playOvertime) playOvertime();
    },
  });

  const timerFinished = timer.totalSeconds === 0 && state.started;
  const paused = useMemo(
    () => !timer.isRunning && !stopwatch.isRunning,
    [timer, stopwatch],
  );

  const startTimer = () => {
    timer.restart(getDateSecondsFromNow(state.averageSeconds));
    dispatch({ type: "START", at: Date.now() });
  };

  const resetTimer = () => {
    if (!state.started) {
      startTimer();
      return;
    }
    const elapsedSeconds =
      state.averageSeconds -
      timer.totalSeconds +
      (timerFinished ? stopwatch.totalSeconds : 0);
    // Compute the next countdown length synchronously — React hasn't
    // committed the reducer update yet, but timer.restart needs a value now.
    const nextAverage = projectAverageAfterTurn(state, elapsedSeconds);
    dispatch({ type: "NEXT_TURN", elapsedSeconds, at: Date.now() });
    timer.restart(getDateSecondsFromNow(nextAverage));
    if (playNext) playNext();
  };

  const undo = () => {
    if (state.turns.length === 0) return;
    // Mirror the reducer's UNDO average calculation so the imperative
    // timer can be restarted synchronously with the correct value.
    const remaining = state.turns.slice(0, -1);
    const nextAverage =
      remaining.length === 0
        ? state.initialAverageSeconds
        : Math.floor(
            remaining.reduce((s, t) => s + t.elapsedSeconds, 0) /
              remaining.length,
          );
    dispatch({ type: "UNDO" });
    timer.restart(getDateSecondsFromNow(nextAverage));
    // Clear any in-progress overtime tracking — the new (restored) turn
    // is starting fresh, not continuing past expiry.
    stopwatch.reset(undefined, false);
  };

  const getTimeString = (t: TimerResult | StopwatchResult) =>
    `${t.hours ? t.hours + ":" : ""}${t.minutes.toString().padStart(2, "0")}:${t.seconds.toString().padStart(2, "0")}`;

  const getTimerString = () => getTimeString(timer);
  const getStopwatchString = () => getTimeString(stopwatch);

  const size = (Math.min(...[height, width]) / 3) * 2;

  const pause = () => {
    timer.pause();
    stopwatch.pause();
  };
  const unpause = () => {
    if (!timerFinished) timer.resume();
    stopwatch.start();
  };

  const reset = () => {
    dispatch({ type: "RESET" });
    // Park the imperative timer at zero so the next tap can call
    // startTimer cleanly with the new (post-RESET) average.
    timer.restart(new Date(), false);
    stopwatch.reset(undefined, false);
  };

  const setExpectedTurns = (n: number) =>
    dispatch({ type: "SET_EXPECTED_TURNS", expectedTurns: n });
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
    canUndo: state.turns.length > 0,
    paused,
    timerTotalSeconds: timer.totalSeconds,
    stopwatchTotalSeconds: stopwatch.totalSeconds,
    averageTime: state.averageSeconds,
    timerFinished,
    times: selectTurnElapsedSecondsList(state),
    remainingTurns: selectRemainingTurns(state),
    currentPlayerIndex: selectCurrentPlayerIndex(state),
    setExpectedTurns,
    setPlayers,
    setPlayer,
    setScoreConfig,
    setDefinitionId,
    setScore,
    incrementScore,
    endGame,
    reset,
    scores: state.scores,
    scoreConfig: state.scoreConfig,
    victor: state.victor,
    definitionId: state.definitionId,
  };
};
