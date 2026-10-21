"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type EntrySymbol,
  joinLineage,
  type NameParts,
} from "@/state/entryIdentity";
import { liftColor } from "@/utils/liftColor";
import { inkFor, symbolIcon } from "./identity/EntryToken";
import { TokenStack } from "./identity/TokenStack";
import { SectionLabel } from "@/components/ui";
import styles from "./ValueHistoryChart.module.css";

export interface ValueSeries {
  id: string;
  // Flat name, used in the hidden table.
  name: string;
  color: string;
  // A combined entry's title and lineage: the label shows the title
  // whole and the lineage after it, cut to fit.
  nameParts?: NameParts;
  symbol?: EntrySymbol;
  // Values in the order they were set, each with the turn count then.
  points: Array<{ turn: number; value: number }>;
  // Still in play: its line runs on to the current turn.
  live: boolean;
}

interface ValueHistoryChartProps {
  label: string;
  // Series in turn order: tied entries stack in this order.
  series: ValueSeries[];
  currentTurn: number;
  /**
   * "labelled" draws axes and names each line at its end. "compact"
   * draws only the lines and each entry's token at its end, tied entries
   * stacked with their value shown once, and leaves the bottom
   * COMPACT_OVERLAP pixels empty, the fills fading out above them, so the
   * next panel may sit over that strip on clean paper.
   */
  variant?: "labelled" | "compact";
  /**
   * Compact only: the turns the whole game is expected to run. The x axis
   * spans that many, so the lines fill only the share already played and
   * grow across as the game goes on. Once play runs past it they fill the
   * width. Without it the lines always fill the width.
   */
  domainTurns?: number;
}

const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const AXIS_WIDTH = 28;
const LABEL_GAP = 14;
const LINE_HEIGHT = 14;
const LABEL_SPACING = 4;
const MAX_LABEL_LINES = 3;
// Rough advance of one 12px glyph, used to size the label column.
const CHAR_WIDTH = 6.8;
// Shortest horizontal run of the slope where a value changes.
const MIN_RAMP = 10;

const niceTicks = (min: number, max: number): number[] => {
  const span = Math.max(1, max - min);
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
};

/**
 * Break a name into lines of at most `maxChars`, on spaces. A word longer
 * than a line, or a name that needs more than MAX_LABEL_LINES, is cut
 * with an ellipsis; the hidden table always has the full name.
 */
export const wrapLabel = (name: string, maxChars: number): string[] => {
  const limit = Math.max(4, maxChars);
  const lines: string[] = [];
  let current = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= limit) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const fitted = lines.map((line) =>
    line.length > limit ? `${line.slice(0, limit - 1)}…` : line,
  );
  if (fitted.length <= MAX_LABEL_LINES) return fitted;
  const kept = fitted.slice(0, MAX_LABEL_LINES);
  const last = kept[MAX_LABEL_LINES - 1];
  kept[MAX_LABEL_LINES - 1] =
    `${last.length >= limit ? last.slice(0, limit - 1) : last}…`;
  return kept;
};

interface EndLabel {
  lines: string[];
  // Muted text after the last line.
  trailing?: string;
}

/**
 * A series' end label: its name wrapped to `maxChars`, or for a combined
 * entry its title wrapped, then as much of its lineage as fits on the
 * title's last line.
 */
export const endLabel = (series: ValueSeries, maxChars: number): EndLabel => {
  const parts = series.nameParts;
  if (!parts?.lineage.length)
    return { lines: wrapLabel(series.name, maxChars) };
  const lines = wrapLabel(parts.title, maxChars);
  const room = Math.max(4, maxChars) - lines[lines.length - 1].length - 1;
  if (room < 4) return { lines };
  const lineage = joinLineage(parts.lineage);
  return {
    lines,
    trailing:
      lineage.length <= room ? lineage : `${lineage.slice(0, room - 1)}…`,
  };
};

// End-of-line marker: a token disc when the series has a symbol.
const TOKEN_RADIUS = 8;

/**
 * Stack labels so none overlap: walk them top to bottom pushing each
 * below the last, then pull the stack back up if it ran past the bottom.
 * Takes each label's wanted top and height, returns the placed tops.
 */
