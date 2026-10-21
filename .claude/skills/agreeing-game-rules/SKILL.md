---
name: agreeing-game-rules
description: Use when a Game Timer game or expansion has no rulebook text on disk, no cited game brief, or no user-agreed decision on which rules the timer represents and how turn order works
---

# Agreeing game rules

## Overview

The timer models a few rules of a game very precisely. This skill decides which ones, from the rulebook, with the user. Nothing here writes repo code.

## Steps and gates

| # | Step | Output | Gate |
|---|---|---|---|
| 1 | Source the rules | Rulebook text extracted to `<game-id>/` in the scratchpad, edition confirmed with the user | Source in this order: the file or link the user gave, the publisher's official PDF online, then ask. A paper-only rulebook is still sourced this way; "you know the game" is not a source |
| 2 | Game brief | `SPEC.md`: theme and vibe, components with identity (colours, symbols, logotypes), round and phase structure, what a "turn" is, who acts in what order and what changes it, end of game. Every claim has a page cite | Written |
| 3 | Rules agreement | Each timer-relevant rule, cited, marked represented or not (with why) | User confirms the list |
| 4 | Primitive map | Each represented rule mapped to an existing primitive in `src/state/gameDefinition.ts`, or a new generic primitive named for what it does, with 2-3 options and tradeoffs | User picks every option. Ask, don't default |

Steps 3 and 4 can go to the user in one message. Turn order always gets options, even when it looks obvious: in Railways the obvious model (drag to reorder) lost to the user's (share price drives order).

## Common mistakes

| Mistake | Instead |
|---|---|
| Planning from remembered rules | Step 1. Download, extract, cite |
| Checking only "the one rule that matters" | The brief covers the whole turn structure; the rule you skipped is the one that changes order |
| Announcing the turn model and starting | Options in step 4; the user's model is often simpler and different |
| Skipping identity because "it's just a timer" | The brief records it; `planning-game-ui` prototypes it |
| A game-specific primitive (`marketWipe`) | Name it for what it does (`optionalTurnAction`); game words stay in the config |

**Next:** once the user has picked every option, invoke `planning-game-ui` and no other skill.
