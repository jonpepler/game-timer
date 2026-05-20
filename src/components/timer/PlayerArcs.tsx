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

  // 10% inset from the viewBox edge so the arc rides just inside the
  // outer edge of the timer ring it overlays.
  const cx = VIEW / 2;
  const cy = VIEW / 2;
  const r = VIEW / 2 - 5;

  const GAP_DEG = 6;
  // Stroke widths in viewBox units — 100 = full container, so 0.4
  // is ~0.4% of the timer diameter (≈1.5px on a 360px ring),
  // matching the previous absolute look at typical sizes.
  const INACTIVE_WIDTH = 0.6;
  const ACTIVE_WIDTH = 1.6;
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
        {players.map((_, i) => (
          <filter
            key={i}
            id={`glow-${i}`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="0.3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
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
            strokeLinecap="butt"
            opacity={isActive ? 1 : 0.2}
            filter={isActive ? `url(#glow-${i})` : undefined}
            style={{
              transition: "stroke-width 0.25s ease, opacity 0.25s ease",
            }}
          />
        );
      })}
    </svg>
  );
};
