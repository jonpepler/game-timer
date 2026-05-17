"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { DefinitionEditor } from "@/components/DefinitionEditor";
import {
  findCustomDefinition,
  saveCustomDefinition,
} from "@/state/customDefinitions";
import type { GameDefinition } from "@/state/gameDefinition";
import styles from "../page.module.css";

function EditGameDefinitionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const [definition, setDefinition] = useState<GameDefinition | null | "missing">(
    null,
  );

  useEffect(() => {
    if (!id) {
      setDefinition("missing");
      return;
    }
    const found = findCustomDefinition(id);
    setDefinition(found ?? "missing");
  }, [id]);

  const handleSave = (def: GameDefinition) => {
    saveCustomDefinition(def);
    router.push("/games");
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Edit game</h1>
        <Link href="/games" className={styles.backLink}>
          ← Back to library
        </Link>
      </div>
      {definition === null && <p>Loading…</p>}
      {definition === "missing" && (
        <p>
          No custom definition with that id. Built-in definitions can&apos;t be
          edited.
        </p>
      )}
      {definition && typeof definition !== "string" && (
        <DefinitionEditor
          initial={definition}
          onSave={handleSave}
          onCancel={() => router.push("/games")}
        />
      )}
    </div>
  );
}

export default function EditGamePage() {
  return (
    <Suspense fallback={null}>
      <EditGameDefinitionPage />
    </Suspense>
  );
}
