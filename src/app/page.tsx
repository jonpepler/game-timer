import styles from "./page.module.css";

import Link from "next/link";

export default function Home() {
  return (
    <>
      <main className={styles.main}>
        <Link href="/timer" className={styles.button}>
          New Game
        </Link>
      </main>
      <footer className={styles.footer}>
        <span>Sound Credits</span>
        <span>Chime 0011.wav - radian</span>
        <span>Chime-Improper.flac - drooler</span>
      </footer>
    </>
  );
}
