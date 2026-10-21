import type { CSSProperties } from "react";
import {
  type EntrySymbol,
  joinLineage,
  type NameParts,
  spokenName,
  type TypeStyle,
} from "@/state/entryIdentity";
import type { TurnEntry } from "@/state/gameSession";
import { Lineage, Styled } from "./EntryName";
import { EntryToken } from "./EntryToken";
import { SectionLabel } from "@/components/ui";
import styles from "./identity.module.css";
import { typeStyleFor } from "./placement";

interface EntryBannerProps {
  name: string;
  parts?: NameParts;
  color: string;
  symbol?: EntrySymbol;
  typeStyle?: TypeStyle;
  // A ribbon in the entry colour under the title, for prominent entries.
  ribbon?: boolean;
  subheading?: string;
  className?: string;
}

/**
 * Whose turn it is, for a turn entry that is not a seated player. A
 * combined entry's lineage sits between hairline rules above its title.
 * The title holds the banner's centre line, with the token and the
 * "'s turn" suffix hung either side of it, so the lineage, the ribbon and
 * the subheading all centre on the title rather than on the whole line.
 * The title line carries the whole name for assistive tech ("A B
 * Title’s turn"); the rule above it is decorative.
 */
export function EntryBanner({
  name,
  parts,
  color,
  symbol,
  typeStyle,
  ribbon = false,
  subheading,
  className,
}: EntryBannerProps) {
  const lineage = parts?.lineage ?? [];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this only names the banner
    <div
      className={`${styles.banner} ${className ?? ""}`}
      style={{ "--entry-color": color } as CSSProperties}
      role="group"
      aria-label="Whose turn"
    >
      {lineage.length > 0 && (
        <SectionLabel as="div" className={styles.rule} aria-hidden>
          <i />
          <Lineage
            names={lineage}
            wrap={(n) => <span className={styles.ruleName}>{n}</span>}
          />
          <i />
        </SectionLabel>
      )}
      <div className={styles.head}>
        {symbol ? (
          <EntryToken
            color={color}
            symbol={symbol}
            size={36}
            className={styles.bannerToken}
          />
        ) : (
          <span className={styles.bannerSwatch} aria-hidden />
        )}
        <span className={styles.name}>
          {lineage.length > 0 && (
            <span className={styles.srOnly}>{`${joinLineage(lineage)} `}</span>
          )}
          <Styled typeStyle={typeStyle} className={styles.title}>
            {parts?.title ?? name}
          </Styled>
          <span className={styles.suffix}>{"’s turn"}</span>
        </span>
      </div>
      {ribbon && <div className={styles.ribbon} aria-hidden />}
      {subheading && <span className={styles.subheading}>{subheading}</span>}
    </div>
  );
}

interface TurnEntryBannerProps {
  entry: TurnEntry;
  // Kinds whose entries get the ribbon (see `entryKinds[].prominent`).
  prominentKinds: readonly string[];
  // Used when the entry has no colour of its own (its owner's colour).
  fallbackColor: string;
  subheading?: string;
  className?: string;
}

/** EntryBanner for a session turn entry, with the placement rules applied. */
export function TurnEntryBanner({
  entry,
  prominentKinds,
  fallbackColor,
  subheading,
  className,
}: TurnEntryBannerProps) {
  const prominent =
    entry.kind !== undefined && prominentKinds.includes(entry.kind);
  return (
    <EntryBanner
      name={
        entry.nameParts
          ? spokenName(entry.nameParts)
          : (entry.label ?? entry.id)
      }
      parts={entry.nameParts}
      color={entry.color ?? fallbackColor}
      symbol={entry.identity?.symbol}
      typeStyle={typeStyleFor("banner", entry.identity)}
      ribbon={prominent}
      subheading={subheading}
      className={className}
    />
  );
}
