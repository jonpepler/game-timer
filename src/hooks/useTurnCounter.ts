import { useState } from "react";

export const useTurnCounter = (initalExpectedTurns: number) => {
  const [expectedTurns, setExpectedTurns] = useState(initalExpectedTurns)
  const [turns, setTurns] = useState(0);

  const nextTurn = () => setTurns((t) => t + 1);

  return {
    turns,
    remainingTurns: expectedTurns - turns,
    nextTurn,
    setExpectedTurns,
  };
};
