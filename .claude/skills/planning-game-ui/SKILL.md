---
name: planning-game-ui
description: Use when agreed Game Timer rules or primitives need something on screen, before writing any component, or when deciding whether an interaction needs a new component or fits one that already exists
---

# Planning game UI

## Overview

Most of a new game's UI already exists. Find it first, then put real options in front of the user for what is genuinely new. Configs declare semantic identity (labels, colours, symbols, type style tokens, name parts); the framework decides where and how they render.

## Steps

1. **Inventory.** For each agreed primitive, a table row: interaction, existing surface that carries it (read `src/components/`, the UI kit in `src/components/ui` (import from `@/components/ui`), `src/app/timer/page.tsx` and `src/app/companion/page.tsx`), gaps. Prefer kit components and existing prompts over new ones
2. **New pieces.** For each gap, 2-3 options with tradeoffs, generic names, and how a tap avoids advancing the turn (stop propagation or `setPreventClickCapture`)
3. **Companions.** Every host action is reachable from a companion through the shared command path. Note where each option renders there
4. **Prototype.** Local HTML, numbered options for identity and presentation and for every new interaction. Always runs: a game with nothing new still gets a one-page identity prototype
5. **Review.** **REQUIRED SUB-SKILL:** `collecting-design-feedback` with `check_label: "Pick"`, one item per option. The picks file is the gate

## Guards

The UI kit (`src/components/ui`) and the design-system ratchets in `src/guards/` encode the styling rules. Do not restate or work around them: when one fails, its message says what to use instead. Run `npx vitest run src/guards`.

## Common mistakes

| Mistake | Instead |
|---|---|
| A new component for one game | A generic piece the config opts into, or an existing one |
| Presenting one plan for approval | Options per gap; the user picks |
| Describing the UI in chat | A prototype they can look at, via the review page |
| Building UI while picks are pending | Write the rulebook suite meanwhile; build after picks |

**Next:** once the review page is with the user, invoke `writing-rulebook-tests` and no other skill. The suite does not depend on the picks; the build does.
