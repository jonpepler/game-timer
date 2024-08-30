import styles from "./page.module.css";

import Link from "next/link";

export default function Home() {
  return (
    <>
      <main className={styles.main}>
        <Link href="/timer">New Game</Link>
      </main>
      <footer>
        <span>Chime 0011.wav - radian</span>
        <span>Chime-Improper.flac - drooler</span>
      </footer>
    </>
  );
}
