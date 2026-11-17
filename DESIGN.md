# Huddle design system: Floodlight

The box on the coffee table and the phone in your hand are one product. This file is the source of
truth for how both look and move. Tokens live in `packages/shared/tailwind-preset.cjs`; shared
components, fonts and motion CSS live in `packages/ui` (`@huddle/ui`). Review the kit live at
`/box/?fixture=kit`.

## 1. Idea and atmosphere

**A night match, watched in a dim living room.** The interface is the stadium's broadcast package,
not a dashboard: dark, quiet chrome, big condensed numbers, and colour only where money is. The one
lit thing on screen is the thing you can act on now, like a floodlight on the pitch.

- **The split.** Every market is one bar: outcomes side by side, each as wide as the room thinks it
  is likely. YES is blue, NO is orange. Odds moving means the seam moving. The result floods the bar
  with the winner's colour. This single shape carries the product on both screens.
- **The ring.** The box has a WS2812 LED ring. The mark, the lock countdown and the "connecting"
  spinner are that ring: a circle of pixels. When time runs out, the pixels go dark one by one.
- **Calm chrome, loud moments.** Most of the time the screen is still. When a moment market opens,
  a broadcast wipe crosses the stage; when it locks, the padlock stamps in; when it settles, the
  winner's colour floods out. Nothing else competes.
- Sentence case everywhere. No tracked uppercase micro-labels, no pills on everything, no card soup.
  Group with space and hairline rules first; use a filled panel only when something floats or is
  the hero.

## 2. Colour

One cool-neutral family (`night`), warm white text (`chalk`), **one accent** (`flood`), and the
D14 colour-blind-safe pair for outcomes. Never red vs green. Every YES/NO colour is paired with a
label, an icon (▲ ✓ for up/win, ▼ ✕ for down/loss) or both.

| Token | Hex | Role |
| --- | --- | --- |
| `night-950` | `#08090B` | Page background (never pure black) |
| `night-900` | `#0E1013` | Raised fields: panels, sheets, the hero stage |
| `night-850` | `#13161A` | Wells inside panels |
| `night-800` | `#181C21` | Resting controls, inputs |
| `night-700` | `#232830` | Hairline rules, dividers, unlit ring pixels |
| `night-600` | `#343B45` | Strong rules, disabled fills |
| `night-500` | `#535C68` | Disabled text only |
| `night-400` | `#87909B` | Muted text (about 6:1 on 950) |
| `night-200` | `#CED3D8` | Secondary text |
| `chalk` | `#F4F2EC` | Primary text, brightest surfaces, urgent countdown |
| `flood` | `#FFE27A` | **The accent.** Primary action fill (with `flood-ink` text), focus ring, lit ring pixels, "now", the room's own number on the scorecard |
| `flood-ink` | `#1A1505` | Text on flood |
| `yes` | `#4CB8FF` | YES / up / win. `yes-deep #0C2638` tint, `yes-ink #03131F` text on yes |
| `no` | `#FF8A2B` | NO / down / loss. `no-deep #2E1707` tint, `no-ink #1F0D00` text on no |
| `other` | `#C8C1B2` | 3rd+ outcomes on categorical markets, always drawn **hatched** (`hd-tone-other`) |
| `live` | `#FF4D5E` | The broadcast LIVE dot only, always next to the word "Live" |

Rules
- Model and Gemini are **not** colours. They are neutrals (`night-200`/`night-300`) with labels and
  shapes (solid ▼ = Model, hollow ▽ = Gemini) wherever they appear.
- Outcome tones by position (`toneFor(index, count)`): 1st `yes`, last `no`, middle ones `other`
  hatched. Binary markets are always blue/orange.
- Up/down for prices uses the same pair: a price that rose flashes `yes-bright` and shows ▲; a
  price that fell flashes `no-bright` and shows ▼.
- Flood is scarce. One flood element per view at rest (the primary action or the countdown), not
  both competing. Never use flood for YES/NO, for errors, or for decoration.
- Errors and warnings: `chalk` text on a `no-deep` field with a warning icon and a fix. Never
  colour-only.
- Legacy names (`pitch-*`, `volt`, `up`, `down`, `gemini`, `model`) still compile and map onto these
  colours. New code uses the new names.

## 3. Typography

Two families, bundled offline (`import '@huddle/ui/fonts'`):

