import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./ScorePanel.module.css";
import type { ScoreConfig } from "@/state/gameDefinition";

interface Player {
  name: string;
  color: string;
  // Optional silhouette SVG path (relative to the deployment).
  iconSrc?: string;
  // Optional HEAD portrait crop — preferred over `iconSrc` for the
  // score panel since markers + chips are small circles and a
  // full-body meeple silhouette doesn't read at that size.
  headIconSrc?: string;
}

interface ScorePanelProps {
  players: Player[];
  scores: Record<number, number>;
  scoreConfig: ScoreConfig;
  onIncrement?: (playerIndex: number, delta: number) => void;
  // The player whose turn it currently is — used as the default
  // selection for the +/- controls so the most common case (score the
  // player who just acted) is one tap.
  activePlayerIndex?: number | null;
  // When true, hide the +/- controls. Companion screen renders this
  // way until v3 of the peer protocol.
  readOnly?: boolean;
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

const stopProp = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

export function ScorePanel({
  players,
  scores,
  scoreConfig,
  onIncrement,
  activePlayerIndex,
  readOnly = false,
}: ScorePanelProps) {
  // Always-on selection so the +/- controls don't appear and disappear.
  // Initialise to the active turn player if there is one, otherwise the
  // first player.
  const initialSelection =
    activePlayerIndex ?? (players.length > 0 ? 0 : null);
  const [selected, setSelected] = useState<number | null>(initialSelection);

  // Follow the active player as turns rotate, unless the user has
  // manually picked a different marker (we treat any pick as sticky
  // until the active player changes again).
  useEffect(() => {
    if (activePlayerIndex !== undefined && activePlayerIndex !== null) {
      setSelected(activePlayerIndex);
    }
  }, [activePlayerIndex]);

  if (scoreConfig.displayStyle === "hidden") return null;
  if (players.length === 0) return null;

  const min = scoreConfig.min;
  const max = scoreConfig.max;
  const step = scoreConfig.increment;
  const isTrack = scoreConfig.displayStyle === "linearTrack" && max !== undefined;

  const selectedPlayer = selected !== null ? players[selected] : undefined;
  const selectedScore = selected !== null ? (scores[selected] ?? min) : min;
  const atMin = selectedScore <= min;
  const atMax = max !== undefined ? selectedScore >= max : false;

  return (
    <div className={styles.container} aria-label="Scores">
      <span className={styles.label}>Scores</span>

      {isTrack ? (
        <>
          <div className={styles.track}>
            <div className={styles.trackBar} aria-hidden />
            {players.map((player, index) => {
              const score = scores[index] ?? min;
              const range = max! - min;
              const pct =
                range === 0 ? 0 : ((score - min) / range) * 100;
              // When multiple players share the same score, spread them
              // diagonally so each remains clickable and visible. Cluster
              // centres on the bar's vertical midline: each marker shifts
              // up or down from the centre, alternating, so 4 markers at
              // the same score fan symmetrically rather than spilling
              // all to one side. Selected marker stays on top via z-index.
              const sameScoreSiblings = players
                .map((_, i) => i)
                .filter((i) => (scores[i] ?? min) === score);
              const clusterIndex = sameScoreSiblings.indexOf(index);
              const clusterSize = sameScoreSiblings.length;
              const offset = 14;
              const trackCentreY = 48; // matches CSS .track height/2 - marker/2
              const top =
                trackCentreY +
                (clusterIndex - (clusterSize - 1) / 2) * offset -
                12; /* half-marker so `top` aligns the marker centre */
              return (
                <button
                  key={index}
                  type="button"
                  onClick={stopProp(() => setSelected(index))}
                  className={`${styles.marker} ${
                    selected === index ? styles.markerSelected : ""
                  }`}
                  style={{
                    left: `${Math.max(0, Math.min(100, pct))}%`,
                    top: `${top}px`,
                    background: player.color,
                  }}
                  aria-label={`${player.name} score ${score}`}
                  title={`${player.name}: ${score}`}
                >
                  {player.headIconSrc ? (
                    // Head-icon PNG (portrait crop) — render as a
                    // raster image so the artwork's own colours
                    // come through. The marker's circular border
                    // crops it into the chip shape.
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={player.headIconSrc}
                      alt=""
                      aria-hidden
                      className={styles.markerHead}
                    />
                  ) : player.iconSrc ? (
                    // Fallback: silhouette overlaid on the coloured
                    // chip via mask-image.
                    <span
                      className={styles.markerIcon}
                      style={{
                        WebkitMaskImage: `url(${player.iconSrc})`,
                        maskImage: `url(${player.iconSrc})`,
                      }}
                      aria-hidden
                    />
                  ) : (
                    initial(player.name)
                  )}
                </button>
              );
            })}
          </div>
          <div className={styles.trackTicks} aria-hidden>
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </>
      ) : (
        <div className={styles.leaderboard}>
          {[...players]
            .map((p, i) => ({ player: p, index: i, score: scores[i] ?? min }))
            .sort((a, b) => b.score - a.score)
            .map(({ player, index, score }) => (
              <button
                key={index}
                type="button"
                onClick={stopProp(() => setSelected(index))}
                className={`${styles.chip} ${
                  selected === index ? styles.chipSelected : ""
                }`}
                aria-label={`${player.name} score ${score}`}
              >
                <span
                  className={styles.chipSwatch}
                  style={{ background: player.color }}
                >
                  {player.headIconSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={player.headIconSrc}
                      alt=""
                      aria-hidden
                      className={styles.markerHead}
                    />
                  ) : player.iconSrc ? (
                    <span
                      className={styles.markerIcon}
                      style={{
                        WebkitMaskImage: `url(${player.iconSrc})`,
                        maskImage: `url(${player.iconSrc})`,
                      }}
                      aria-hidden
                    />
                  ) : (
                    initial(player.name)
                  )}
                </span>
                {player.name}
                <span className={styles.chipScore}>{score}</span>
              </button>
            ))}
        </div>
      )}

      {!readOnly && onIncrement && selectedPlayer && (
        <div className={styles.selectedRow}>
          <button
            type="button"
            onClick={stopProp(() => onIncrement(selected!, -step))}
            disabled={atMin}
            className={styles.scoreButton}
            aria-label={`Decrease score for ${selectedPlayer.name}`}
          >
            <Minus aria-hidden />
          </button>
          <span
            className={styles.selectedName}
            style={{ color: selectedPlayer.color }}
          >
            <span
              className={styles.selectedSwatch}
              style={{ background: selectedPlayer.color }}
              aria-hidden
            />
            {selectedPlayer.name}
          </span>
          <span className={styles.selectedScore}>{selectedScore}</span>
          <button
            type="button"
            onClick={stopProp(() => onIncrement(selected!, step))}
            disabled={atMax}
            className={styles.scoreButton}
            aria-label={`Increase score for ${selectedPlayer.name}`}
          >
            <Plus aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
