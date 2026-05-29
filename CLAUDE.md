# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Next.js dev server on http://localhost:3000 (served under `/game-timer` because of `basePath`)
- `npm run build` — produce a static export into `./out` (see deployment notes below)
- `npm run lint` — run `biome check` (lint + format check); `npm run lint:fix` applies safe fixes, `npm run format` formats in place. CI runs `biome ci` as a deploy gate.
- `npm test` / `npm run test:watch` — vitest unit + RTL tests (`*.test.ts(x)` co-located with source)
- `npm run test:e2e` — Playwright e2e tests against the dev server (`./e2e/`)
- `npm run test:ct` — Playwright component tests with visual screenshots (`./tests-ct/`)
- `npm run test:ct:update` — refresh component-test screenshot baselines after intentional visual changes
- Node version is pinned via `.nvmrc` (currently 24.11.0); use `nvm use` before running scripts.

## Deployment

- `next.config.js` sets `output: "export"` and `basePath: "/game-timer"`. The app is a fully static export served from GitHub Pages at `https://jonpepler.github.io/game-timer/`.
- The `.github/workflows/publish.yml` workflow builds and deploys on every push to `main`.
- Static-export implications: no server-side features (no API routes, no `next/image` loader, no runtime env). Audio assets in `src/hooks/useSounds.ts` are referenced with relative paths (e.g. `sound/next.wav`) so they resolve correctly under the `/game-timer` base path.

## Architecture

This is a single-screen board-game turn timer. The interesting logic lives in the `/timer` route (`src/app/timer/page.tsx`), which composes several hooks. Understanding how they fit together is the main thing to read multiple files for.

### The composition in `src/app/timer/page.tsx`

The timer page is the orchestrator. It wires up:

- `useTimer` — owns both an `react-timer-hook` countdown **and** a stopwatch. The countdown is initialised to the running per-turn average (starts at `initialTime = 5 * 60`). When the countdown expires, the stopwatch starts counting overtime and a red fill in the circular progress bar fades in proportional to how far over the average you are. `resetTimer()` is the core "next turn" action — it records the elapsed time, recomputes the average across all recorded turns, restarts the countdown for the new average, plays the chime, and calls `nextTurn()`.
- `useTurnCounter` — tracks total turns elapsed and remaining (`expectedTurns - turns`). Doesn't know about players.
- `useGameSetup` (modal) — collects `GameConfig` (expected turns + optional players). Opens automatically on first mount. While the modal is open, `preventClickCapture` blocks the page's global click handler so taps on the modal don't accidentally advance the turn.
- `useSounds` — preloads `sound/next.wav` and `sound/overtime.mp3` audio refs. Guarded against `typeof Audio === "undefined"` for SSR/static-export safety.

### Tap-to-advance interaction model

The whole timer container has an `onClick` that calls `resetTimer()`. This is the **only** way to advance turns — there is no explicit "next turn" button. Anything interactive layered on top (modal, footer buttons, editable fields) must either stop propagation or toggle `preventClickCapture` via `setPreventClickCapture` so a tap inside it doesn't double as a turn advance. `EditableField` already calls `onEditingChange` for this purpose.

### Player tracking

Player tracking is optional and flagged "Experimental" in the setup modal. When enabled, players are assigned to turns **round-robin** by index: `currentPlayerIndex = turns % numPlayers`. There is no concept of skipping or reordering — the system assumes one player per turn, in fixed rotation. `getPlayerStats` (in `src/utils/getPlayerStats.ts`) aggregates the recorded `times` array against this assignment to produce per-player totals/averages, which feed `PlayerArcs` (active-player indicator around the timer) and `PlayerTimeShare` (proportional bar of total time by player).

### Path alias

`tsconfig.json` defines `@/*` → `./src/*`. Use this alias for imports across `app/`, `components/`, `hooks/`, and `utils/`.