- **Archivo Variable** (`font-display`), weight 100 to 900, width 62% to 125%. Numbers, scores,
  odds, countdowns, questions, the wordmark. Always `tnum` (tabular figures) for anything that
  changes or lines up. Width is a design tool: condensed (`stretch-condensed`, 75%) for big
  numbers and headlines, semi (`stretch-semi`, 87.5%) for questions, wide (`stretch-wide`) for the
  party code and the wordmark. Weights: 800 for numbers, 700 to 800 for questions, 600 for labels.
- **Atkinson Hyperlegible Next Variable** (`font-sans`), weight 200 to 800. Everything people read:
  names, captions, buttons, explanations. Designed for low vision; it is why captions read at 3 m in
  a dim room. Weights 400 body, 600 emphasis and buttons, 700 names on the box.

Scale (one set of tokens; rem). The phone has 1rem = 16px. The box scales rem with the viewport
(`font-size: min(1.5625vw, 2.6667vh)`): 16px at 1024x600, about 28.8px at 1920x1080.

| Token | rem | Phone px | Use |
| --- | --- | --- | --- |
| `text-cap` | 0.8125 | 13 | Fine print only. Never on the box. |
| `text-small` | 0.9375 | 15 | Secondary lines, timestamps |
| `text-body` | 1.0625 | 17 | Body, list rows |
| `text-lead` | 1.25 | 20 | Captions, emphasis, box body minimum |
| `text-title` | 1.625 | 26 | Section titles, names on the box |
| `text-head` | 2.25 | 36 | Questions |
| `text-display` | 3.5 | 56 | Odds on cards, scores |
| `text-hero` | 5.5 | 88 | Hero odds, result |
| `text-giant` | 8.5 | 136 | Box countdown and result word |

Rules
- Box minimum is `text-lead` for anything a person in the room needs; `text-body` only for host-only
  controls. Odds, the question and the countdown are `text-head` or larger.
- Headlines: `text-balance`. Paragraphs: max 60ch, `text-pretty`.
- Labels are sentence case at normal tracking. If something needs to whisper, use `night-400` and a
  smaller size, not uppercase + tracking.
- `…` not `...`, curly quotes, `&nbsp;` between a number and its unit where it could wrap
  ("10&nbsp;pts").
- Money: keep the apps' formatting helpers (`formatUsd`, `moneyShort`); points mode shows "pts",
  never "$". Odds: always through `pctText` / `payoutText` from `@huddle/ui` (they handle missing
  prices, 0, 1, "<1", ">99" and "100+" payouts; never print a bare "%").

## 4. Layout and spacing

- 4px base grid (Tailwind spacing). Rhythm: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Radii are tight and varied: `rounded-chip` 6px (bars, chips, small buttons), `rounded-tile` 12px
  (controls, list rows), `rounded-panel` 18px (sheets, the hero stage). Inner radius smaller than
  outer.
- **Box** (1024x600 design, scales to 1920x1080, always fills the screen, no scroll on the board):
  a CSS grid with fixed rows: scorebug bar (3.75rem) / stage (1fr) / rail (leaders + trades, 3rem)
  / caption bar (3.25rem). Host controls are a **dock that pushes the stage**, not a sheet that
  covers it. The stage always has a job: a moment market, the game-long markets, or the idle
  "next moment" view with the join code.
- **Phone** (390 wide design, one-handed, 44px+ targets, thumb zone at the bottom): single column,
  max width 36rem centred on laptops. Fixed header (score + balance), content, bottom tab bar with
  the TALK button above it. Respect `env(safe-area-inset-*)`.

## 5. Elevation and surfaces

Depth is tone, not shadow: 950 page, 900 raised, 850 wells, 800 controls. Hairlines `night-700`
separate groups. `shadow-float` only on things that float over content (sheets, toasts, the talk
overlay). `shadow-flood` only on the single primary action when it is the one thing to do. No glow
on resting cards, no glassmorphism, no gradients except the broadcast wipe and the shine.

## 6. Motion

Motion says one of four things: **money moved**, **the moment opened**, **the moment locked**,
**the result landed**. If an animation does not say one of these, it should be a short fade or
nothing.

Tokens (CSS variables in `@huddle/ui/styles.css`, Tailwind `duration-*` / `ease-*`, and `DUR` /
`EASE` / `SPRING` in `@huddle/ui`):

