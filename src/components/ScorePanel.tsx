import { type ReactNode, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Chip, Disc, Stepper } from "@/components/ui";
import styles from "./ScorePanel.module.css";
import { PlayerMeeple } from "@/components/PlayerMeeple";
import type { ScoreConfig } from "@/state/gameDefinition";

interface Player {
  name: string;
  color: string;
  // Optional silhouette SVG path (relative to the deployment).
  iconSrc?: string;
  // Optional HEAD portrait crop: preferred over `iconSrc` for the
  // score panel since markers + chips are small circles and a
  // full-body meeple silhouette doesn't read at that size.
  headIconSrc?: string;
}

interface ScorePanelProps {
  players: Player[];
  scores: Record<number, number>;
  // Absent when the game tracks no score; the panel then only shows the
  // chart (if there is one).
  scoreConfig?: ScoreConfig;
  onIncrement?: (playerIndex: number, delta: number) => void;
  // Shown where a score track would be, for games without scores.
  chart?: ReactNode;
  // False when a turn order panel already carries every player's score
  // controls, so the catch-up stack would repeat them.
  catchUp?: boolean;
  // The player whose turn it currently is: used as the default
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

const NO_SCORES: ScoreConfig = { displayStyle: "hidden", min: 0, increment: 1 };

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

const stopProp = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

export function ScorePanel({
  players,
  scores,
  scoreConfig: scoreConfigProp,
  onIncrement,
  activePlayerIndex,
  readOnly = false,
  firedMilestones,
  chart,
  catchUp = true,
}: ScorePanelProps) {
  const scoreConfig = scoreConfigProp ?? NO_SCORES;
  // Always-on selection so the +/- controls don't appear and disappear.
  // Initialise to the active turn player if there is one, otherwise the
  // first player.
  const initialSelection = activePlayerIndex ?? (players.length > 0 ? 0 : null);
  const [selected, setSelected] = useState<number | null>(initialSelection);
  // Catch-up panel: a scrollable stack of +/- controls for the other
  // players, so missed scores can be added without rotating the
  // selection through the track. The other scores start collapsed to
  // keep the panel compact when the active player is the only thing
  // changing.
  const [othersExpanded, setOthersExpanded] = useState(false);

  // Follow the active player as turns rotate, unless the user has
  // manually picked a different marker (we treat any pick as sticky
  // until the active player changes again).
  useEffect(() => {
    if (activePlayerIndex !== undefined && activePlayerIndex !== null) {
      setSelected(activePlayerIndex);
    }
  }, [activePlayerIndex]);

  const scoresShown =
    scoreConfig.displayStyle !== "hidden" && players.length > 0;
  if (!scoresShown && !chart) return null;

  const min = scoreConfig.min;
  const max = scoreConfig.max;
  const step = scoreConfig.increment;
  const isTrack =
    scoreConfig.displayStyle === "linearTrack" && max !== undefined;

  const selectedPlayer = selected !== null ? players[selected] : undefined;
  const selectedScore = selected !== null ? (scores[selected] ?? min) : min;
  const atMin = selectedScore <= min;
  const atMax = max !== undefined ? selectedScore >= max : false;

  // Indices of players NOT currently shown in the main adder. Order
  // mirrors seating so the catch-up stack reads the same as everywhere
  // else (player 1 at the top, etc.).
  const otherIndices = players.map((_, i) => i).filter((i) => i !== selected);

  // Toggle + stack for the catch-up panel. Both null when the panel
  // can't make sense (read-only, no onIncrement, or nobody to catch up
  // on).
  const showOthersUi =
    catchUp &&
    !readOnly &&
    onIncrement !== undefined &&
    otherIndices.length > 0;

  const othersToggleNode = showOthersUi && (
    <Button
      variant="ghost"
      size="sm"
      icon={
        othersExpanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />
      }
      onClick={() => setOthersExpanded((v) => !v)}
      aria-expanded={othersExpanded}
      aria-controls="score-panel-others-stack"
    >
      {othersExpanded ? "Hide other scores" : "Show other scores"}
    </Button>
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
          <Stepper
            key={i}
            className={styles.otherRow}
            value={score}
            onDecrement={() => onIncrement!(i, -step)}
            onIncrement={() => onIncrement!(i, step)}
            canDecrement={!rowAtMin}
            canIncrement={!rowAtMax}
            decrementLabel={`Decrease score for ${player.name}`}
            incrementLabel={`Increase score for ${player.name}`}
          >
            <Disc color={player.color} size="sm" />
            <span>{player.name}</span>
          </Stepper>
        );
      })}
    </div>
  );

  // The +/- score adder for the selected player. Hoisted out of the
  // render so we can place it above the track (per user feedback)
  // OR keep it next to the leaderboard variant below.
  const adderNode = !readOnly && onIncrement && selectedPlayer && (
    <Stepper
      size="wide"
      framed
      className={styles.selectedRow}
      value={selectedScore}
      onDecrement={() => onIncrement(selected!, -step)}
      onIncrement={() => onIncrement(selected!, step)}
      canDecrement={!atMin}
      canIncrement={!atMax}
      decrementLabel={`Decrease score for ${selectedPlayer.name}`}
      incrementLabel={`Increase score for ${selectedPlayer.name}`}
    >
      <Disc color={selectedPlayer.color} size="sm" />
      <span>{selectedPlayer.name}</span>
    </Stepper>
  );

  // Unique score positions on the track: the 0 and max anchors
  // plus each player's actual score. Drives the bottom row of
  // labels so the track reads as a sparse 0-to-max scale with
  // only the meaningful numbers shown.
  const uniqueScoreSet = new Set<number>([min]);
  if (max !== undefined) uniqueScoreSet.add(max);
  for (let i = 0; i < players.length; i++) {
    uniqueScoreSet.add(scores[i] ?? min);
  }
  const uniqueScores = Array.from(uniqueScoreSet).sort((a, b) => a - b);

  // No score tracking: only the chart.
  if (!scoresShown) {
    return (
      <div className={styles.container} data-compact data-chart-slot>
        {chart}
      </div>
    );
  }

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
          dropped, the adder pill IS the panel's chrome label:
          its name + score effectively title the strip. */}
      {adderNode}

      {isTrack ? (
        <div className={styles.track}>
          <div className={styles.trackBar} aria-hidden />
          {/* Milestone markers: small ticks at each configured
                atScore. Fire-once milestones disappear once anyone
                has crossed them (they've done their job); per-player
                milestones stay visible because each player can still
                fire them. */}
          {(scoreConfig.milestones ?? [])
            .filter((m) => {
              if (!m.fireOnce) return true;
              if (!firedMilestones) return true;
              const firedByAnyone = Object.values(firedMilestones).some((arr) =>
                arr.includes(m.atScore),
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
            const pct = range === 0 ? 0 : ((score - min) / range) * 100;
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
            const mean = positions.reduce((a, b) => a + b, 0) / clusterSize;
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
                {/* Head-icon PNG (portrait crop) renders as a raster
                    image so the artwork's own colours come through.
                    Falling back to a silhouette overlaid on the
                    coloured chip via mask-image, then to the initial. */}
                <PlayerMeeple
                  iconSrc={player.iconSrc}
                  headIconSrc={player.headIconSrc}
                  color={player.color}
                  headClassName={styles.markerHead}
                  framedHeadClassName={styles.markerHeadFramed}
                  silhouetteClassName={styles.markerIcon}
                  silhouetteFill="css"
                  fallback={initial(player.name)}
                />
              </button>
            );
          })}
          {/* Score labels under the track: reads as a sparse
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
      ) : (
        <div className={styles.leaderboard}>
          {[...players]
            .map((p, i) => ({ player: p, index: i, score: scores[i] ?? min }))
            .sort((a, b) => b.score - a.score)
            .map(({ player, index, score }) => (
              <Chip
                key={index}
                pressed={selected === index}
                onPress={() => setSelected(index)}
                aria-label={`${player.name} score ${score}`}
                leading={
                  <span
                    className={styles.chipSwatch}
                    style={{ background: player.color }}
                  >
                    <PlayerMeeple
                      iconSrc={player.iconSrc}
                      headIconSrc={player.headIconSrc}
                      color={player.color}
                      headClassName={styles.markerHead}
                      framedHeadClassName={styles.markerHeadFramed}
                      silhouetteClassName={styles.markerIcon}
                      silhouetteFill="css"
                      fallback={initial(player.name)}
                    />
                  </span>
                }
              >
                {player.name}
                <span className={styles.chipScore}>{score}</span>
              </Chip>
            ))}
        </div>
      )}
    </div>
  );
}
