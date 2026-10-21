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

Player tracking is optional. Who acts is decided by the definition's `turnOrder` (see `TurnOrderSchema` in `src/state/gameDefinition.ts`):

- Absent / `round-robin`: active seat is `turns % numPlayers`
- `lead-relative`: active seat is relative to a movable lead (Arcs)
- `variable`: explicit, reorderable lists of turn entries (players and/or definition-declared entries with a `kind`), with optional phases choosing which list runs and a running average per phase. Logic lives in `src/state/turnLists.ts`; the expanded score view (`TurnOrderList`) has drag handles. Generic offers it as a setup choice via `turnOrder.selectable`. With 2+ phases the timer shows `PhaseBar` above the ring (always rendered, so it never shifts the ring) and `PhasePrompt` when a phase is ended or a `prompt-phase` list wraps. Entries and phases can carry `module` / `requiresToggle` gates, resolved at game start by `turnOrderForSetup`. A reorder before a phase's first turn changes who opens it; after that it never changes who is active
- Value-ordered lists (`lists[].orderBy: "value"` plus `turnOrder.entryValues`): each entry carries a value on a declared track, the list sorts by it (an arrival goes below its equals, except a `joinsAtTop` kind, which takes the list's highest value above its equals), there is no drag, each entry plays once per phase visit (a played row's token is turned face down, and the row is announced as played) and the phase ends when all have played. Phases may ask for a value step at turn end (`valueStepOnTurnEnd`; steps can be gated by `module` / `requiresToggle`, headed by `entryValues.stepsLabel`), limit who acts (`kinds`), repeat by default (`repeat`, counted per cycle, which restarts on returning to the first phase) and ask an `exitPrompt`. `turnOrder.combine` merges entries through a stepped sheet (sources, target, owner, check), each step's heading from `combine.steps`. When every charted entry has a token, the value chart is compact: no axes or names, tied entries' tokens stacked (`TokenStack`) with their value once, and the time share sits over its fill-only bottom strip. `useTurnEntryControls` owns the prompts and sheets layered over the timer. Every variable-order action is undoable through `undoStack` snapshots; actions sharing an `undoGroup` id store one snapshot, and each prompt or sheet flow dispatches under its own group (`inUndoGroup` in `useTimer`), so one undo takes back the whole flow

Each `TurnRecord` stores the `playerIndex` it was attributed to, and `getPlayerStats` aggregates those recorded values (never the modulo), feeding `PlayerRing` and `PlayerTimeShare`.

### Path alias

`tsconfig.json` defines `@/*` → `./src/*`. Use this alias for imports across `app/`, `components/`, `hooks/`, and `utils/`.

## Framework and game configs

Game Timer is a framework that exposes an API; each game is a config under `src/state/definitions/<game>/` that implements it. The framework never has game context:

- No concept from a real game may appear outside its config: not in identifiers, types, reducer actions, peer messages, CSS classes, comments, UI strings or core test names. Core tests use generic fixtures; tests about one game live beside its definition (e.g. `src/state/definitions/root.test.ts`)
- Configs supply content (labels, nouns, rules data) through schema-declared fields, never through fields read with a cast, and never decide UI presentation
- Built-in games are listed in `src/state/definitions/index.ts`, the only place that names them

