import { type CSSProperties, type ReactNode, useId } from "react";
import { useClockFace } from "@/hooks/useGameTheme";
import {
  CLOCK_GEOMETRY as GEO,
  type ClockFace,
  NUMERAL_METRICS,
  type ResolvedNumeralFace,
  SWEEP_WEIGHT,
} from "@/state/clockFace";
import {
  arc,
  ornamentPaths,
  playerArc,
  polar,
  RING_LENGTH,
  RING_PATH,
  sector,
} from "./clockPaths";
import styles from "./TimerRing.module.css";

interface RingPlayer {
  name: string;
  color: string;
}

interface TimerRingProps {
  // Share of the countdown left, 0 to 100.
  value: number;
  text: string;
  paused: boolean;
  // How far into overtime, as a share of the average; 0 while the countdown runs.
  overtimeOpacity: number;
  /**
   * Set while the acting entry's turn is untimed: the ring sits full and
   * calm, and this label replaces the time.
   */
  untimedLabel?: string | null;
  /** Seats drawn as segments inside the ring, with the acting one picked out. */
  players?: RingPlayer[];
  activeIndex?: number;
  /** The face and numerals to draw; the theme in play when left out. */
  face?: ClockFace;
  numerals?: ResolvedNumeralFace | "default";
}

const FACE_FAMILY: Record<ResolvedNumeralFace, string> = {
  "inter-600": styles.faceInter,
  "old-standard-700": styles.faceOldStandard,
  "big-shoulders-800": styles.faceBigShoulders,
};

const TRACK = "var(--color-clock-track)";
const ORNAMENT = "var(--color-clock-ornament)";
const ORNAMENT_OVERTIME = "var(--color-clock-ornament-overtime)";

/**
 * The timer ring: the clock the table reads. Geometry, paint order and
 * motion belong to the framework; a theme picks the face's options (track,
 * progress, ornament, numerals, seat segments, overtime and paused cues) and
 * the colours, which arrive as tokens. Layers paint field, track, progress,
 * players, ornament, value, each in its own band, so every face has the
 * same footprint. Only stroke-dashoffset, fill-opacity and rotate animate.
 */
export const TimerRing = (props: TimerRingProps) => {
  const theme = useClockFace();
  const face = props.face ?? theme.face;
  const numerals = props.numerals ?? (props.face ? "default" : theme.numerals);
  return <ClockSvg {...props} face={face} numerals={numerals} />;
};

