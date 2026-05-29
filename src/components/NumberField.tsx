"use client";

import { useEffect, useState } from "react";

interface NumberFieldProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

// Wraps <input type="number"> so the user can backspace to empty during
// editing without the value snapping back to `min`. Internal string
// state keeps the field freely editable; the parent only sees clean
// numeric values, and a blur (or out-of-range entry) clamps + resets
// the visible text to a sane value.
export function NumberField({
  value,
  onChange,
  min,
  max,
  className,
  id,
  ...rest
}: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  // Mirror external value changes (e.g. picking a new game definition
  // reseeds the field) — but only when the parsed text doesn't already
  // agree, so we don't clobber an in-progress edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text intentionally excluded — only react to value
  useEffect(() => {
    const parsed = parseInt(text, 10);
    if (Number.isNaN(parsed) || parsed !== value) {
      setText(String(value));
    }
  }, [value]);

  const commit = (raw: string) => {
    if (raw === "" || raw === "-") return;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    if (min !== undefined && parsed < min) return;
    if (max !== undefined && parsed > max) return;
    if (parsed !== value) onChange(parsed);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setText(next);
    commit(next);
  };

  const handleBlur = () => {
    if (text === "" || text === "-") {
      const fallback = min ?? value;
      setText(String(fallback));
      onChange(fallback);
      return;
    }
    const parsed = parseInt(text, 10);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    let clamped = parsed;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    if (String(clamped) !== text) setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      id={id}
      value={text}
      min={min}
      max={max}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
      {...rest}
    />
  );
}
