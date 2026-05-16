import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { EditableField } from "../EditableField";
import styles from "./Footer.module.css";
import { Dispatch, SetStateAction } from "react";
import { Clock, Hourglass, Pause, Play } from "lucide-react";

type FooterProps = {
  remainingTurns: number;
  setExpectedTurns: (expectedTurns: number) => void;
  setPreventClickCapture: Dispatch<SetStateAction<boolean>>;
  paused: boolean;
  pause: () => void;
  unpause: () => void;
  averageTime: number;
};

export const Footer = ({
  remainingTurns,
  setExpectedTurns,
  setPreventClickCapture,
  paused,
  pause,
  unpause,
  averageTime,
}: FooterProps) => {
  const predictedFinish = getDateSecondsFromNow(
    remainingTurns * averageTime,
  ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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

      <button
        type="button"
        onClick={paused ? unpause : pause}
        className={`${styles.toggle} ${styles.footerCenter}`}
        aria-label={paused ? "Resume timer" : "Pause timer"}
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      </button>

      <span
        suppressHydrationWarning
        className={`${styles.meta} ${styles.footerRight}`}
      >
        <Clock size={16} className={styles.metaIcon} aria-hidden />
        ends at <span className={styles.metaValue}>{predictedFinish}</span>
      </span>
    </footer>
  );
};
