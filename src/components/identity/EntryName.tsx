import { type CSSProperties, Fragment, type ReactNode } from "react";
import {
  joinLineage,
  type NameParts,
  type TypeStyle,
} from "@/state/entryIdentity";
import styles from "./identity.module.css";
import typeStyles from "./typeStyles.module.css";

/**
 * Lineage names run together as "A B", with no connector between them.
 * `wrap` lets a caller put each name in its own element.
 */
export function Lineage({
  names,
  wrap = (name) => name,
}: {
  names: string[];
  wrap?: (name: string) => ReactNode;
}) {
  return (
    <>
      {names.map((name, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; order is fixed
        <Fragment key={i}>
          {i > 0 && " "}
          {wrap(name)}
        </Fragment>
      ))}
    </>
  );
}

/** Text in an entry's type style, or plain when it has none. */
export function Styled({
  typeStyle,
  className,
  children,
}: {
  typeStyle?: TypeStyle;
  className?: string;
  children: ReactNode;
}) {
  if (!typeStyle)
    return className ? <span className={className}>{children}</span> : children;
  return (
    <span
      className={`${typeStyles.styled} ${className ?? ""}`}
      data-type-style={typeStyle}
    >
      {children}
    </span>
  );
}

interface EntryNameProps {
  name: string;
  parts?: NameParts;
  typeStyle?: TypeStyle;
  // "inline" reads lineage then title; "title" draws the title alone,
  // for lists, and keeps the lineage for assistive tech.
  layout?: "inline" | "title";
  color?: string;
}

/**
 * An entry's name. A combined entry shows its title and lineage; its
 * text content always reads naturally ("A B Title"), whatever the
 * visual order.
 */
export function EntryName({
  name,
  parts,
  typeStyle,
  layout = "inline",
  color,
}: EntryNameProps) {
  const style = color
    ? ({ "--entry-color": color } as CSSProperties)
    : undefined;
  if (!parts?.lineage.length)
    return <Styled typeStyle={typeStyle}>{parts?.title ?? name}</Styled>;
  if (layout === "title")
    return (
      <span style={style}>
        <span
          className={styles.srOnly}
        >{`${joinLineage(parts.lineage)} `}</span>
        <Styled typeStyle={typeStyle}>{parts.title}</Styled>
      </span>
    );
  return (
    <span className={styles.inline} style={style}>
      <Lineage names={parts.lineage} />{" "}
      <Styled typeStyle={typeStyle}>{parts.title}</Styled>
    </span>
  );
}
