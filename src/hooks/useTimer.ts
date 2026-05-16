import { useMemo, useReducer } from "react";
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
    createInitialGameSessionState,
  );

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

  const setExpectedTurns = (n: number) =>
    dispatch({ type: "SET_EXPECTED_TURNS", expectedTurns: n });
  const setPlayers = (players: Player[] | undefined) =>
    dispatch({ type: "SET_PLAYERS", players });

  return {
    state,
    dispatch,
    getTimerString,
    getStopwatchString,
    size,
    pause,
    unpause,
    resetTimer,
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
  };
};
