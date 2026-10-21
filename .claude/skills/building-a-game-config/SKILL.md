---
name: building-a-game-config
description: Use when a Game Timer game's rulebook suite is written and failing and its primitives, config JSON and UI are ready to be built, or when a built game config needs evidence for user review
---

# Building a game config

## Overview

Make the red suite green without teaching the framework about the game. Order matters: primitives, then config, then UI, then evidence.

**REQUIRED SUB-SKILL:** `superpowers:test-driven-development` for every primitive.

## Order

1. **Primitives.** Generic names, Zod schema in `src/state/gameDefinition.ts` (never `as X` on ingested JSON), unit tests with generic fixtures
2. **Config.** `src/state/definitions/<game-id>/` JSON with `gameSpecificTerms`, registered in `src/state/definitions/index.ts`. Presentation stays with the framework: the config declares identity, never layout
3. **UI.** Only what the user picked in `planning-game-ui`; with picks still out, stop before this step and say so. Reuse the kit components in `src/components/ui` (import from `@/components/ui`); config labels follow the sentence-case rule in CLAUDE.md. Every host action goes through the shared command path so companions can do it too; check it on a companion page
4. **Guards.** `npx vitest run src/guards` after every step. A failure message names the fix; follow it. When a count drops, ratchet the baseline down with the commands in CLAUDE.md
5. **Green.** Rulebook suite, `npm test`, `npm run lint`, full `npm run test:e2e`
6. **Evidence.** Screenshots and Playwright videos of each rule and new interaction, phone 390x844 touch and desktop
7. **Review.** **REQUIRED SUB-SKILL:** `collecting-design-feedback`, one item per rule or interaction, `check_label: "Pass"`

## Common mistakes

| Mistake | Instead |
|---|---|
| Game words in core code or a bespoke UI for one game | A generic primitive the config opts into |
| A bespoke peer message for a new action | The shared command path |
| Editing a baseline to make a guard pass | Fix the violation; baselines only shrink |
| Calling it done at green tests | The review page, then iterate on feedback |

**Next:** after the feedback JSON comes back, route each failed item to the skill that owns it: a wrong rule to `agreeing-game-rules`, a wrong look to `planning-game-ui`, a bug to step 1 here with a failing test. The game is done when every item passes.
