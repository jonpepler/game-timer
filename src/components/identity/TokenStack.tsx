import type { CSSProperties } from "react";
import { Disc } from "@/components/ui";
import type { EntrySymbol } from "@/state/entryIdentity";
import { EntryToken } from "./EntryToken";
import styles from "./identity.module.css";

export interface StackedToken {
  id: string;
  color: string;
  symbol?: EntrySymbol;
}

interface TokenStackProps {
  // In the order they take their turns; the first sits on top.
  tokens: StackedToken[];
  // The number they share, shown once after the stack.
  value?: number;
  // Token diameter in pixels.
  size: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Tokens that share a value, overlapped like pieces stacked in one space,
 * then the value once. Decorative: whatever it marks names the entries
 * elsewhere for assistive tech.
 */
export function TokenStack({
  tokens,
  value,
  size,
  className,
  style,
}: TokenStackProps) {
  return (
    <span
      className={`${styles.stack} ${className ?? ""}`}
      style={{ ...style, "--token-size": `${size}px` } as CSSProperties}
      aria-hidden
      data-token-stack
    >
      <span className={styles.stackTokens}>
        {tokens.map((t, i) => (
          <span
            key={t.id}
            className={styles.stackSlot}
            style={{ zIndex: tokens.length - i }}
          >
            {t.symbol ? (
              <EntryToken color={t.color} symbol={t.symbol} size={size} />
            ) : (
              <Disc color={t.color} size="lg" />
            )}
          </span>
        ))}
      </span>
      {value !== undefined && (
        <span className={styles.stackValue}>{value}</span>
      )}
    </span>
  );
}
