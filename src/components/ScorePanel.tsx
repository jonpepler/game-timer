import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
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
  // Per-player set of milestone atScores that have already fired in
  // the current game. The track hides fire-once markers whose
  // threshold has been crossed by anyone (they've done their job and
  // would otherwise clutter the bar).
  firedMilestones?: Record<number, number[]>;
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
  firedMilestones,
}: ScorePanelProps) {
  // Always-on selection so the +/- controls don't appear and disappear.
  // Initialise to the active turn player if there is one, otherwise the
  // first player.
  const initialSelection =
    activePlayerIndex ?? (players.length > 0 ? 0 : null);
  const [selected, setSelected] = useState<number | null>(initialSelection);
  // Catch-up panel: a scrollable stack of +/- controls for the other
  // players, so missed scores can be added without rotating the
  // selection through the track. Collapsed by default to keep the
  // panel compact when the active player is the only thing changing.
  const [othersExpanded, setOthersExpanded] = useState(false);

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

  // Indices of players NOT currently shown in the main adder. Order
  // mirrors seating so the catch-up stack reads the same as everywhere
  // else (player 1 at the top, etc.).
  const otherIndices = players
    .map((_, i) => i)
    .filter((i) => i !== selected);

  // Toggle + stack for the catch-up panel. Both null when the panel
  // can't make sense (read-only, no onIncrement, or nobody to catch up
  // on).
  const showOthersUi =
    !readOnly && onIncrement !== undefined && otherIndices.length > 0;

  const othersToggleNode = showOthersUi && (
    <button
      type="button"
      onClick={stopProp(() => setOthersExpanded((v) => !v))}
      className={styles.othersToggle}
      aria-expanded={othersExpanded}
      aria-controls="score-panel-others-stack"
    >
      {othersExpanded ? (
        <ChevronUp aria-hidden />
      ) : (
        <ChevronDown aria-hidden />
      )}
      {othersExpanded ? "Hide other scores" : "Show other scores"}
    </button>
  );

  const othersStackNode = showOthersUi && othersExpanded && (
    <div
      id="score-panel-others-stack"
      className={styles.othersStack}
      role="group"
      aria-label="Other player scores"
    >
      {otherIndices.map((i) => {
        const player = players[i];
        const score = scores[i] ?? min;
        const rowAtMin = score <= min;
        const rowAtMax = max !== undefined ? score >= max : false;
        return (
          <div key={i} className={styles.otherRow}>
            <button
              type="button"
              onClick={stopProp(() => onIncrement!(i, -step))}
              disabled={rowAtMin}
              className={styles.scoreButtonSmall}
              aria-label={`Decrease score for ${player.name}`}
            >
              <Minus aria-hidden />
            </button>
            <span
              className={styles.otherName}
              style={{ color: player.color }}
            >
              <span
                className={styles.selectedSwatch}
                style={{ background: player.color }}
                aria-hidden
              />
              {player.name}
            </span>
            <span className={styles.otherScore}>{score}</span>
            <button
              type="button"
              onClick={stopProp(() => onIncrement!(i, step))}
              disabled={rowAtMax}
              className={styles.scoreButtonSmall}
              aria-label={`Increase score for ${player.name}`}
            >
              <Plus aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );

  // The +/- score adder for the selected player. Hoisted out of the
  // render so we can place it above the track (per user feedback)
  // OR keep it next to the leaderboard variant below.
  const adderNode = !readOnly && onIncrement && selectedPlayer && (
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
  );

  // Unique score positions on the track — the 0 and max anchors
  // plus each player's actual score. Drives the bottom row of
  // labels so the track reads as a sparse 0-to-max scale with
  // only the meaningful numbers shown.
  const uniqueScoreSet = new Set<number>([min]);
  if (max !== undefined) uniqueScoreSet.add(max);
  for (let i = 0; i < players.length; i++) {
    uniqueScoreSet.add(scores[i] ?? min);
  }
  const uniqueScores = Array.from(uniqueScoreSet).sort((a, b) => a - b);

  return (
    <div className={styles.container} aria-label="Scores">
      {/* Catch-up panel: toggle + scrollable stack of +/- adders for
          the players NOT currently shown in the main adder. Lives
          above the selected-player pill so the primary control stays
          in the same spot regardless of expansion state. */}
      {showOthersUi && (
        <div className={styles.catchUp}>
          {othersToggleNode}
          {othersStackNode}
        </div>
      )}
      {/* Adder sits above the track. With the SCORES heading
          dropped, the adder pill IS the panel's chrome label —
          its name + score effectively title the strip. */}
      {adderNode}

      {isTrack ? (
        <>
          <div className={styles.track}>
            <div className={styles.trackBar} aria-hidden />
            {/* Milestone markers — small ticks at each configured
                atScore. Fire-once milestones disappear once anyone
                has crossed them (they've done their job); per-player
                milestones stay visible because each player can still
                fire them. */}
            {(scoreConfig.milestones ?? [])
              .filter((m) => {
                if (!m.fireOnce) return true;
                if (!firedMilestones) return true;
                const firedByAnyone = Object.values(firedMilestones).some(
                  (arr) => arr.includes(m.atScore),
                );
                return !firedByAnyone;
              })
              .map((m, i) => {
              const range = max! - min;
              const pct = range === 0 ? 0 : ((m.atScore - min) / range) * 100;
              return (
                <span
                  key={`milestone-${m.atScore}-${i}`}
                  className={styles.trackMilestone}
                  style={{
                    left: `${Math.max(0, Math.min(100, pct))}%`,
                  }}
                  aria-hidden
                  title={`${m.atScore}: ${m.label}`}
                >
                  {m.marker?.icon ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={m.marker.icon}
                      alt=""
                      className={styles.trackMilestoneIcon}
                    />
                  ) : (
                    <span className={styles.trackMilestoneLabel}>
                      {m.marker?.display ?? "★"}
                    </span>
                  )}
                </span>
              );
            })}
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
              // Pair-wise cluster math: normal neighbours sit 20px
              // apart, but a gap involving the active player gets
              // stretched to 38px so the 1.5×-scaled head icon
              // doesn't crowd them out. Walk the sibling list,
              // sum per-pair gaps to get each member's offset, then
              // centre the whole cluster on `trackCentreY`.
              const NORMAL_GAP = 20;
              const ACTIVE_GAP = 38;
              const isActiveAt = (i: number) =>
                sameScoreSiblings[i] === activePlayerIndex;
              const positions: number[] = [0];
              for (let i = 1; i < clusterSize; i++) {
                positions.push(
                  positions[i - 1] +
                    (isActiveAt(i - 1) || isActiveAt(i)
                      ? ACTIVE_GAP
                      : NORMAL_GAP),
                );
              }
              const mean =
                positions.reduce((a, b) => a + b, 0) / clusterSize;
              const yOffset = positions[clusterIndex] - mean;
              const markerSize = 40;
              const trackCentreY = 39;
              const top = trackCentreY + yOffset - markerSize / 2;
              const isActive = activePlayerIndex === index;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={stopProp(() => setSelected(index))}
                  className={`${styles.marker} ${
                    selected === index ? styles.markerSelected : ""
                  } ${isActive ? styles.markerActive : ""}`}
                  style={{
                    left: `${Math.max(0, Math.min(100, pct))}%`,
                    top: `${top}px`,
                    background: player.color,
                  }}
                  aria-label={`${player.name} score ${score}`}
                  title={`${player.name}: ${score}`}
                >
                  {player.headIconSrc ? (
                    // Head-icon PNG (portrait crop). Rendered as a
                    // raster image so the artwork's own colours
                    // come through — no circular crop.
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
            {/* Score labels under the track — reads as a sparse
                scale where only the meaningful numbers are shown
                (anchors + each player's actual score). Positioned
                absolutely against the same track box as the
                markers so labels sit directly below their icons. */}
            {uniqueScores.map((s) => {
              const range = (max ?? min) - min;
              const pct = range === 0 ? 0 : ((s - min) / range) * 100;
              return (
                <span
                  key={s}
                  className={styles.scoreLabel}
                  style={{
                    left: `${Math.max(0, Math.min(100, pct))}%`,
                  }}
                  aria-hidden
                >
                  {s}
                </span>
              );
            })}
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
    </div>
  );
}