Each definition declares `gameSpecificTerms`: the words of its own vocabulary (piece names, unique mechanics, the game's name). Leave out generic board-game words such as round, turn, phase, player, lead, score, setup, card or colour.

Two guard tests in `src/guards/` enforce this:

- `gameSpecificTerms.guard.test.ts` scans `src/**` (ts, tsx, css, json) and the non-spec e2e helpers for any built-in definition's terms, matching camelCase, PascalCase, snake and kebab parts and simple inflections, so `seizedNextLead` matches `seize`. Definitions, e2e specs and the guard folder are exempt. Report format is `file:line: term`
- `emDash.guard.test.ts` scans all of `src/**` and `e2e/**` for em-dashes, and for en-dashes used as dashes (an en-dash between two numbers is a range and allowed)

Both compare against a committed baseline (`src/guards/*.baseline.json`, counts per file and term) of violations that predate the guards. A test fails on any count above its baseline, and also when a count drops below it, so fixes are locked in. After removing violations, tighten the baseline with:

- `UPDATE_VOCAB_BASELINE=1 npx vitest run src/guards`
- `UPDATE_EMDASH_BASELINE=1 npx vitest run src/guards`

Baselines may only shrink. The update refuses to write while there are new violations; fix them instead of editing the baseline by hand.

## Design tokens and UI guards

Everything a theme may change is a token in `src/app/globals.css`: colour (`--color-*`, including status tones with `-tint` and `--color-on-*-tint` pairs, `--color-on-light`/`--color-on-dark` for text on a player colour, `--color-chart-*`), elevation (`--elevation-backdrop`, `-backdrop-blur`, `-raised`, `-overlay`, `-drop`, `-drop-sm`), faces (`--font-body`, `--font-display`, `--font-numeric`, `--font-mono`) and weights (`--font-weight-*`), spacing (`--space-*`), type (`--font-size-*`, `--line-height-*`, `--letter-spacing-label`), corners, control and disc sizes (`--control-height-*`, `--disc-size-*`, `--icon-size-*`), focus (`--focus-ring-*`), layers (`--z-*`) and motion (`--duration-*`, `--ease-*`). Stylesheets and inline styles read them; they do not write literals. Per-game themes override tokens only, so a literal is a spot a theme cannot reach.

Corners are named for what the element is, not its size: `--radius-control` (a button or selectable row), `-field`, `-chip`, `-badge`, `-panel`, `-sheet`, `-chrome` (the header bar), `-tooltip`, `-bar` (a data bar), `-icon-button` and `-disc`.

Pages never name a face. Numbers the table reads (the timer, scores, values) use `--font-numeric` with `font-variant-numeric: tabular-nums`; it defaults to the body face, and a theme that sets it must pick a face built for figures. `--font-mono` is for codes and logs only.

### The UI kit

Controls come from the kit in `src/components/ui`, imported from `@/components/ui`:

- `Button` (primary, secondary, ghost, danger; sm 36px, md 44px, lg 56px; optional leading `icon`) and `ButtonLink` for navigation that reads as an action. Primary is the one main action of a prompt or setup screen, never on the timer screen; the turn and round controls are secondary md
- `IconButton`: a glyph with a required `label`, md 44px or lg 56px, tone outline, filled or plain, round in the page or square in the header bar, with a tooltip (off with `tooltip={false}` inside a scrolling list)
- `Chip` (a value to pick, always `pressed`), `ChipRow`, and `Segmented` for switching views
- `ListRow`: a full-width selectable row with a `lead`, `label`, `hint` and `trailing` value; an entry colour is its `color` (the whole border). `layout="adaptive"` inside a `ChoiceGrid` makes it a tile on a wide screen, for a prompt with several weighty choices
- `Toggle`: a checkbox or radio in a framed row
- `Sheet` and `Prompt`: one frame for everything that floats over the page (a bottom sheet on a phone, a centred card on a wide screen), with a centred title, actions pinned below a scrolling body, Escape for the newest sheet, a focus trap and focus returned on close. `Prompt` is the alert-dialog flavour for a question the table must answer. `StepSheet` asks one decision per step (Back, Next, then a finish action) when a single sheet would grow too long. `Backdrop` is the bare full-screen layer for a hero moment that draws its own content
- `Heading` (h1 to h3; `size` only where the outline and the visual rank differ), `SectionLabel` (the uppercase eyebrow, as a legend, label or heading), `Badge` (a sentence-case status mark), `Disc` (a colour identity, sm, md or lg), `VisuallyHidden`
- `Field`, `SelectField`, `ColourField`, and `Stepper` (compact in setup and lists, wide for scoring)

Every kit control stops its click from reaching an ancestor, so none can advance a turn. To add a component: put it in `src/components/ui` with a co-located test (user-driven, by role), style it with tokens only, export it from `src/components/ui/index.ts`, and if it draws a new form add that shape to `SHAPES` in `duplicatePrimitives.guard.test.ts` with the component as its `kit`. The shadowed-primitives guard reserves every name the kit exports. Do not restyle a kit component at a call site beyond layout (width, margins, alignment); a different look is a kit variant.

### Letter case

App copy is sentence case everywhere: buttons, titles, labels, tooltips ("Start game", "Show turn order", "Seize the initiative"). The rulebook's proper nouns keep their capitals: round and phase names, products and expansions, named pieces and characters ("End Stock Round", "Leaders & Lore"). Config authors follow the same rule for every label a definition supplies: an action or a setup step is sentence case; a name from the rulebook keeps the rulebook's capitals. Section labels are written in sentence case and drawn uppercase by `SectionLabel`.

### Guards

Five guards in `src/guards/` hold this, and their failure messages say what to use instead:

- `designTokens.guard.test.ts`: no new literal spacing, font size, line height, radius, z-index, motion or font-family (`UPDATE_TOKENS_BASELINE`). The only literals left are choreographed animation timings, each commented at its call site
- `rawColour.guard.test.ts`: no hex, `rgb()` or `hsl()` in stylesheets or `.tsx` (`UPDATE_COLOUR_BASELINE`); the baseline is empty
- `duplicatePrimitives.guard.test.ts`: no class outside the kit that redraws a kit form (icon button, pill button, solid or outline button, list-row button, section label, overlay), detected by CSS shape, not by name (`UPDATE_PRIMITIVES_BASELINE`); the baseline is empty
- `tokenRefs.guard.test.ts`: every `var(--x)` without a fallback names a declared property
- `shadowedPrimitives.guard.test.ts`: no component outside `src/components/ui` takes a kit name
