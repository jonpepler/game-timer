import { getDateSecondsFromNow } from "@/utils/getDateSecondsFromNow";
import { EditableField } from "../EditableField";
import { CapText, IconButton } from "@/components/ui";
import styles from "./Footer.module.css";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Clock, Hourglass, Pause, Play, Undo2 } from "lucide-react";

type FooterProps = {
  remainingTurns: number;
  setExpectedTurns: (expectedTurns: number) => void;
  setPreventClickCapture: Dispatch<SetStateAction<boolean>>;
  paused: boolean;
  // The running turn is untimed, so there is no clock to pause.
  untimed?: boolean;
  pause: () => void;
  unpause: () => void;
  // Seconds the rest of the game is predicted to take.
  remainingSeconds: number;
  undo: () => void;
  canUndo: boolean;
  // False when the turns left come from the game's model rather than a budget the table sets.
  turnsEditable?: boolean;
  // The game's own countdown, shown in place of turns left when its model names one.
  remainingCount?: { count: number; label: string };
};

export const Footer = ({
  remainingTurns,
  setExpectedTurns,
  setPreventClickCapture,
  paused,
  untimed = false,
  pause,
  unpause,
  remainingSeconds,
  undo,
  canUndo,
  turnsEditable = true,
  remainingCount,
}: FooterProps) => {
  // The predicted-finish time depends on Date.now(), which differs between
  // the static-export build snapshot and the client mount. Defer to after
  // mount so SSR HTML and the first client render agree (a placeholder),
  // and only the second render fills in the wall-clock time.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const predictedFinish = mounted
    ? getDateSecondsFromNow(Math.max(0, remainingSeconds)).toLocaleTimeString(
        [],
        { hour: "numeric", minute: "2-digit" },
      )
    : "--:--";

  /*
   * A modelled count is an estimate, so its label says so. A game past its
   * budget reads zero rather than a negative count.
   */
  const turnsShown = Math.max(0, remainingTurns);
  const turnsLabel =
    remainingCount?.label ??
    `${turnsEditable ? "" : "est. "}${
      turnsShown === 1 ? "turn left" : "turns left"
    }`;
  const turnsLeft = (
    <span className={styles.meta}>
      <Hourglass size={16} className={styles.metaIcon} aria-hidden />
      <CapText className={styles.metaValue}>
        {remainingCount?.count ?? turnsShown}
      </CapText>{" "}
      <CapText className={styles.metaLabel}>{turnsLabel}</CapText>
    </span>
  );

  return (
    <footer className={styles.footer}>
      {turnsEditable ? (
        <EditableField
          text=""
          value={remainingTurns.toString()}
          onChange={(text) => setExpectedTurns(Number(text))}
          onEditingChange={setPreventClickCapture}
          className={styles.footerLeft}
          renderDisplay={() => turnsLeft}
        />
      ) : (
        <span className={styles.footerLeft}>{turnsLeft}</span>
      )}

      <div className={`${styles.controls} ${styles.footerCenter}`}>
        <IconButton
          label="Undo"
          tooltip="Undo the last action"
          tooltipPlacement="top"
          onClick={undo}
          disabled={!canUndo}
        >
          <Undo2 aria-hidden />
        </IconButton>
        <IconButton
          label={paused ? "Resume timer" : "Pause timer"}
          tooltip={untimed ? "This turn is untimed" : undefined}
          tooltipPlacement="top"
          size="lg"
          tone="filled"
          onClick={paused ? unpause : pause}
          disabled={untimed}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </IconButton>
      </div>

      <span className={`${styles.meta} ${styles.footerRight}`}>
        <Clock size={16} className={styles.metaIcon} aria-hidden />
        <CapText className={styles.metaLabel}>ends at</CapText>{" "}
        <CapText className={styles.metaValue}>{predictedFinish}</CapText>
      </span>
    </footer>
  );
};
