"use client";

import { type InputHTMLAttributes, useState } from "react";
import { Field } from "@/components/ui";

type CommitTextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur" | "onKeyDown" | "type"
> & {
  value: string;
  onCommit: (value: string) => void;
  /** Draws the kit field frame; without it the input is bare text in a row. */
  framed?: boolean;
};

/**
 * A text field that edits a local draft and hands the trimmed text to
 * `onCommit` once, on Enter or on leaving the field. Escape puts the
 * stored value back. A blank or unchanged draft commits nothing. While
 * a draft is open an echo of `value` from elsewhere never replaces what
 * the user is typing.
 */
export function CommitTextInput({
  value,
  onCommit,
  framed = false,
  ...inputProps
}: CommitTextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== value) onCommit(next);
  };

  const Input = framed ? Field : "input";
  return (
    <Input
      type="text"
      enterKeyHint="done"
      {...inputProps}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape" && draft !== null) {
          // Cancel the edit without closing whatever dialog holds the field.
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}
