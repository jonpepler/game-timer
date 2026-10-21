import { describe, expect, it } from "vitest";
import { findDefinition } from "../definitionRegistry";
import { type SetupContext, turnOrderForSetup } from "../gameDefinition";
import {
  createInitialGameSessionState,
  type GameSessionAction,
  gameSessionReducer,
  type GameSessionState,
  selectAvailableTurnEntries,
  selectCurrentPlayerIndex,
  selectTurnOrder,
  selectTurnPhases,
  selectUntimedTurnLabel,
} from "../gameSession";
import { selectPrediction } from "../prediction";
import { railwaysDefinition } from "./railways";

const turnOrder = railwaysDefinition.turnOrder!;

const withModules = (...modules: string[]): SetupContext => ({
  modules: { kind: "multi-toggle", selectedIds: ["base", ...modules] },
});

const ids = (list: { id: string }[] | undefined) => list?.map((e) => e.id);

const start = (modules: string[] = []) =>
  createInitialGameSessionState({
    initialAverageSeconds: railwaysDefinition.defaultAverageSeconds,
    expectedTurns: 120,
    players: Array.from({ length: 4 }, (_, i) => ({
      name: `P${i + 1}`,
      metadata: {},
    })),
    turnOrder: turnOrderForSetup(turnOrder, withModules(...modules)),
    definitionId: railwaysDefinition.id,
  });

const run = (s: GameSessionState, ...actions: GameSessionAction[]) =>
  actions.reduce(gameSessionReducer, s);

const turn = (elapsedSeconds: number): GameSessionAction => ({
  type: "NEXT_TURN",
  elapsedSeconds,
  at: 0,
});
const phase = (phaseId: string): GameSessionAction => ({
  type: "SET_PHASE",
  phaseId,
  at: 0,
});

