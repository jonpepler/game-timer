import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dices, Play, Settings, Sliders, X, Users } from "lucide-react";
import styles from "./GameSetupModal.module.css";
import {
  DEFAULT_DEFINITION_ID,
  findDefinition,
  listDefinitions,
} from "@/state/definitionRegistry";
import type {
  AdvancedSetupChoices,
  Faction,
  GameDefinition,
  SetupSchema,
} from "@/state/gameDefinition";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Player {
  name: string;
  color: string;
  // Optional foreign key into definition.factions. Set when the player
  // picked a faction from the dropdown; absent for ad-hoc rows.
  factionId?: string;
}

export interface GameConfig {
  expectedTurns: number;
  players?: Player[];
  // Definition the modal was configured against — captured so downstream
  // features (score, victory, faction lookup) can read the rules.
  definitionId: string;
  // The map/deck/landmarks/hirelings/draft choices the user made when
  // the picked definition declares a setupSchema. Absent otherwise.
  advancedSetup?: AdvancedSetupChoices;
}

interface GameSetupModalProps {
  isOpen: boolean;
  onSubmit: (config: GameConfig) => void;
  onClose?: () => void;
  definitions?: GameDefinition[];
  initialDefinitionId?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const GENERIC_PALETTE = [
  "#E8C547",
  "#E85D47",
  "#47B8E8",
  "#7BE847",
  "#E847B8",
  "#E88947",
];

const GENERIC_MAX_PLAYERS = GENERIC_PALETTE.length;

const buildPlayersForDefinition = (
  definition: GameDefinition,
  count: number,
): Player[] => {
  if (definition.factions && definition.factions.length > 0) {
    return definition.factions.slice(0, count).map((f) => ({
      name: f.name,
      color: f.color,
      factionId: f.id,
    }));
  }
  return Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    color: GENERIC_PALETTE[i] ?? "#ffffff",
  }));
};

const maxPlayersForDefinition = (definition: GameDefinition): number => {
  if (definition.maxPlayers !== undefined) {
    return Math.max(1, definition.maxPlayers);
  }
  if (definition.factions && definition.factions.length > 0) {
    return definition.factions.length;
  }
  return GENERIC_MAX_PLAYERS;
};

const defaultAdvancedSetup = (
  schema: SetupSchema | undefined,
): AdvancedSetupChoices => {
  if (!schema) return {};
  return {
    mapId: schema.maps?.[0]?.id,
    deckId: schema.decks?.[0]?.id,
    landmarkCount: schema.landmarks ? 0 : undefined,
    hirelingCount: schema.hirelings ? 0 : undefined,
    draft: schema.allowDraft ? false : undefined,
  };
};

// Compute which faction ids the user can't pick for a given row,
// because another row already picked them OR because they're mutually
// excluded with something another row already picked.
const blockedFactionsForRow = (
  rowIndex: number,
  players: Player[],
  mutex: [string, string][] | undefined,
): Set<string> => {
  const blocked = new Set<string>();
  players.forEach((p, i) => {
    if (i === rowIndex || !p.factionId) return;
    blocked.add(p.factionId);
    if (!mutex) return;
    for (const [a, b] of mutex) {
      if (p.factionId === a) blocked.add(b);
      if (p.factionId === b) blocked.add(a);
    }
  });
  return blocked;
};

// ── Component ──────────────────────────────────────────────────────────────

