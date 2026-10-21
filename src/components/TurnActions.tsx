import type { Control } from "@/state/gameDefinition";
import { Button } from "@/components/ui";
import styles from "./TurnActions.module.css";

interface TurnActionsProps {
  /** Every control the definition declares, in declared order. */
  controls: Control[];
  /** Ids of the controls that can be triggered right now. */
  availableIds: readonly string[];
  onTrigger: (controlId: string) => void;
  className?: string;
}

/**
 * The turn actions region: one button per declared control. A control
 * that isn't available keeps its slot (hidden, out of the accessibility
 * tree) so controls coming and going never move anything around them.
 * Clicks stop here so they never count as a turn advance.
 */
export function TurnActions({
  controls,
  availableIds,
  onTrigger,
  className,
}: TurnActionsProps) {
  if (controls.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard only, not an interactive element
    <section
      className={`${styles.region} ${className ?? ""}`}
      aria-label="Turn actions"
      onClick={(e) => e.stopPropagation()}
    >
      {controls.map((control) => {
        const available = availableIds.includes(control.id);
        return (
          <Button
            key={control.id}
            className={styles.action}
            data-available={available}
            aria-hidden={!available}
            tabIndex={available ? 0 : -1}
            disabled={!available}
            onClick={() => onTrigger(control.id)}
          >
            {control.label}
          </Button>
        );
      })}
    </section>
  );
}