describe("railways definition", () => {
  it("is registered as a built-in with a variable, phased turn order", () => {
    expect(findDefinition("railways")).toBe(railwaysDefinition);
    expect(turnOrder.mode).toBe("variable");
    expect(ids(turnOrder.lists)).toEqual(["players", "companies"]);
    expect(ids(turnOrder.phases)).toEqual(["stock", "operating", "merger"]);
    expect(railwaysDefinition.score).toBeUndefined();
  });

  it("declares every company out of play, each with a kind and colour", () => {
    const entries = turnOrder.entries ?? [];
    expect(entries).toHaveLength(33);
    for (const e of entries) {
      expect(e.inPlay).toBe(false);
      expect(["minor", "major", "neutral"]).toContain(e.kind);
      expect(e.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("names every company on the charters, both sides of every Corporation", () => {
    const labels = (kind: string) =>
      (turnOrder.entries ?? [])
        .filter((e) => e.kind === kind)
        .map((e) => e.label);
    expect(labels("minor")).toEqual([
      "Manufacturing",
      "Coupling",
      "Twin Cities",
      "Agricultural",
      "Suburban",
      "Eastern Mining",
      "Northern Port",
      "Resourceful",
      "Express",
      "Tunneling",
      "Expansive",
      "Overnight",
      "Adaptive",
      "Spacious",
      "Bridging",
      "Circus",
    ]);
    expect(labels("major")).toEqual([
      "International",
      "Inc.",
      "Consortium",
      "Conglomerate",
      "Firm",
      "Federation",
      "Enterprise",
      "Experiment",
      "System",
      "Syndicate",
      "Union",
      "Unlimited",
      "League",
      "LLC",
      "Alliance",
      "Authority",
    ]);
  });

  it("offers both sides of each Direct-to-Major partner charter as merge stand-ins (Landmarks p12)", () => {
    const partners = turnOrder.combine?.extraSources;
    expect(partners?.label).toBe("Charter Partners");
    expect(partners?.entries.map((e) => e.label)).toEqual([
      "Generic",
      "Independent",
      "Big",
      "The",
      "Mom & Pop",
      "Friendly Local",
      "Regional",
      "Common",
      "Original",
      "Grand",
    ]);
    for (const e of partners?.entries ?? []) {
      expect(e.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(e.identity?.symbol).toBeDefined();
    }
    expect(turnOrder.combine?.steps?.target).toBe("Corporation Name");
  });

  it("offers the expansion modules on the first setup step", () => {
    const step = railwaysDefinition.setupSteps?.[0];
    expect(step?.kind.type).toBe("multi-toggle");
    if (step?.kind.type !== "multi-toggle") return;
    expect(ids(step.kind.options)).toEqual([
      "base",
      "landmarkTiles",
      "metropolitan",
      "events",
    ]);
    // Every gate used by the turn order names a module on that step.
    const moduleIds = new Set(ids(step.kind.options));
    for (const gated of [
      ...(turnOrder.entries ?? []),
      ...(turnOrder.phases ?? []),
    ]) {
      if (gated.module) expect(moduleIds.has(gated.module)).toBe(true);
    }
  });

  it("ends setup by choosing the priority player", () => {
    expect(railwaysDefinition.setupSteps?.at(-1)?.kind.type).toBe(
      "select-lead",
    );
  });
});

describe("railways module gating", () => {
  it("every Minor Company and Corporation side is available without choosing a module", () => {
    const order = turnOrderForSetup(turnOrder, withModules());
    const kinds = (kind: string) =>
      order.entries?.filter((e) => e.kind === kind).length;
    expect(kinds("minor")).toBe(16);
    expect(kinds("major")).toBe(16);
    expect(kinds("neutral")).toBe(0);
  });

  it("the Metropolitan module still adds the Metropolitan", () => {
    const order = turnOrderForSetup(turnOrder, withModules("metropolitan"));
    expect(order.entries).toHaveLength(33);
    expect(ids(order.entries)).toContain("metropolitan");
  });
});

describe("a railways game through the reducer", () => {
  const found = (
    id: string,
    value: number,
    playerIndex = 0,
  ): GameSessionAction => ({
    type: "ACTIVATE_TURN_ENTRY",
    entry: { id, value, playerIndex },
  });
  const operate = (valueStepId: string): GameSessionAction => ({
    type: "NEXT_TURN",
    elapsedSeconds: 100,
    at: 0,
    valueStepId,
  });
  const prices = (s: GameSessionState) =>
    selectTurnOrder(s, "companies")?.entries.map((e) => [e.id, e.value]);

  it("starts in the Stock Round with players and an empty company list", () => {
    const s = start();
    expect(selectTurnOrder(s)?.phaseLabel).toBe("Stock Round");
    expect(selectTurnOrder(s, "companies")?.entries).toEqual([]);
    expect(selectAvailableTurnEntries(s, "companies")).toHaveLength(32);
    expect(s.averageSeconds).toBe(45);
    expect(selectTurnPhases(s)?.defaultNextId).toBe("operating");
    expect(
      selectTurnPhases(s)?.phases.find((p) => p.id === "stock")?.exitPrompt,
    ).toBe("Who has priority now?");
  });

  it("founding stacks equal prices in launch order (rules p10, diagram 3)", () => {
    const s = run(
      start(),
      found("expansive", 80),
      found("resourceful", 80, 1),
      found("tunneling", 70),
    );
    expect(prices(s)).toEqual([
      ["expansive", 80],
      ["resourceful", 80],
      ["tunneling", 70],
    ]);
  });

  it("an Operating Round runs companies in price order, once each, then asks what is next", () => {
    let s = run(
      start(),
      { type: "START", at: 0 },
      found("tunneling", 70, 0),
      found("express", 90, 1),
      turn(5),
      phase("operating"),
    );
    expect(s.averageSeconds).toBe(150);
    expect(selectTurnOrder(s)?.activeId).toBe("express");
    // Express's president is seat 1, so the turn is theirs.
    expect(selectCurrentPlayerIndex(s)).toBe(1);
    s = run(s, operate("down"), operate("up2"));
    expect(prices(s)).toEqual([
      ["tunneling", 90],
      ["express", 80],
    ]);
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
    // Two Operating Rounds is the usual run; then the Merger Round.
    expect(selectTurnPhases(s)?.defaultNextId).toBe("operating");
    s = run(s, phase("operating"), operate("same"), operate("same"));
    expect(selectTurnPhases(s)?.defaultNextId).toBe("merger");
  });

  it("the share price track is not uniform above 120 (rules p2)", () => {
    let s = run(start(), { type: "START", at: 0 }, found("express", 120));
    s = run(s, phase("operating"), operate("up"));
    expect(prices(s)).toEqual([["express", 135]]);
  });

  it("only minors act in the Merger Round", () => {
    let s = run(
      start(),
      { type: "START", at: 0 },
      found("tunneling", 70),
      found("union", 100),
      phase("merger"),
    );
    expect(selectTurnOrder(s)?.activeId).toBe("tunneling");
    s = run(s, turn(30));
    expect(selectTurnPhases(s)?.pendingPrompt).toBe(true);
  });

  /**
   * Rules p11, "Token movement on the stock track" (rules.txt from line
   * 544): "Tokens should be kept in a column in the order they entered
   * the space. The first token to enter a column will be the top token
   * in that column. Any new tokens in that column will be placed below
   * any tokens already in the column. This includes ... any share price
   * changes that may occur due to sales, issuing a share, withholding or
   * paying dividends ... The stock token for a Company or Corporation
   * that maintains its current stock price due to paying out more than 0
   * but less than its current price in dividends moves to the bottom of
   * that row as if it just entered."
   */
  describe("stacking: a token entering a price goes below those already there", () => {
    const withFour = () =>
      run(
        start(),
        { type: "START", at: 0 },
        found("express", 100, 0),
        found("tunneling", 90, 1),
        found("resourceful", 80, 2),
        found("expansive", 80, 3),
        phase("operating"),
      );
    const order = (s: GameSessionState) =>
      selectTurnOrder(s, "companies")?.entries.map((e) => `${e.id} ${e.value}`);
    const nextRoundOrder = (s: GameSessionState) => {
      const next = run(s, phase("operating"));
      const acted: string[] = [];
      let at = next;
      for (let i = 0; i < 4; i++) {
        const id = selectTurnOrder(at)?.activeId;
        if (!id) break;
        acted.push(id);
        at = run(at, operate("same"));
      }
      return acted;
    };

    it("after a mid-round price move during the company's own turn", () => {
      // Express withholds: 100 down to 90, below Tunneling already there.
      let s = run(withFour(), operate("down"));
      expect(order(s)).toEqual([
        "tunneling 90",
        "express 90",
        "resourceful 80",
        "expansive 80",
      ]);
      // Tunneling keeps its price but moves to the bottom of the 90s.
      s = run(s, operate("same"));
      expect(order(s)).toEqual([
        "express 90",
        "tunneling 90",
        "resourceful 80",
        "expansive 80",
      ]);
      // Resourceful drops to 70; Expansive keeps 80.
      s = run(s, operate("down"), operate("same"));
      expect(order(s)).toEqual([
        "express 90",
        "tunneling 90",
        "expansive 80",
        "resourceful 70",
      ]);
      expect(nextRoundOrder(s)).toEqual([
        "express",
        "tunneling",
        "expansive",
        "resourceful",
      ]);
    });

    it("after an out-of-turn change (a share sale or issue)", () => {
      // Resourceful's shares are sold before Expansive's: both drop to 70,
      // Resourceful first, so it stays on top of the 70s.
      let s = run(
        withFour(),
        { type: "SET_ENTRY_VALUE", entryId: "resourceful", value: 70 },
        { type: "SET_ENTRY_VALUE", entryId: "expansive", value: 70 },
      );
      expect(order(s)).toEqual([
        "express 100",
        "tunneling 90",
        "resourceful 70",
        "expansive 70",
      ]);
      // Express drops into 90 out of turn and goes below Tunneling, even
      // though it was above it a moment ago.
      s = run(s, { type: "SET_ENTRY_VALUE", entryId: "express", value: 90 });
      expect(order(s)).toEqual([
        "tunneling 90",
        "express 90",
        "resourceful 70",
        "expansive 70",
      ]);
      expect(nextRoundOrder(s)).toEqual([
        "tunneling",
        "express",
        "resourceful",
        "expansive",
      ]);
    });
  });

  /**
   * Landmarks p6, "Entering play" (landmarks.txt lines 330-335): "At the
   * start of the first Stock Round following the first Metropolitan hub
   * token placement, the Metropolitan stock price is set to the highest
   * stock price among existing Companies and Corporations and above all
   * Companies and Corporations in that column."
   */
  it("the Metropolitan enters at the highest price, above that column", () => {
    const s = run(
      start(["metropolitan"]),
      found("tunneling", 70),
      found("express", 120, 1),
      found("resourceful", 120, 2),
      { type: "ACTIVATE_TURN_ENTRY", entry: { id: "metropolitan" } },
    );
    expect(prices(s)).toEqual([
      ["metropolitan", 120],
      ["express", 120],
      ["resourceful", 120],
      ["tunneling", 70],
    ]);
    expect(
      selectTurnOrder(s, "companies")?.entries.find(
        (e) => e.id === "metropolitan",
      )?.playerIndex,
    ).toBeNull();
  });

  /**
   * Landmarks, Metropolitan Transit Department: on the Metropolitan's
   * operating turn every shareholder acts in priority order, so the
   * table pauses the clock for it. Its price still moves.
   */
  it("the Metropolitan operates untimed and still moves its price", () => {
    let s = run(
      start(["metropolitan"]),
      { type: "START", at: 0 },
      found("express", 120, 1),
      { type: "ACTIVATE_TURN_ENTRY", entry: { id: "metropolitan" } },
      phase("operating"),
    );
    expect(selectTurnOrder(s)?.activeId).toBe("metropolitan");
    expect(selectUntimedTurnLabel(s)).toBe("Shareholders act");

    s = run(s, operate("up"));
    expect(s.turns.at(-1)).toMatchObject({
      entryId: "metropolitan",
      elapsedSeconds: 0,
      untimed: true,
    });
    expect(s.averageSeconds).toBe(150);
    expect(prices(s)).toEqual([
      ["metropolitan", 135],
      ["express", 120],
    ]);
    expect(selectUntimedTurnLabel(s)).toBeNull();
  });

  /**
   * Landmarks p9, "Record Gains!" (landmarks.txt lines 542-545): "If a
   * Company or Corporation's total payout is equal to or greater than
   * triple the current share price, the share price increases by three
   * increments." Offered only with the Events module.
   */
  it("offers a three-increment rise only with Events", () => {
    const stepIds = (modules: string[]) =>
      turnOrderForSetup(
        turnOrder,
        withModules(...modules),
      ).entryValues?.steps.map((st) => st.id);
    expect(stepIds([])).toEqual(["bankrupt", "down", "same", "up", "up2"]);
    expect(stepIds(["events"])).toContain("up3");
    let s = run(
      start(["events"]),
      { type: "START", at: 0 },
      found("express", 90),
      phase("operating"),
      operate("up3"),
    );
    expect(prices(s)).toEqual([["express", 120]]);
    s = run(start(), { type: "START", at: 0 }, found("express", 90));
    s = run(s, phase("operating"), operate("up3"));
    // Without Events the step does not exist, so the price holds.
    expect(prices(s)).toEqual([["express", 90]]);
  });

  it("ending the Stock Round names the next priority player", () => {
    let s = run(start(), { type: "START", at: 0 }, turn(10), {
      type: "SET_PHASE",
      phaseId: "operating",
      at: 0,
      elapsedSeconds: 12,
      exitFirstEntryId: "seat-3",
    });
    // The interrupted Stock Round turn was recorded for seat 1.
    expect(s.turns.at(-1)).toMatchObject({
      playerIndex: 1,
      elapsedSeconds: 12,
    });
    s = run(s, phase("stock"));
    expect(selectCurrentPlayerIndex(s)).toBe(3);
  });
});

describe("Railways rules held in config", () => {
  it("p.7 Priority Player: the priority player is determined randomly", () => {
    const step = railwaysDefinition.setupSteps?.find(
      (s) => s.id === "priority",
    );
    expect(step?.kind).toMatchObject({
      type: "select-lead",
      defaultLead: "random",
    });
  });
});

describe("railways game model (rulebook p12, p18, p19)", () => {
  const length = (optionId: string): SetupContext => ({
    ...withModules(),
    length: { kind: "select-one", optionId },
  });
  const startWith = (context: SetupContext) =>
    createInitialGameSessionState({
      initialAverageSeconds: railwaysDefinition.defaultAverageSeconds,
      expectedTurns: 120,
      players: Array.from({ length: 4 }, (_, i) => ({
        name: `P${i + 1}`,
        metadata: {},
      })),
      turnOrder: turnOrderForSetup(turnOrder, context),
    });

  it("p19: the Short Game ends after four cycles and the Long Game after six", () => {
    expect(turnOrderForSetup(turnOrder, length("short")).model?.length).toEqual(
      { type: "typical", cycles: 4 },
    );
    expect(turnOrderForSetup(turnOrder, length("long")).model?.length).toEqual({
      type: "typical",
      cycles: 6,
    });
  });

  it("offers the game length as a setup choice, defaulting to Long", () => {
    const step = railwaysDefinition.setupSteps?.find((s) => s.id === "length");
    expect(step?.kind.type).toBe("select-one");
    if (step?.kind.type !== "select-one") return;
    expect(step.kind.options.map((o) => o.label)).toEqual([
      "Short Game",
      "Long Game",
    ]);
    expect(step.kind.defaultOptionId).toBe("long");
  });

  it("p12 and p19: a cycle is a Stock Round, two Operating Rounds and a Merger Round", () => {
    expect(
      turnOrder.model?.cycle.map((part) => [part.phase, part.rounds]),
    ).toEqual([
      ["stock", 1],
      ["operating", 2],
      ["merger", 1],
    ]);
  });

  it("predicts a fresh 4-player Short Game from the declared round averages", () => {
    // Stock: 4 rounds of 4 players x 3 turns at 45s. Operating: 8 rounds of
    // at least one company per player at 150s. Merger: no Minors yet.
    expect(selectPrediction(startWith(length("short")))).toEqual({
      turns: 4 * 12 + 8 * 4,
      seconds: 4 * 12 * 45 + 8 * 4 * 150,
      modelled: true,
      remaining: { count: 4, label: "cycles left" },
    });
  });

  it("a Long Game predicts a later finish than a Short Game", () => {
    expect(selectPrediction(startWith(length("long"))).seconds).toBeGreaterThan(
      selectPrediction(startWith(length("short"))).seconds,
    );
  });

  it("finishing a Stock Round brings the predicted finish closer", () => {
    const opening = run(startWith(length("short")), { type: "START", at: 0 });
    const operating = run(opening, phase("operating"));
    expect(selectPrediction(operating).seconds).toBeLessThan(
      selectPrediction(opening).seconds,
    );
  });
});