const stack = (
  items: Array<{ top: number; height: number }>,
  min: number,
  max: number,
): number[] => {
  const order = items.map((item, i) => ({ ...item, i }));
  order.sort((a, b) => a.top - b.top);
  const placed: number[] = [];
  order.forEach((item, k) => {
    const floor =
      k === 0 ? min : placed[k - 1] + order[k - 1].height + LABEL_SPACING;
    placed[k] = Math.max(item.top, floor);
  });
  for (let k = order.length - 1; k >= 0; k--) {
    const ceiling =
      k === order.length - 1
        ? max - order[k].height
        : placed[k + 1] - order[k].height - LABEL_SPACING;
    placed[k] = Math.max(min, Math.min(placed[k], ceiling));
  }
  const out: number[] = [];
  order.forEach((item, k) => {
    out[item.i] = placed[k];
  });
  return out;
};

/**
 * The path of one series. A value holds until the turn it changed on,
 * sloping to the new one across most of the turn before, so the line
 * never draws a vertical wall. Several changes on one turn keep the
 * latest value.
 */
const linePathOf = (
  s: ValueSeries,
  x: (turn: number) => number,
  y: (value: number) => number,
  turnWidth: number,
  endX: number,
) => {
  const [first, ...rest] = s.points;
  const start = x(first.turn);
  let px = start;
  let py = y(first.value);
  let openY = py;
  let d = "";
  for (const p of rest) {
    const nx = x(p.turn);
    const ny = y(p.value);
    if (ny === py) continue;
    if (nx > px) {
      const ramp = Math.min(Math.max(MIN_RAMP, turnWidth * 0.6), (nx - px) / 2);
      d += `L${nx - ramp},${py}L${nx},${ny}`;
      px = nx;
    } else if (px > start) {
      d += `L${px},${ny}`;
    } else {
      openY = ny;
    }
    py = ny;
  }
  return `M${start},${openY}${d}L${Math.max(px, endX)},${py}`;
};

/** The chart in the variant asked for. */
export function ValueHistoryChart({
  variant = "labelled",
  ...props
}: ValueHistoryChartProps) {
  return variant === "compact" ? (
    <CompactValueChart {...props} />
  ) : (
    <LabelledValueChart {...props} />
  );
}

/**
 * Every entry's value over the game as a sparkline: one line per entry
 * in its own colour over an area that fades to transparent, labelled at
 * its right-hand end with its current value and name. A value holds flat
 * until it changes, then slopes to the new one. Entries out of play keep
 * a dimmed line and no label. A hidden table carries the same numbers
 * for screen readers.
 */
