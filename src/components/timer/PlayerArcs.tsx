interface Player {
  name: string;
  color: string;
}

interface PlayerArcsProps {
  players: Player[];
  activeIndex: number;
}

// SVG draws into a fixed 100×100 viewBox; the wrapper's CSS scales it
// to 100% × 100%, so the arcs always line up with the timer ring
// regardless of viewport / fullscreen toggling. Previous version
// took an explicit pixel `containerSize` from the timer hook and
// mismatched whenever the JS-computed size diverged from the CSS-
// sized wrapper (notably when the browser's URL bar hid / showed
// and dvh changed without re-running useWindowSize).
const VIEW = 100;

export const PlayerArcs = ({ players, activeIndex }: PlayerArcsProps) => {
  if (!players.length) return null;

  // The CircularProgressbar draws its track at the edge of its own
  // 100×100 viewBox with strokeWidth 3 (path) / 1 (trail), so its
  // visible inner edge sits around r=47. PlayerArcs needs to live
  // CLEARLY inside that ring, not overlap it — set r to 40 so
  // there's a few viewBox units of dark gap between the timer ring
  // and the player arcs.
  const cx = VIEW / 2;
  const cy = VIEW / 2;
  const r = 40;

  const GAP_DEG = 6;
  // Stroke widths in viewBox units. Bumped slightly since the
  // smaller radius means shorter arc lengths per segment, so the
  // active arc needs a touch more weight to read.
  const INACTIVE_WIDTH = 0.8;
  const ACTIVE_WIDTH = 2;
  const segmentDeg = 360 / players.length - GAP_DEG;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const polarPoint = (deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  });

  const describeArc = (startDeg: number, sweepDeg: number): string => {
    const start = polarPoint(startDeg);
    const end = polarPoint(startDeg + sweepDeg);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  };

  const originDeg = -90;

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        overflow: "visible",
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      aria-label="Player turn indicators"
    >
      <defs>
        {/* Shared bloom for the active arc only. Inactive arcs
            render as plain rounded strokes (no filter) so the
            active player is the only thing that visually pulses
            against the dark surface. */}
        <filter
          id="player-arc-glow-active"
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
        </filter>
      </defs>

      {players.map((player, i) => {
        const isActive = i === activeIndex;
        const startDeg = originDeg + i * (360 / players.length);
        const path = describeArc(startDeg, segmentDeg);

        return (
          <path
            key={i}
            d={path}
            fill="none"
            stroke={player.color}
            strokeWidth={isActive ? ACTIVE_WIDTH : INACTIVE_WIDTH}
            strokeLinecap="round"
            opacity={isActive ? 1 : 0.3}
            filter={isActive ? "url(#player-arc-glow-active)" : undefined}
            style={{
              transition: "stroke-width 0.25s ease, opacity 0.25s ease",
            }}
          />
        );
      })}
    </svg>
  );
};