| Token | Value | Use |
| --- | --- | --- |
| `instant` | 90ms | Press feedback |
| `quick` | 160ms | Hover, small state changes |
| `base` | 240ms | Panels, fades |
| `slow` | 420ms | Entrances, stamps |
| `linger` | 700ms | Split seam, bars |
| roll | 560ms | Digit roll |
| `ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrances, numbers settling |
| `ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | Exits, draining |
| `ease-snap` | `cubic-bezier(0.85, 0, 0.15, 1)` | The lock |
| `ease-swing` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | Stamps (win amount, score) |
| `SPRING.reorder` | stiffness 520, damping 42 | Leaderboard and lobby reorders (framer `layout`) |

**Fail-safe rules (non-negotiable; both bugs below shipped before):**
1. The resting style is the final state. Animations only describe the journey (`from` keyframes).
   Anything that starts invisible is a CSS animation (`hd-rise`, `hd-fade`, `hd-pop`, `hd-stamp`),
   which is time-based and finishes even in a background tab. Never `initial={{ opacity: 0 }}` on
   framer for primary content.
2. **Never gate content on an exit animation.** No `AnimatePresence mode="wait"` around screens or
   tab content: its exit sometimes never completed and the phone stayed on the markets list after
   the final whistle instead of showing the payout (fixed on main in `apps/player/src/screens/Live.tsx`).
   Swap screens by key with an entrance only.
3. Do not unmount a confirmation because the data it confirms arrived: the "You're in!" buy-in
   confirmation (`buy-in-done`) stays until the player moves on (fixed on main in
   `apps/player/src/screens/Party.tsx`).
4. `prefers-reduced-motion`: every `hd-*` class has a reduced variant (instant, or hidden if purely
   decorative). framer: wrap the app in `<MotionConfig reducedMotion="user">` (the box does) and use
   `useReducedMotion()` from `@huddle/ui` for anything custom.
7. Celebrations never cover live betting: the box drops queued result reveals the moment a new
   moment market opens, and holds at most two. The phone should do the same with its result sheets.
5. Animate `transform` and `opacity` only (the variable-font width of the countdown is the one
   deliberate exception, on a single element). List transition properties; never `transition: all`.
6. Motion never blocks input. Nothing waits for an animation before accepting a tap.

Named product motions (use these names in code and reviews):

| Name | What | How |
| --- | --- | --- |
| **odds-roll** | A price changes | `<Pct>` / `<Roll>`: each digit rolls on a 0-9 strip (560ms, ease-out, 28ms stagger right to left), the number flashes the direction colour for 1.1s and a ▲/▼ appears for 1.1s |
| **seam-glide** | Friends pile in | `<SplitBar>` layers scale and the seam translates (700ms, ease-out) |
| **takeover-wipe** | A moment market opens | The stage swaps to the takeover; a floodlight band sweeps across it (`hd-wipe`, 760ms), the question rises in (`hd-rise`, 420ms, 120ms delay), the outcomes follow (+80ms each) |
| **ring-drain** | Lock countdown | `<LockRing>`: one pixel goes dark per 1/24 of the window; the seconds condense from 100% to 62% width as time runs out |
| **last-call** | Final 5 s | Pixels and number turn chalk, the ring throbs once a second, the number stamps each tick (`hd-beat`), the LED ring goes `locking` |
| **lock-snap** | Market locks | Padlock + "Locked" stamp in (`hd-snap`, 320ms, ease-snap), a one-off flash over the stage (`hd-flashout`), the split desaturates to 60% |
| **result-flood** | Result lands | The winning colour floods the bar from the seam (`hd-flood`, 900ms), the losing side drains to 18% (`hd-drain`), the result word stamps in (`hd-stamp`) |
| **floodlight-shine** | You (or a friend) won | A warm light sweeps across the winner's name and amount (`hd-shine`), the amount stamps in. Not confetti. |
| **money-flow** | Buy-in, payout | Coins (`hd-coin`) travel from the player to the pot (buy-in) or from the pot to the player (payout) while both numbers roll |
| **board-reorder** | Leaderboard changes | framer `layout` with `SPRING.reorder`; the row that moved up flashes ▲ |
| **led-breathe** | Mirror of the engine's `led` patterns | On the box, the screen edge glows with the engine's pattern (idle breathe, join flash, market-open pulse, locking blink, win/loss/goal) |

## 7. Components

Shared (`@huddle/ui`):
- `Roll`, `Pct`, `DirArrow`: rolling numbers with direction flash; screen readers get the final
  text once.