function LabelledValueChart({
  label,
  series,
  currentTurn,
}: Omit<ValueHistoryChartProps, "variant">) {
  const gradientPrefix = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const drawn = series.filter((s) => s.points.length > 0);
  const hasData = drawn.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure once the chart first has data and its box exists
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasData]);

  if (!hasData) return null;

  const stroke = (s: ValueSeries) => liftColor(s.color);
  const current = (s: ValueSeries) => s.points[s.points.length - 1].value;
  const live = drawn.filter((s) => s.live);

  // Label column: a right-aligned value, then the name wrapped beside it.
  const valueWidth =
    Math.max(2, ...live.map((s) => String(current(s)).length)) * CHAR_WIDTH + 6;
  const longestName = Math.max(0, ...live.map((s) => s.name.length));
  const labelWidth = Math.min(
    Math.round(width * 0.4),
    Math.ceil(valueWidth + longestName * CHAR_WIDTH + 6),
  );
  const nameChars = Math.floor((labelWidth - valueWidth - 6) / CHAR_WIDTH);
  const labels = live.map((s) => endLabel(s, nameChars));
  const labelHeights = labels.map((l) => l.lines.length * LINE_HEIGHT);
  const labelsTotal =
    labelHeights.reduce((sum, h) => sum + h, 0) +
    Math.max(0, labels.length - 1) * LABEL_SPACING;

  const height = Math.round(
    Math.max(
      Math.min(200, Math.max(130, width * 0.42)),
      labelsTotal + PAD_TOP + PAD_BOTTOM,
    ),
  );
  const plotLeft = AXIS_WIDTH;
  const plotRight = width - labelWidth - LABEL_GAP;
  const plotBottom = height - PAD_BOTTOM;
  const labelX = plotRight + LABEL_GAP;

  const values = drawn.flatMap((s) => s.points.map((p) => p.value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Extra room below the lowest value so its fill has height to fade over.
  const span = rawMax - rawMin;
  const yMin = Math.max(0, rawMin - Math.max(10, span * 0.3));
  const yMax = rawMax + Math.max(5, span * 0.12);
  const lastTurn = Math.max(
    1,
    currentTurn,
    ...drawn.flatMap((s) => s.points.map((p) => p.turn)),
  );
  // The x axis starts where the first value was set.
  const firstTurn = Math.min(
    lastTurn - 1,
    ...drawn.map((s) => s.points[0].turn),
  );
  const turnWidth = (plotRight - plotLeft) / (lastTurn - firstTurn);
  const x = (turn: number) => plotLeft + (turn - firstTurn) * turnWidth;
  const y = (value: number) =>
    PAD_TOP + (1 - (value - yMin) / (yMax - yMin)) * (plotBottom - PAD_TOP);

  const endTurn = (s: ValueSeries) =>
    s.live ? lastTurn : s.points[s.points.length - 1].turn;

  const linePath = (s: ValueSeries) =>
    linePathOf(s, x, y, turnWidth, x(endTurn(s)));
  const areaPath = (s: ValueSeries) =>
    `${linePath(s)}L${x(endTurn(s))},${plotBottom}L${x(s.points[0].turn)},${plotBottom}Z`;

  // Several overlapping fills turn to mud, so each gets fainter as more join.
  const fillOpacity = Math.max(0.16, Math.min(0.35, 1 / live.length));

  const labelTops = stack(
    live.map((s, i) => ({
      top: y(current(s)) - LINE_HEIGHT / 2,
      height: labelHeights[i],
    })),
    PAD_TOP - LINE_HEIGHT / 2,
    height - 4,
  );

  return (
    <figure className={styles.figure} aria-label={`${label} over the game`}>
      <SectionLabel as="figcaption">{label}</SectionLabel>
      <div ref={boxRef} className={styles.box}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={styles.svg}
          aria-hidden
          data-testid="value-history-chart"
        >
          <title>{label}</title>
          <defs>
            {live.map((s) => (
              <linearGradient
                key={s.id}
                id={`${gradientPrefix}-${s.id}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={y(Math.max(...s.points.map((p) => p.value)))}
                x2="0"
                y2={plotBottom}
              >
                <stop
                  offset="0%"
                  stopColor={stroke(s)}
                  stopOpacity={fillOpacity}
                />
                <stop offset="100%" stopColor={stroke(s)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {niceTicks(yMin, yMax).map((t) => (
            <g key={t}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y(t)}
                y2={y(t)}
                className={styles.grid}
              />
              <text
                x={plotLeft - 6}
                y={y(t)}
                className={styles.tick}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {t}
              </text>
            </g>
          ))}
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            className={styles.baseline}
          />
          <text x={plotLeft} y={height - 5} className={styles.tick}>
            {`Turn ${firstTurn}`}
          </text>
          <text
            x={plotRight}
            y={height - 5}
            className={styles.tick}
            textAnchor="end"
          >
            {`Turn ${lastTurn}`}
          </text>
          {live.map((s) => (
            <path
              key={`area-${s.id}`}
              d={areaPath(s)}
              fill={`url(#${gradientPrefix}-${s.id})`}
            />
          ))}
          {drawn
            .filter((s) => !s.live)
            .map((s) => {
              const last = s.points[s.points.length - 1];
              return (
                <g key={`out-${s.id}`} className={styles.out}>
                  <path
                    d={linePath(s)}
                    className={styles.line}
                    stroke={stroke(s)}
                  />
                  <circle
                    cx={x(last.turn)}
                    cy={y(last.value)}
                    r={2.5}
                    className={styles.outEnd}
                    stroke={stroke(s)}
                  />
                </g>
              );
            })}
          {live.map((s) => (
            <path
              key={`line-${s.id}`}
              d={linePath(s)}
              className={styles.line}
              stroke={stroke(s)}
            />
          ))}
          {live.map((s, i) => {
            const endY = y(current(s));
            const top = labelTops[i];
            const firstLine = top + LINE_HEIGHT / 2;
            const Icon = s.symbol ? symbolIcon(s.symbol) : null;
            const lineStart = x(lastTurn) + (Icon ? TOKEN_RADIUS : 4);
            const { lines, trailing } = labels[i];
            return (
              <g key={`label-${s.id}`}>
                <path
                  d={`M${lineStart},${endY}C${labelX - 6},${endY} ${lineStart},${firstLine} ${labelX - 3},${firstLine}`}
                  stroke={stroke(s)}
                  className={styles.labelLine}
                />
                {Icon ? (
                  <g data-symbol={s.symbol}>
                    <circle
                      cx={x(lastTurn)}
                      cy={endY}
                      r={TOKEN_RADIUS}
                      fill={s.color}
                      className={styles.endToken}
                    />
                    <Icon
                      x={x(lastTurn) - 5}
                      y={endY - 5}
                      size={10}
                      strokeWidth={2.6}
                      style={{ color: inkFor(s.color) }}
                    />
                  </g>
                ) : (
                  <circle
                    cx={x(lastTurn)}
                    cy={endY}
                    r={3.5}
                    fill={stroke(s)}
                    className={styles.endDot}
                  />
                )}
                <text
                  x={labelX + valueWidth - 6}
                  y={firstLine}
                  dominantBaseline="central"
                  textAnchor="end"
                  className={styles.endValue}
                >
                  {current(s)}
                </text>
                <text
                  x={labelX + valueWidth}
                  y={firstLine}
                  dominantBaseline="central"
                  className={styles.endName}
                >
                  {lines.map((line, k) => (
                    <tspan
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed label
                      key={k}
                      x={labelX + valueWidth}
                      dy={k === 0 ? 0 : LINE_HEIGHT}
                    >
                      {line}
                    </tspan>
                  ))}
                  {trailing && (
                    <tspan
                      className={styles.endLineage}
                    >{` ${trailing}`}</tspan>
                  )}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ValueTable label={label} series={drawn} />
    </figure>
  );
}

/** The chart's numbers for assistive tech. */
function ValueTable({
  label,
  series,
}: {
  label: string;
  series: ValueSeries[];
}) {
  return (
    <table className={styles.srOnly}>
      <caption>{label}</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Now</th>
          <th scope="col">History</th>
        </tr>
      </thead>
      <tbody>
        {series.map((s) => (
          <tr key={s.id}>
            <th scope="row">{s.name}</th>
            <td>{s.live ? s.points[s.points.length - 1].value : "out"}</td>
            <td>{s.points.map((p) => p.value).join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Compact variant: the end tokens' diameter, the gap before them, and
// the fill-only strip left at the bottom for the next panel to sit over.
const STACK_TOKEN = 20;
const STACK_GAP = 6;
const STACK_SPACING = 2;
export const COMPACT_OVERLAP = 24;
// Clear paper between the lowest line's stack and the panel sitting over the strip.
const OVERLAP_CLEARANCE = 8;

/**
 * The value chart with nothing but the lines and their tokens: no axes,
 * no names. Each line ends in its entry's token; entries on the same
 * value share one stack, in turn order, with the value shown once.
 */
function CompactValueChart({
  label,
  series,
  currentTurn,
  domainTurns,
}: Omit<ValueHistoryChartProps, "variant">) {
  const gradientPrefix = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const drawn = series.filter((s) => s.points.length > 0);
  const hasData = drawn.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure once the chart first has data and its box exists
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasData]);

  if (!hasData) return null;

  const stroke = (s: ValueSeries) => liftColor(s.color);
  const current = (s: ValueSeries) => s.points[s.points.length - 1].value;
  const live = drawn.filter((s) => s.live);

  // Live entries grouped by value, each group in turn order.
  const groups: Array<{ value: number; members: ValueSeries[] }> = [];
  for (const s of live) {
    const group = groups.find((g) => g.value === current(s));
    if (group) group.members.push(s);
    else groups.push({ value: current(s), members: [s] });
  }
  const stackWidth = (g: (typeof groups)[number]) =>
    STACK_TOKEN +
    (g.members.length - 1) * STACK_TOKEN * 0.55 +
    4 +
    String(g.value).length * CHAR_WIDTH;
  const gutter = Math.ceil(
    STACK_GAP + Math.max(STACK_TOKEN, ...groups.map(stackWidth)) + 2,
  );

  const height = Math.round(Math.max(110, Math.min(160, width * 0.11)));
  const plotLeft = 0;
  const plotRight = width - gutter;
  const top = STACK_TOKEN / 2 + STACK_SPACING;
  const lowest = height - COMPACT_OVERLAP - OVERLAP_CLEARANCE - STACK_TOKEN / 2;

  const values = drawn.flatMap((s) => s.points.map((p) => p.value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  const y = (value: number) =>
    span === 0
      ? (top + lowest) / 2
      : top + (1 - (value - rawMin) / span) * (lowest - top);
  const lastTurn = Math.max(
    1,
    currentTurn,
    ...drawn.flatMap((s) => s.points.map((p) => p.turn)),
  );
  const firstTurn = Math.min(
    lastTurn - 1,
    ...drawn.map((s) => s.points[0].turn),
  );
  const domainEnd = Math.max(lastTurn, domainTurns ?? lastTurn);
  const turnWidth = (plotRight - plotLeft) / (domainEnd - firstTurn);
  const x = (turn: number) => plotLeft + (turn - firstTurn) * turnWidth;
  const lineEnd = x(lastTurn);
  const endTurn = (s: ValueSeries) =>
    s.live ? lastTurn : s.points[s.points.length - 1].turn;
  const linePath = (s: ValueSeries) =>
    linePathOf(s, x, y, turnWidth, x(endTurn(s)));
  const areaPath = (s: ValueSeries) =>
    `${linePath(s)}L${x(endTurn(s))},${height}L${x(s.points[0].turn)},${height}Z`;
  const fillOpacity = Math.max(0.16, Math.min(0.35, 1 / live.length));

  // Stacks that would touch are pushed apart, and a short line joins
  // each moved stack to its lines.
  const stackTops = stack(
    groups.map((g) => ({
      top: y(g.value) - STACK_TOKEN / 2,
      height: STACK_TOKEN,
    })),
    0,
    height - COMPACT_OVERLAP,
  );
  const markerX = lineEnd + STACK_GAP;

  return (
    <figure
      className={styles.figure}
      aria-label={`${label} over the game`}
      data-overlap-bottom={COMPACT_OVERLAP}
    >
      <SectionLabel as="figcaption">{label}</SectionLabel>
      <div ref={boxRef} className={`${styles.box} ${styles.compactBox}`}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={styles.svg}
          aria-hidden
          data-testid="value-history-chart"
        >
          <title>{label}</title>
          <defs>
            {live.map((s) => (
              <linearGradient
                key={s.id}
                id={`${gradientPrefix}-${s.id}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={y(Math.max(...s.points.map((p) => p.value)))}
                x2="0"
                y2={height - COMPACT_OVERLAP}
              >
                <stop
                  offset="0%"
                  stopColor={stroke(s)}
                  stopOpacity={fillOpacity}
                />
                <stop offset="100%" stopColor={stroke(s)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {live.map((s) => (
            <path
              key={`area-${s.id}`}
              d={areaPath(s)}
              fill={`url(#${gradientPrefix}-${s.id})`}
            />
          ))}
          {drawn
            .filter((s) => !s.live)
            .map((s) => (
              <path
                key={`out-${s.id}`}
                d={linePath(s)}
                className={`${styles.line} ${styles.out}`}
                stroke={stroke(s)}
              />
            ))}
          {live.map((s) => (
            <path
              key={`line-${s.id}`}
              d={linePath(s)}
              className={styles.line}
              stroke={stroke(s)}
            />
          ))}
          {groups.map((g, i) => {
            const lineY = y(g.value);
            const markY = stackTops[i] + STACK_TOKEN / 2;
            if (Math.abs(lineY - markY) < 0.5) return null;
            return (
              <path
                key={`link-${g.value}`}
                d={`M${lineEnd},${lineY}C${markerX},${lineY} ${lineEnd},${markY} ${markerX},${markY}`}
                stroke={stroke(g.members[0])}
                className={styles.labelLine}
              />
            );
          })}
        </svg>
        {groups.map((g, i) => (
          <TokenStack
            key={g.value}
            className={styles.endStack}
            style={{ left: markerX, top: stackTops[i] }}
            size={STACK_TOKEN}
            value={g.value}
            tokens={g.members.map((s) => ({
              id: s.id,
              color: s.color,
              ...(s.symbol ? { symbol: s.symbol } : {}),
            }))}
          />
        ))}
      </div>
      <ValueTable label={label} series={drawn} />
    </figure>
  );
}
