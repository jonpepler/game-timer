"use client";

import { useRouter } from "next/navigation";
import { DefinitionEditor } from "@/components/DefinitionEditor";
import { saveCustomDefinition } from "@/state/customDefinitions";
import type { GameDefinition } from "@/state/gameDefinition";
import styles from "../page.module.css";
import Link from "next/link";

export default function NewGameDefinitionPage() {
  const router = useRouter();

  const handleSave = (def: GameDefinition) => {
    saveCustomDefinition(def);
    router.push("/games");
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>New game</h1>
        <Link href="/games" className={styles.backLink}>
          ← Back to library
        </Link>
      </div>
      <DefinitionEditor
        onSave={handleSave}
        onCancel={() => router.push("/games")}
      />
    </div>
  );
}
