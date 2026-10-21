import { Button } from "@/components/ui";
import styles from "./PhaseBar.module.css";

interface PhaseBarProps {
  phaseLabel: string;
  // Absent = read-only indicator.
  onEnd?: () => void;
}

/**
 * The running phase and an "end it" control, shown for the whole game
 * so its appearance never moves the ring. Self-contained so a layout can
 * place it anywhere. Clicks stop here so they never count as a turn
 * advance.
 */
export function PhaseBar({ phaseLabel, onEnd }: PhaseBarProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not an interactive element
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard only, not an interactive element
    <div className={styles.bar} onClick={(e) => e.stopPropagation()}>
      <p className={styles.status} aria-live="polite">
        <span className={styles.phase}>{phaseLabel}</span>
      </p>
      {onEnd && (
        <Button className={styles.end} onClick={onEnd}>
          End {phaseLabel}
        </Button>
      )}
    </div>
  );
}
