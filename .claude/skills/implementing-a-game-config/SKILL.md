---
name: implementing-a-game-config
description: Use when adding a new board game to Game Timer, extending an existing game's config with an expansion, or when a user hands over a rulebook and asks for the timer to support that game
---

# Implementing a game config

## Overview

Game Timer is a framework; a game is a config that implements it. A game is done when the table trusts it, so every rule the timer touches is sourced from the rulebook, agreed with the user, and proven by a cited test. The user makes the design calls; you bring options, evidence and prototypes.

This skill is the entry point of a chain. Each skill ends by naming the next one; invoke it and no other.

**REQUIRED BACKGROUND:** the repo CLAUDE.md section "Framework and game configs" (the principle, `gameSpecificTerms`, the guards and their baseline commands).

## The chain

1. `agreeing-game-rules`: rulebook on disk, cited brief, agreed rules and primitive map
2. `planning-game-ui`: inventory of existing UI, options for what is new, prototype picked by the user
3. `writing-rulebook-tests`: cited, user-driven suite, red before the build
4. `building-a-game-config`: primitives, config, companion parity, guards, then evidence for review

`collecting-design-feedback` is the review loop that steps 2 and 4 call. An expansion enters at step 1, scoped to what changes.

Working files (rulebook text, `SPEC.md`, prototypes, evidence) live in the session scratchpad under `<game-id>/`, not in the repo.

**Next:** invoke the first skill whose gate is not yet met, and no other skill. A met gate (cited brief written, primitive options picked by the user) stays closed unless new evidence contradicts it; do not re-ask it.

## Rules for the whole chain

- **Cite or ask.** Every rule in the brief, test titles and reports carries a page number. If the rulebook is ambiguous, say so and ask
- **The user picks.** Present options with tradeoffs; never build on a default you chose
- **Lead with weaknesses** in every report, then decisions taken on the user's behalf, then open questions
- **User away or in a hurry?** Batch the gate's questions into one message and keep going on work that does not depend on the answers. "Go build it" approves what was agreed, not the steps after it

| Thought | Reality |
|---|---|
| "The user said quick / you know the game" | Sourcing the rulebook takes minutes; a wrong rule costs the game night |
| "It's just turn order, skip the prototype" | One page, identity only. The user asked for this step |
| "I'll pick the obvious turn model" | Railways' obvious model (drag to reorder) was replaced by the user's (share price drives order) |
| "They said go build it, so UI planning is done" | They approved rules. UI options still go to them, as a review page they can answer in the morning |
| "Desktop video is optional" | Evidence is how the user reviews without a session. Capture both |

## Rule options to check against the rulebook

The framework encodes some table rules as config options. Each default reproduces the behaviour games had before the option existed, so a game opts in only when its rulebook says otherwise. Check each one in `agreeing-game-rules` and cite the page in the config's test:

| Option (schema in `src/state/gameDefinition.ts`) | Values, default first | Ask the rulebook |
|---|---|---|
| `score.victory.type` | none, `firstToMax`, `highestAtTurnLimit` | Does the game end at once on a score, or after a set number of turns with the highest score winning? Ties go to the earliest seat |
| `turnOrder.lists[].valueOrder` | `direction`: `highest-first`, `lowest-first`; `arrivals`: `below-equals`, `above-equals` | Which value acts first, and where does a newcomer to a shared value go? |
| `turnOrder.direction` | `seat-order`, `reverse-seat-order` | Does play pass up or down the seating list? |
| `select-lead.defaultLead` | `first-seat`, `random` | Is the first player chosen at random? |
| `player-pick.pickFrom` | `first-seat`, `lead` | Does picking start from the first seat or relative to the chosen lead? Combine with `pickOrder` |
| `dealt-resolve.order` | `seat`, `reverse-seat` | Who resolves dealt items first? |
| `player-pick.draft.startsOn`, `.skippable` | `true`, `false` | Is dealing a hand the standard setup, and may the table pick freely instead? |

Variable turn order always opens with the chosen lead's seat on top of the players' list.

## Running it with agents

- Scale agents to the work: a small config can be one primitive agent plus you. For larger games fan out by step: research and brief, one agent per independent primitive, config, rules suite, prototype. Each in its own worktree branched from the integration branch, each with a distinct Playwright `PORT`, never 3000
- Brief every agent with the guard rules, test style, its port, the files other agents own, and where to save evidence
- Merge as each lands; run guards and the full suite after every merge