- `SplitBar`, `SplitMarkers`, `MarkerShape`, `toneFor`: the split and the Model/Gemini notches.
- `LockRing`: the countdown ring (`open`, `urgent`, `locked`, `manual`).
- `Mark`, `Wordmark`: the LED-ring mark and lowercase wide "huddle".
- `Icon`: one 24px, 2px-stroke icon set; solid ▲▼ for direction.
- `pctText`, `pctLabel`, `payoutText`, `multiplierText`, `normalise`: total odds formatting.
- `DUR`, `EASE`, `SPRING`, `useReducedMotion`, `useReplayClass`, `useDirection`.

Patterns (build these in each app with the tokens):
- **Primary button**: `bg-flood text-flood-ink`, Atkinson 700, sentence case, 56px tall on the
  phone, 3.5rem+ on the box; hover brightens to `flood-bright`; press scales to 0.98 for 90ms;
  focus-visible 3px flood ring offset 3px; disabled `bg-night-700 text-night-500`. Label says what
  happens ("Buy in 10 pts", "Start game", "Take it", "Cash out $3.40").
- **Secondary button**: `bg-night-800 text-chalk` with a `night-600` hairline; same states.
- **Outcome button** (phone): the outcome's tone as a 4px left rule + a `*-deep` tint field, label
  (Atkinson 700) and the odds (`Pct`, Archivo 800) on one line; selected = solid tone fill with ink
  text and a ✓. Long labels wrap to two lines; on 3+ outcomes stack vertically, never squeeze side
  by side.
- **Stake chips**: a row of `rounded-tile` chips, Archivo 800 tnum, 48px tall; the chosen one fills
  flood.
- **Market card** (phone): question (Archivo 700, semi width, `text-title`), the split, outcome
  buttons, lock status at the top right (mini `LockRing` or "Locks at 80'"). No card border; a
  `night-900` field with 18px radius. State is visible in text ("Open", "Locked", "Settled: Yes").
- **Captions**: one line at a time, in a fixed slot above the tab bar that never covers the market
  cards or the mic button. A new line replaces the old one (crossfade); no stacking toasts. Full
  history lives in a tab.
- **Toasts** (box): top centre, one at a time, `night-800` with an icon; errors on `no-deep` with
  a fix in the text. `aria-live="polite"`.
- **States**: loading = the ring spinning (`<Mark spin>`) + "Joining the party…"; empty = a
  composed line that says what will happen next ("The next question drops on the next big
  moment"); error = what happened + what to do + a retry button; reconnecting = a slim bar at the
  top ("Reconnecting… your bets are safe") that never hides content.

## 8. Responsive and accessibility

- Box: fills 1024x600 and 1920x1080 exactly; no scroll on the board; test both.
- Phone: 360 to 430 wide primary; laptop shows the same column centred. Touch targets >= 44px,
  primary actions >= 56px, in the bottom half.
- Contrast: text >= 4.5:1 (chalk on night-950 is 17:1, night-400 is about 6:1). Never information by
  colour alone.
- Focus: `:focus-visible` ring in flood on every interactive element; sticky bars never cover the
  focused element.
- Live regions: captions and toasts `aria-live="polite"`; the countdown is `role="timer"` with
  `aria-live="off"` (the announcer calls "Five seconds!").
- `color-scheme: dark`, `theme-color #08090B`, no zoom blocking on the phone.

## 9. Do and don't

Do
- Let one thing be lit per moment. Use size and the flood accent for hierarchy, not boxes.
- Put the number first and the label second; numbers are Archivo tnum.
- Say what happens in buttons; say what to do next in errors.
- Keep the words human: "Buy in", "Cash out", "Take it", "Called it", "Cooked". Never "sign
  transaction", "wallet", "on-chain" on the main screens.

Don't
- No uppercase tracked micro-labels, no pill on every value, no bordered card around every block.
- No lime, no purple/pink series colours, no gradients for decoration, no glow on resting cards.
- No confetti; the celebration is the floodlight shine.
- No `AnimatePresence mode="wait"` around content, no JS-driven fade-in on primary content.
- Never print an empty or broken number: missing price shows "–", tiny "<1%", long shots "100+".

## Test hooks

The Playwright e2e selects only by `data-testid` (full list in `e2e/README.md`). Every hook there
must stay on an element with the same meaning and attributes through any redesign.