const ClockSvg = ({
  value,
  text,
  paused,
  overtimeOpacity,
  untimedLabel,
  players,
  activeIndex,
  face,
  numerals,
}: TimerRingProps & {
  face: ClockFace;
  numerals: ResolvedNumeralFace | "default";
}) => {
  const id = useId().replace(/:/g, "");
  const untimed = untimedLabel != null;
  const share = Math.max(0, Math.min(1, (untimed ? 100 : value) / 100));
  const overtime = untimed ? 0 : Math.max(0, Math.min(1, overtimeOpacity));
  const tone = paused
    ? "var(--color-timer-paused)"
    : untimed
      ? "var(--color-text-muted)"
      : "var(--color-timer-active)";
  const hollow = paused && face.paused.cue === "tone-hollow";
  const defs: ReactNode[] = [];

  // Field: the overtime area, never a stroke in the ring or player band.
  let field: ReactNode;
  const washStyle = (strength: string): CSSProperties => ({
    fillOpacity: strength,
    transition: "fill-opacity var(--duration-wash) var(--ease-standard)",
  });
  if (face.overtime.style === "hatch") {
    defs.push(
      <pattern
        key="hatch"
        id={`${id}-hatch`}
        width="2.4"
        height="2.4"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <path
          d="M0 0V2.4"
          stroke="var(--color-timer-overtime)"
          strokeWidth="0.7"
        />
      </pattern>,
    );
    const v = GEO.value;
    field = (
      <>
        <circle
          cx="50"
          cy="50"
          r={GEO.field.r}
          fill={`url(#${id}-hatch)`}
          style={washStyle(String(overtime))}
        />
        <circle
          cx="50"
          cy="50"
          r={GEO.field.r}
          fill="var(--color-timer-overtime)"
          style={washStyle(String(overtime * 0.12))}
        />
        {/* A plate under the value so the hatch never runs through the figures. */}
        <rect
          x={v.x - 4}
          y={v.y - 3.2}
          width={v.w + 8}
          height={v.h + 6.4}
          fill="var(--color-surface)"
          style={washStyle(overtime > 0 ? "1" : "0")}
        />
      </>
    );
  } else {
    field = (
      <circle
        cx="50"
        cy="50"
        r={GEO.field.r}
        fill="var(--color-timer-overtime)"
        style={washStyle(`calc(var(--clock-wash-cap) * ${overtime})`)}
      />
    );
  }

  // Track and progress.
  const track: ReactNode[] = [];
  const progress: ReactNode[] = [];
  const ts = face.track.style;
  const weight = SWEEP_WEIGHT[face.progress.weight];
  const cap = face.progress.cap;
  if (ts === "hairline") {
    track.push(
      <path
        key="hairline"
        d={RING_PATH}
        stroke={TRACK}
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        style={{
          strokeDasharray: `${RING_LENGTH}px ${RING_LENGTH}px`,
          strokeDashoffset: "0px",
        }}
      />,
    );
  } else if (ts === "double-rule" || ts === "band") {
    const [r0, r1] = ts === "double-rule" ? [43.4, 48.8] : [43.2, 49.4];
    if (ts === "band")
      track.push(
        <path
          key="band"
          d={sector(r0, r1, 0, 359.999)}
          fill="var(--color-text)"
          fillOpacity="0.08"
        />,
      );
    for (const r of [r0, r1])
      track.push(
        <circle
          key={r}
          cx="50"
          cy="50"
          r={r}
          stroke={TRACK}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          fill="none"
        />,
      );
  } else if (ts === "ticks") {
    const n = face.track.divisions;
    const longEvery = n / 10;
    const lit: string[] = [];
    const dim: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i * 360) / n;
      const isLong = i % longEvery === 0;
      const d = `M${polar(47.4, a).join(" ")}L${polar(isLong ? 44.2 : 45.6, a).join(" ")}`;
      const remaining =
        face.progress.style === "fill" && a < share * 360 - 1e-6;
      (remaining ? lit : dim).push(d);
    }
    track.push(
      <circle
        key="rim"
        cx="50"
        cy="50"
        r="48.9"
        stroke={TRACK}
        strokeWidth="0.4"
        fill="none"
      />,
      <path key="ticks" d={dim.join("")} stroke={TRACK} strokeWidth="0.6" />,
    );
    if (lit.length)
      progress.push(
        <path
          key="lit"
          d={lit.join("")}
          stroke={tone}
          strokeWidth="0.8"
          strokeOpacity={hollow ? 0.55 : 1}
        />,
      );
  } else {
    const n = face.track.count;
    const step = 360 / n;
    const gap = 1.4;
    const cells: string[] = [];
    const filled: string[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = i * step + gap / 2;
      const a1 = (i + 1) * step - gap / 2;
      cells.push(sector(43.4, 49.2, a0, a1));
      const lo = i / n;
      const hi = (i + 1) / n;
      if (share >= hi) filled.push(sector(43.4, 49.2, a0, a1));
      else if (share > lo)
        filled.push(
          sector(43.4, 49.2, a0, a0 + (a1 - a0) * ((share - lo) / (hi - lo))),
        );
    }
    track.push(
      <path
        key="cells"
        d={cells.join("")}
        fill="none"
        stroke={TRACK}
        strokeWidth="0.35"
      />,
    );
    if (filled.length)
      progress.push(
        hollow ? (
          <path
            key="fill"
            d={filled.join("")}
            fill="none"
            stroke={tone}
            strokeWidth="0.6"
            strokeDasharray="0.9 0.7"
          />
        ) : (
          <path key="fill" d={filled.join("")} fill={tone} />
        ),
      );
  }

  if (face.progress.style === "sweep") {
    const sweepR =
      ts === "double-rule"
        ? 46.1
        : ts === "band"
          ? 46.2
          : ts === "ticks"
            ? 48.9
            : GEO.ring.r;
    if (hollow) {
      if (share > 0)
        progress.push(
          <path
            key="sweep"
            d={arc(sweepR, 0, share * 360)}
            stroke={tone}
            strokeWidth={weight}
            strokeDasharray="1.1 1.1"
            fill="none"
          />,
        );
    } else if (ts === "hairline") {
      // The same primitive react-circular-progressbar drew, so the default face is unchanged.
      progress.push(
        <path
          key="sweep"
          d={RING_PATH}
          stroke={tone}
          strokeWidth={weight}
          strokeLinecap={cap}
          fill="none"
          style={{
            strokeDasharray: `${RING_LENGTH}px ${RING_LENGTH}px`,
            strokeDashoffset: `${(1 - share) * RING_LENGTH}px`,
            transition:
              "stroke-dashoffset var(--duration-sweep) var(--ease-standard)",
          }}
        />,
      );
    } else {
      const length = 2 * Math.PI * sweepR;
      progress.push(
        <circle
          key="sweep"
          cx="50"
          cy="50"
          r={sweepR}
          transform="rotate(-90 50 50)"
          stroke={tone}
          strokeWidth={weight}
          strokeLinecap={cap}
          fill="none"
          style={{
            strokeDasharray: `${length}px ${length}px`,
            strokeDashoffset: `${(1 - share) * length}px`,
            transition:
              "stroke-dashoffset var(--duration-sweep) var(--ease-standard)",
          }}
        />,
      );
    }
  }
  if (face.progress.marker === "pointer") {
    progress.push(
      <g
        key="pointer"
        style={{
          rotate: `${share * 360}deg`,
          transformOrigin: "50px 50px",
          transition: "rotate var(--duration-sweep) var(--ease-standard)",
        }}
      >
        <path
          d={`M50 ${50 - GEO.ring.inner - 0.3}L48.4 ${50 - GEO.ring.outer + 0.3}H51.6Z`}
          {...(hollow
            ? { fill: "none", stroke: tone, strokeWidth: 0.35 }
            : { fill: tone })}
        />
      </g>,
    );
  }

  // Players.
  let playerMarks: ReactNode = null;
  if (players?.length) {
    const pl = face.players;
    const n = players.length;
    const segment = 360 / n - GEO.players.gapDeg;
    if (pl.active === "glow")
      defs.push(
        <filter
          key="glow"
          id={`${id}-glow`}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>,
      );
    playerMarks = players.map((player, i) => {
      const active = i === activeIndex;
      const d = playerArc(-90 + i * (360 / n), segment);
      const width = active ? (pl.active === "glow" ? 2 : 2.4) : 0.8;
      return (
        <g key={d}>
          {pl.keyline && active && (
            <path
              d={d}
              fill="none"
              stroke="var(--color-text)"
              strokeWidth={width + 0.7}
              strokeLinecap={pl.cap}
            />
          )}
          <path
            d={d}
            fill="none"
            stroke={player.color}
            strokeWidth={width}
            strokeLinecap={pl.cap}
            style={
              active ? undefined : { opacity: "var(--clock-inactive-opacity)" }
            }
            filter={
              active && pl.active === "glow" ? `url(#${id}-glow)` : undefined
            }
          />
        </g>
      );
    });
  }

  // Ornament, in at most one slot.
  let ornament: ReactNode = null;
  if (face.ornament.slot !== "none") {
    const below = face.ornament.slot === "below";
    // In overtime the ornament takes its overtime colour, and its overtime shape if the face sets one.
    const over = overtime > 0;
    const kind = (over && face.ornament.overtime.kind) || face.ornament.kind;
    const paint = over ? ORNAMENT_OVERTIME : ORNAMENT;
    const { strokes, fills } = ornamentPaths(
      kind,
      GEO.slots[face.ornament.slot],
      below,
    );
    ornament = (
      <>
        {strokes.map((s) => (
          <path
            key={s.d}
            d={s.d}
            stroke={paint}
            strokeWidth={s.width}
            fill="none"
          />
        ))}
        {fills.map((d) => (
          <path key={d} d={d} fill={paint} />
        ))}
      </>
    );
  }

  return (
    <>
      <div className={styles.frame}>
        <svg
          className={styles.clock}
          viewBox="0 0 100 100"
          aria-label={players?.length ? "Player turn indicators" : undefined}
        >
          {defs.length > 0 && <defs>{defs}</defs>}
          <g data-slot="field">{field}</g>
          <g data-slot="track">{track}</g>
          <g data-slot="progress">{progress}</g>
          <g data-slot="players">{playerMarks}</g>
          <g
            data-slot="ornament"
            data-overtime={overtime > 0 ? "" : undefined}
            className={styles.ornament}
          >
            {ornament}
          </g>
          <g data-slot="value">
            {!untimed && (
              <Value
                text={text}
                paused={paused}
                overtime={overtime > 0}
                hollow={hollow}
                numerals={numerals}
              />
            )}
          </g>
        </svg>
      </div>
      {untimed && (
        <p role="status" className={styles.untimed}>
          {untimedLabel}
        </p>
      )}
    </>
  );
};

