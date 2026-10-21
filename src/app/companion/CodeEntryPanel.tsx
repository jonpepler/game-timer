"use client";

import { Button, Field, SectionLabel } from "@/components/ui";
import { useState } from "react";
import { normaliseSessionCode, SESSION_CODE_LENGTH } from "@/lib/sessionCode";
import styles from "./page.module.css";

/*
 * Manual session-code entry, shown on the companion screen when no
 * ?code= is present (the QR-scan path skips it). Extracted into its own
 * file so it can be unit/a11y-tested in isolation: Next.js page modules
 * may only export `default` + framework hooks, so it can't live in
 * page.tsx as a named export.
 */
export function CodeEntryPanel() {
  const [draft, setDraft] = useState("");
  // Normalise as the user types so what they see matches what gets
  // sent: drops whitespace, uppercases, and strips anything outside
  // the alphabet. Mirrors the toPeerId normalisation server-side.
  const normalised = normaliseSessionCode(draft);
  const submit = () => {
    if (normalised.length === 0) return;
    // Hand off via the URL so the same page reloads with a code in
    // place: keeps the rest of the flow (claim restore, connect)
    // unchanged.
    window.location.search = `?code=${encodeURIComponent(normalised)}`;
  };
  return (
    <div className={styles.codeEntryBox}>
      <p className={styles.codeEntryHint}>
        Open the QR code on the host device, or enter the session code below.
      </p>
      <form
        className={styles.codeEntryForm}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SectionLabel as="label" htmlFor="companion-code">
          Session code
        </SectionLabel>
        <Field
          id="companion-code"
          type="text"
          inputMode="text"
          value={normalised}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. K3WP"
          maxLength={SESSION_CODE_LENGTH}
          className={styles.codeField}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={normalised.length === 0}
        >
          Connect
        </Button>
      </form>
    </div>
  );
}
