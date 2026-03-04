interface Player {
  name: string;
  color: string;
}

interface PlayerArcsProps {
  players: Player[];
  activeIndex: number;
  containerSize: number;
  internalSizeOffset: number;
}

export const PlayerArcs = ({
  players,
  activeIndex,
  containerSize,
  internalSizeOffset,
}: PlayerArcsProps) => {
  if (!players.length) return null;

  const size = containerSize - internalSizeOffset;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;

  const GAP_DEG = 6;
  const INACTIVE_WIDTH = 2;
  const ACTIVE_WIDTH = 6;
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
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        overflow: "visible",
        position: "absolute",
        top: internalSizeOffset / 2,
        left: internalSizeOffset / 2,
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
            <feGaussianBlur stdDeviation="1" result="blur" />
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
