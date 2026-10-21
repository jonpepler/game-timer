"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import { Heading } from "./Heading";
import { Sheet } from "./Sheet";
import styles from "./StepSheet.module.css";

export interface SheetStep {
  id: string;
  /** The one decision this step asks for, as a heading. */
  title: ReactNode;
  content: ReactNode;
  /** Whether the step's decision is made, so Next can go on. */
  ready: boolean;
}

export interface StepSheetProps {
  /** The whole flow's name, the same on every step. */
  title: ReactNode;
  steps: SheetStep[];
  /** The step shown; the caller owns it so a choice can move on itself. */
  index: number;
  onIndexChange: (index: number) => void;
  /** The last step's action in place of Next, such as the primary confirm. */
  finish: ReactNode;
  /** Cancel on the first step, and Escape on any. */
  onDismiss: () => void;
  width?: "md" | "wide";
}

/**
 * A Sheet that asks one decision per step: the flow's title, which step
 * of how many, the step's heading and its content, then Back (Cancel on
 * the first step) and Next (the `finish` action on the last).
 */
export function StepSheet({
  title,
  steps,
  index,
  onIndexChange,
  finish,
  onDismiss,
  width = "wide",
}: StepSheetProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const step = steps[index];
  const shown = useRef(index);
  // A new step takes focus at its heading, so the decision it asks is
  // read first and focus is never left on a button that has gone.
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    sectionRef.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [index]);
  const last = index === steps.length - 1;
  return (
    <Sheet
      title={title}
      subtitle={`Step ${index + 1} of ${steps.length}`}
      onDismiss={onDismiss}
      width={width}
      actions={
        <>
          {index === 0 ? (
            <Button onClick={onDismiss}>Cancel</Button>
          ) : (
            <Button onClick={() => onIndexChange(index - 1)}>Back</Button>
          )}
          {last ? (
            finish
          ) : (
            <Button
              variant="primary"
              disabled={!step.ready}
              onClick={() => onIndexChange(index + 1)}
            >
              Next
            </Button>
          )}
        </>
      }
    >
      <section
        ref={sectionRef}
        key={step.id}
        className={styles.step}
        aria-labelledby={headingId}
        data-step={step.id}
      >
        <Heading level={3} id={headingId} align="center" tabIndex={-1}>
          {step.title}
        </Heading>
        {step.content}
      </section>
    </Sheet>
  );
}
