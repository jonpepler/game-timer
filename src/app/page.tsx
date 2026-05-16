import styles from "./page.module.css";

import Link from "next/link";
import { Play } from "lucide-react";

export default function Home() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Game Timer</h1>
          <p className={styles.tagline}>
            Time board game turns. See when you’ll finish without putting a
            limit on anyone’s thinking.
          </p>
        </div>
        <Link href="/timer" className={styles.cta}>
          <Play size={18} aria-hidden />
          New Game
        </Link>
      </main>
      <footer className={styles.footer}>
        <span className={styles.footerLabel}>Sound credits</span>
        <span>Chime 0011.wav — radian</span>
        <span>Chime-Improper.flac — drooler</span>
      </footer>
    </div>
  );
}
