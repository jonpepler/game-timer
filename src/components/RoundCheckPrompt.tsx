"use client";

import { Button, Prompt } from "@/components/ui";
import type { RoundCheck } from "@/state/gameDefinition";

interface RoundCheckPromptProps {
  check: RoundCheck;
  onAnswer: (end: boolean) => void;
}

/**
 * The question a round track asks when a round ends, such as a die roll
 * that may end the game. The table must answer before play goes on.
 */
export function RoundCheckPrompt({ check, onAnswer }: RoundCheckPromptProps) {
  return (
    <Prompt
      title={check.title}
      centred
      actions={
        <>
          <Button variant="primary" fullWidth onClick={() => onAnswer(true)}>
            {check.endLabel}
          </Button>
          <Button fullWidth onClick={() => onAnswer(false)}>
            {check.continueLabel}
          </Button>
        </>
      }
    >
      <p>{check.body}</p>
    </Prompt>
  );
}
