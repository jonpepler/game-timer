import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { EditableField } from "../EditableField";
import styles from "./Footer.module.css";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Clock, Hourglass, Pause, Play, Undo2 } from "lucide-react";

type FooterProps = {
  remainingTurns: number;
  setExpectedTurns: (expectedTurns: number) => void;
  setPreventClickCapture: Dispatch<SetStateAction<boolean>>;
  paused: boolean;
  pause: () => void;
  unpause: () => void;
  averageTime: number;
  undo: () => void;
  canUndo: boolean;
};

export const Footer = ({
  remainingTurns,
  setExpectedTurns,
  setPreventClickCapture,
  paused,
  pause,
  unpause,
  averageTime,
  undo,
  canUndo,
}: FooterProps) => {
  // The predicted-finish time depends on Date.now(), which differs between
  // the static-export build snapshot and the client mount. Defer to after
  // mount so SSR HTML and the first client render agree (an em-dash
  // placeholder), and only the second render fills in the wall-clock time.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const predictedFinish = mounted
    ? getDateSecondsFromNow(remainingTurns * averageTime).toLocaleTimeString(
        [],
        { hour: "numeric", minute: "2-digit" },
      )
    : "—";

  // Tap-to-advance lives on a parent div. Buttons in the footer need to
  // stopPropagation so a click on the button doesn't also count as a turn
  // advance.
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  return (
    <footer className={styles.footer}>
      <EditableField
        text=""
        value={remainingTurns.toString()}
        onChange={(text) => setExpectedTurns(Number(text))}
        onEditingChange={setPreventClickCapture}
        className={styles.footerLeft}
        renderDisplay={() => (
          <span className={styles.meta}>
            <Hourglass size={16} className={styles.metaIcon} aria-hidden />
            <span className={styles.metaValue}>{remainingTurns}</span>
            turns left
          </span>
        )}
      />

      <div className={`${styles.controls} ${styles.footerCenter}`}>
        <button
          type="button"
          onClick={stop(undo)}
          disabled={!canUndo}
          className={styles.secondaryToggle}
          aria-label="Undo last turn"
        >
          <Undo2 aria-hidden />
        </button>
        <button
          type="button"
          onClick={stop(paused ? unpause : pause)}
          className={styles.toggle}
          aria-label={paused ? "Resume timer" : "Pause timer"}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </button>
      </div>

      <span className={`${styles.meta} ${styles.footerRight}`}>
        <Clock size={16} className={styles.metaIcon} aria-hidden />
        ends at <span className={styles.metaValue}>{predictedFinish}</span>
      </span>
    </footer>
  );
};
