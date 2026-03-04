import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { EditableField } from "../EditableField";
import styles from "./Footer.module.css";
import { Dispatch, SetStateAction } from "react";

type FooterProps = {
  remainingTurns: number;
  setExpectedTurns: Dispatch<SetStateAction<number>>;
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
  return (
    <footer className={styles.footer}>
      <EditableField
        text={"Remaining Turns: " + remainingTurns}
        value={remainingTurns.toString()}
        onChange={(text) => setExpectedTurns(Number(text))}
        onEditingChange={setPreventClickCapture}
        className={styles.footerLeft}
      />
      {paused ? (
        <button
          onClick={unpause}
          className={`${styles.button} ${styles.footerCenter}`}
        >
          ⏵
        </button>
      ) : (
        <button
          onClick={pause}
          className={`${styles.button} ${styles.footerCenter}`}
        >
          ⏸
        </button>
      )}

      <span suppressHydrationWarning={true} className={styles.footerRight}>
        Predicted game finish:{" "}
        {getDateSecondsFromNow(
          remainingTurns * averageTime,
        ).toLocaleTimeString()}
      </span>
    </footer>
  );
};
