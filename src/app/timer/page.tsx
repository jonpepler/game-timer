"use client";

import { useId, useState } from "react";
import styles from "../page.module.css";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import { useKeyIncrementer } from "@/hooks/useKeyIncrementer";

export default function Home() {
  const [averageTime, setAverageTime] = useState(5 * 60);
  const [timerKey, newTimer] = useKeyIncrementer("timer");
  return (
    <main className={styles.main} onClick={newTimer}>
      <CountdownCircleTimer
        isPlaying
        duration={averageTime}
        colors={["#004777", "#F7B801", "#A30000", "#A30000"]}
        colorsTime={[7, 5, 2, 0]}
        key={timerKey}
      >
        {({ remainingTime }) =>
          `${Math.floor(remainingTime / 60)}:${(remainingTime % 60).toString().padStart(2, "0")}`
        }
      </CountdownCircleTimer>
    </main>
  );
}