export const GameSetupModal = ({
  isOpen,
  onSubmit,
  onClose,
  definitions = listDefinitions(),
  initialDefinitionId = DEFAULT_DEFINITION_ID,
}: GameSetupModalProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const initialDefinition = useMemo(
    () =>
      findDefinition(initialDefinitionId) ??
      definitions[0] ??
      findDefinition(DEFAULT_DEFINITION_ID)!,
    [initialDefinitionId, definitions],
  );

  const [definitionId, setDefinitionId] = useState<string>(
    initialDefinition.id,
  );
  const definition = useMemo(
    () => definitions.find((d) => d.id === definitionId) ?? initialDefinition,
    [definitions, definitionId, initialDefinition],
  );

  const [expectedTurns, setExpectedTurns] = useState<number>(
    initialDefinition.defaultExpectedTurns,
  );
  const [trackPlayers, setTrackPlayers] = useState(false);
  const [playerCount, setPlayerCount] = useState(2);
  const [players, setPlayers] = useState<Player[]>(
    buildPlayersForDefinition(initialDefinition, 2),
  );
  const [advancedSetup, setAdvancedSetup] = useState<AdvancedSetupChoices>(
    defaultAdvancedSetup(initialDefinition.setupSchema),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const applyDefinition = (next: GameDefinition) => {
    setDefinitionId(next.id);
    setExpectedTurns(next.defaultExpectedTurns);
    const maxCount = maxPlayersForDefinition(next);
    const clampedCount = Math.min(playerCount, maxCount);
    setPlayerCount(clampedCount);
    setPlayers(buildPlayersForDefinition(next, clampedCount));
    setAdvancedSetup(defaultAdvancedSetup(next.setupSchema));
  };

  const handleDefinitionChange = (nextId: string) => {
    const next = definitions.find((d) => d.id === nextId);
    if (!next) return;
    applyDefinition(next);
  };

  const maxCount = maxPlayersForDefinition(definition);
  const mutex = definition.setupSchema?.factionConstraints?.mutuallyExclusive;
  const hasFactions = !!(definition.factions && definition.factions.length > 0);
  const hasAdvanced = !!definition.setupSchema;

  const handlePlayerCountChange = (count: number) => {
    const clamped = Math.max(1, Math.min(maxCount, count));
    setPlayerCount(clamped);
    setPlayers((prev) => {
      const next = [...prev];
      const seed = buildPlayersForDefinition(definition, clamped);
      while (next.length < clamped) next.push(seed[next.length]);
      return next.slice(0, clamped);
    });
  };

  const updatePlayer = (index: number, field: keyof Player, value: string) => {
    setPlayers((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const pickFaction = (rowIndex: number, factionId: string) => {
    const f: Faction | undefined = definition.factions?.find(
      (x) => x.id === factionId,
    );
    if (!f) return;
    setPlayers((prev) =>
      prev.map((p, i) =>
        i === rowIndex
          ? { name: f.name, color: f.color, factionId: f.id }
          : p,
      ),
    );
  };

  const handleSubmit = () => {
    onSubmit({
      expectedTurns,
      players: trackPlayers ? players : undefined,
      definitionId: definition.id,
      advancedSetup: hasAdvanced ? advancedSetup : undefined,
    });
  };

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose?.();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.modal}
      aria-labelledby="setup-title"
      onClick={handleDialogClick}
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <header className={styles.header}>
          <h2 id="setup-title" className={styles.title}>
            Game Setup
          </h2>
        </header>

        <div className={styles.scroll}>
          <section className={styles.section}>
            <label htmlFor="game-definition" className={styles.label}>
              <span className={styles.labelIcon}>
                <Dices size={14} aria-hidden />
              </span>
              Game
            </label>
            <select
              id="game-definition"
              className={styles.input}
              value={definition.id}
              onChange={(e) => handleDefinitionChange(e.target.value)}
            >
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {definition.description && (
              <p className={styles.help}>{definition.description}</p>
            )}
            <Link href="/games" className={styles.manageLink}>
              <Settings size={12} aria-hidden />
              Manage games
            </Link>
          </section>

          <section className={styles.section}>
            <label htmlFor="expected-turns" className={styles.label}>
              Expected turns
            </label>
            <input
              id="expected-turns"
              type="number"
              min={1}
              value={expectedTurns}
              onChange={(e) =>
                setExpectedTurns(Math.max(1, parseInt(e.target.value) || 1))
              }
              className={styles.input}
            />
            <p className={styles.help}>
              Used to predict when the game will finish and to set the first
              countdown.
            </p>
          </section>

          {hasAdvanced && (
            <AdvancedSetupSection
              schema={definition.setupSchema!}
              value={advancedSetup}
              onChange={setAdvancedSetup}
            />
          )}

          <section className={styles.section}>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={trackPlayers}
                onChange={(e) => setTrackPlayers(e.target.checked)}
              />
              <span className={styles.toggleText}>
                <Users size={18} aria-hidden="true" />
                Track individual players
              </span>
              <span className={styles.badge}>Experimental</span>
            </label>

            {trackPlayers && (
              <>
                <div className={styles.playerCount}>
                  <label htmlFor="player-count" className={styles.subLabel}>
                    Number of players
                  </label>
                  <input
                    id="player-count"
                    type="number"
                    min={1}
                    max={maxCount}
                    value={playerCount}
                    onChange={(e) =>
                      handlePlayerCountChange(parseInt(e.target.value) || 1)
                    }
                    className={styles.input}
                  />
                </div>

                <ul className={styles.playerList}>
                  {players.map((player, i) => {
                    const blocked = hasFactions
                      ? blockedFactionsForRow(i, players, mutex)
                      : new Set<string>();
                    return (
                      <li key={i} className={styles.playerRow}>
                        <input
                          type="color"
                          value={player.color}
                          onChange={(e) =>
                            updatePlayer(i, "color", e.target.value)
                          }
                          className={styles.colorSwatch}
                          aria-label={`Colour for player ${i + 1}`}
                        />
                        {hasFactions && definition.factions && (
                          <select
                            value={player.factionId ?? ""}
                            onChange={(e) => pickFaction(i, e.target.value)}
                            className={styles.input}
                            aria-label={`Faction for player ${i + 1}`}
                          >
                            <option value="" disabled>
                              — pick a faction —
                            </option>
                            {definition.factions.map((f) => (
                              <option
                                key={f.id}
                                value={f.id}
                                disabled={blocked.has(f.id)}
                              >
                                {f.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          value={player.name}
                          onChange={(e) =>
                            updatePlayer(i, "name", e.target.value)
                          }
                          placeholder={`Player ${i + 1}`}
                          aria-label={`Player ${i + 1} name`}
                          className={styles.input}
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>

        <footer className={styles.actions}>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={styles.secondary}
            >
              <X size={18} aria-hidden="true" />
              Cancel
            </button>
          )}
          <button type="submit" className={styles.primary}>
            <Play size={18} aria-hidden="true" />
            Start Game
          </button>
        </footer>
      </form>
    </dialog>
  );
};

// ── Advanced setup ─────────────────────────────────────────────────────────

interface AdvancedSetupSectionProps {
  schema: SetupSchema;
  value: AdvancedSetupChoices;
  onChange: (next: AdvancedSetupChoices) => void;
}

function AdvancedSetupSection({
  schema,
  value,
  onChange,
}: AdvancedSetupSectionProps) {
  const set = <K extends keyof AdvancedSetupChoices>(
    key: K,
    v: AdvancedSetupChoices[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <section className={styles.section}>
      <span className={styles.label}>
        <span className={styles.labelIcon}>
          <Sliders size={14} aria-hidden />
        </span>
        Advanced setup
      </span>

      {schema.maps && schema.maps.length > 0 && (
        <div>
          <label htmlFor="adv-map" className={styles.subLabel}>
            Map
          </label>
          <select
            id="adv-map"
            value={value.mapId ?? ""}
            onChange={(e) => set("mapId", e.target.value)}
            className={styles.input}
          >
            {schema.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.expansion ? ` · ${m.expansion}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {schema.decks && schema.decks.length > 0 && (
        <div>
          <label htmlFor="adv-deck" className={styles.subLabel}>
            Deck
          </label>
          <select
            id="adv-deck"
            value={value.deckId ?? ""}
            onChange={(e) => set("deckId", e.target.value)}
            className={styles.input}
          >
            {schema.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.expansion ? ` · ${d.expansion}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {schema.landmarks && (
        <div className={styles.playerCount}>
          <label htmlFor="adv-landmarks" className={styles.subLabel}>
            Landmarks
          </label>
          <input
            id="adv-landmarks"
            type="number"
            min={0}
            max={schema.landmarks.maxAllowed}
            value={value.landmarkCount ?? 0}
            onChange={(e) =>
              set(
                "landmarkCount",
                Math.max(
                  0,
                  Math.min(
                    schema.landmarks!.maxAllowed,
                    parseInt(e.target.value) || 0,
                  ),
                ),
              )
            }
            className={styles.input}
          />
        </div>
      )}

      {schema.hirelings && (
        <div className={styles.playerCount}>
          <label htmlFor="adv-hirelings" className={styles.subLabel}>
            Hirelings
          </label>
          <input
            id="adv-hirelings"
            type="number"
            min={0}
            max={schema.hirelings.maxAllowed}
            value={value.hirelingCount ?? 0}
            onChange={(e) =>
              set(
                "hirelingCount",
                Math.max(
                  0,
                  Math.min(
                    schema.hirelings!.maxAllowed,
                    parseInt(e.target.value) || 0,
                  ),
                ),
              )
            }
            className={styles.input}
          />
        </div>
      )}

      {schema.allowDraft && (
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={value.draft ?? false}
            onChange={(e) => set("draft", e.target.checked)}
          />
          <span className={styles.toggleText}>Draft factions</span>
        </label>
      )}
    </section>
  );
}
