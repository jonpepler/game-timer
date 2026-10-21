"use client";

import { useRouter } from "next/navigation";
import { DefinitionEditor } from "@/components/DefinitionEditor";
import { saveCustomDefinition } from "@/state/customDefinitions";
import type { GameDefinition } from "@/state/gameDefinition";
import { ArrowLeft } from "lucide-react";
import { ButtonLink, Heading } from "@/components/ui";
import styles from "../page.module.css";

export default function NewGameDefinitionPage() {
  const router = useRouter();

  const handleSave = (def: GameDefinition) => {
    saveCustomDefinition(def);
    router.push("/games");
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Heading level={1}>New game</Heading>
        <ButtonLink
          href="/games"
          variant="ghost"
          size="sm"
          icon={<ArrowLeft aria-hidden />}
        >
          Back to library
        </ButtonLink>
      </div>
      <DefinitionEditor
        onSave={handleSave}
        onCancel={() => router.push("/games")}
      />
    </div>
  );
}
