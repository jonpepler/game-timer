import styles from "./page.module.css";

import { Play } from "lucide-react";
import { ButtonLink, SectionLabel } from "@/components/ui";
import { builtInDefinitions } from "@/state/definitions";
import { creditLine, type SoundSlot, soundCredits } from "@/state/gameSounds";

const SLOT_LABELS: Record<SoundSlot, string> = {
  next_turn: "Next turn",
  last_30: "Final 30 seconds",
  overtime: "Overtime",
};

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
        <ButtonLink href="/timer" variant="primary" icon={<Play aria-hidden />}>
          New game
        </ButtonLink>
      </main>
      <footer className={styles.footer}>
        <SectionLabel as="span" className={styles.footerLabel}>
          Sound credits
        </SectionLabel>
        <span>Chime 0011.wav: radian</span>
        <span>Chime-Improper.flac: drooler</span>
        {builtInDefinitions.map((definition) => {
          const credits = soundCredits(definition);
          if (credits.length === 0) return null;
          return (
            <section
              key={definition.id}
              aria-label={`${definition.name} sound credits`}
              className={styles.footerGroup}
            >
              <span className={styles.footerGame}>{definition.name}</span>
              <ul className={styles.footerList}>
                {credits.map((credit) => (
                  <li key={credit.slot}>
                    {SLOT_LABELS[credit.slot]}: {creditLine(credit)}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </footer>
    </div>
  );
}
