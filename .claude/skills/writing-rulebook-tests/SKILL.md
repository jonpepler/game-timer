---
name: writing-rulebook-tests
description: Use when a Game Timer game's rules are agreed and its config or primitives are about to be built or changed, or when someone suggests adding a game's tests after the build or "for coverage"
---

# Writing rulebook tests

## Overview

The suite is the rulebook's agreed rules, executable. Each test is one cited rule, played the way the table plays it, and it fails before the build.

## Recipe

- **Source:** the agreed rules list from `agreeing-game-rules`. One test per represented rule; nothing outside the list
- **Title:** the citation and the rule, e.g. `p.7 "turn order": least money spent goes first next round`
- **Location:** game-scoped folders only, `e2e/games/<game-id>/` and `src/state/definitions/<game-id>/`. The vocabulary guard exempts them, so game terms are allowed here and nowhere else
- **Style:** Kent C. Dodds. Drive the UI as a player would: `getByRole`, real taps, assertions on what is visible. No `act()` or `cleanup()` abuse, no reducer calls standing in for taps in e2e
- **Helpers:** put label-dependent steps behind helpers (`e2e/games/railways/railways.helpers.ts` is the model)
- **Red first:** run the suite before building and keep the failure output. A rule test that passes before the build is testing the wrong thing; fix it
- **Primitives:** new generic primitives also get generic-fixture unit tests in core, test first. Those use no game terms

## Rationalisations

| Thought | Reality |
|---|---|
| "Tests at the end, for coverage" | Tests written after only describe what was built. Red first is the same time and catches the off-by-one before game night |
| "Reducer tests are enough" | The table taps buttons. Rule tests drive the UI |
| "Titles can describe behaviour" | Without a page cite nobody can check the rule against the book |
| "e2e/<game>.spec.ts is fine" | `e2e/games/<game-id>/`; elsewhere the guard flags the game's words |

**Next:** once the suite runs red for the unbuilt parts, invoke `building-a-game-config` and no other skill.