/** The base string the value box was measured on. */
const BOX_CHARS = "+00:00".length;

const Value = ({
  text,
  paused,
  overtime,
  hollow,
  numerals,
}: {
  text: string;
  paused: boolean;
  overtime: boolean;
  hollow: boolean;
  numerals: ResolvedNumeralFace | "default";
}) => {
  const metrics =
    NUMERAL_METRICS[numerals === "default" ? "inter-600" : numerals];
  // Hours run longer than the box was measured for: shrink to the same width.
  const fit = Math.min(1, BOX_CHARS / text.length);
  const size = +(metrics.size * fit).toFixed(3);
  const y = +(50 + metrics.dy * fit).toFixed(3);
  // The paused tone is only measured against the surface; on the overtime
  // wash a paused value keeps the ink, which the wash cap holds at 3:1.
  const colour =
    paused && !overtime ? "var(--color-timer-paused)" : "var(--color-text)";
  // A hollow face draws paused figures in outline: a cue that is not colour.
  const paint =
    paused && hollow
      ? {
          fill: "none",
          stroke: colour,
          strokeWidth: 0.6,
          strokeLinejoin: "round" as const,
        }
      : { fill: colour };
  const family =
    numerals === "default" ? styles.faceNumeric : FACE_FAMILY[numerals];
  const pitch = (ch: string) =>
    size *
    (ch === ":"
      ? metrics.cell.colon
      : ch === "+"
        ? metrics.cell.plus
        : metrics.cell.digit);

  if (metrics.cellMode) {
    // No tabular figures: each glyph sits centred in its own fixed cell.
    const chars = text.split("");
    let x = 50 - chars.reduce((sum, ch) => sum + pitch(ch), 0) / 2;
    const xs = chars.map((ch) => {
      const centre = x + pitch(ch) / 2;
      x += pitch(ch);
      return +centre.toFixed(3);
    });
    return (
      <text
        className={`${styles.value} ${family}`}
        x={xs.join(" ")}
        y={y}
        fontSize={size}
        {...paint}
      >
        {text}
      </text>
    );
  }

  const sign = metrics.drawnSign;
  if (sign && text.startsWith("+")) {
    /*
     * The face's own "+" is set unpainted at a figure's width, so the text
     * still reads "+01:40", and a plus in the figures' weight is drawn in
     * its cell. The string is centred on its advances, so the cell's
     * centre is known without measuring.
     */
    const advance = text
      .slice(1)
      .split("")
      .reduce(
        (sum, ch) =>
          sum + (ch === ":" ? metrics.cell.colon : metrics.cell.digit),
        metrics.cell.digit,
      );
    const px = 50 - (advance * size) / 2 + (metrics.cell.digit * size) / 2;
    const py = y + sign.cy * size;
    const a = (sign.width * size) / 2;
    const b = (sign.bar * size) / 2;
    const r = (n: number) => +n.toFixed(3);
    const cross = `M${r(px - b)} ${r(py - a)}H${r(px + b)}V${r(py - b)}H${r(px + a)}V${r(py + b)}H${r(px + b)}V${r(py + a)}H${r(px - b)}V${r(py + b)}H${r(px - a)}V${r(py - b)}H${r(px - b)}Z`;
    return (
      <>
        <text
          className={`${styles.value} ${family}`}
          x="50"
          y={y}
          fontSize={size}
          {...paint}
        >
          <tspan
            fillOpacity={0}
            strokeOpacity={0}
            fontSize={
              +(size * (metrics.cell.digit / metrics.cell.plus)).toFixed(3)
            }
          >
            +
          </tspan>
          {text.slice(1)}
        </text>
        <path data-part="sign" d={cross} {...paint} />
      </>
    );
  }

  // A sign drawn wider than a figure is set at a figure's width.
  const wideSign =
    text.startsWith("+") && metrics.cell.plus > metrics.cell.digit * 1.05;
  return (
    <text
      className={`${styles.value} ${family}`}
      x="50"
      y={y}
      fontSize={size}
      {...paint}
    >
      {wideSign ? (
        <>
          <tspan
            fontSize={
              +(size * (metrics.cell.digit / metrics.cell.plus)).toFixed(3)
            }
          >
            +
          </tspan>
          {text.slice(1)}
        </>
      ) : (
        text
      )}
    </text>
  );
};
