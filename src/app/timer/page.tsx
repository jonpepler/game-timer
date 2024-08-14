'use client'

import { useState } from "react";
import styles from "../page.module.css";
import { CountdownCircleTimer } from 'react-countdown-circle-timer'

export default function Home() {
  return (
    <main className={styles.main}>
        <CountdownCircleTimer
          isPlaying
          duration={7}
          colors={['#004777', '#F7B801', '#A30000', '#A30000']}
          colorsTime={[7, 5, 2, 0]}
        >
          {({ remainingTime }) => remainingTime}
        </CountdownCircleTimer>
    </main>
  );
}
