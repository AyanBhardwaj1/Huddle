# Huddle design system: Kickoff

The box on the coffee table and the phone in your hand are one product. This file is the source of
truth for how both look and move. Tokens live in `packages/shared/tailwind-preset.cjs`; shared
components, fonts and motion CSS live in `packages/ui` (`@huddle/ui`). Review the kit live at
`/box/?fixture=kit` and every box state at `/box/?fixture=<kind>` (kinds in `apps/box/src/lib/config.ts`).

Kickoff replaced round one ("Floodlight", dark and quiet) after the verdict: lighter, more vibrant,
more animation, gamey, but the market itself stays serious. Section 10 maps every Floodlight token
to its Kickoff name so code still on round one can be re-skinned mechanically.

## 1. Idea and atmosphere

**Game night with the lights on.** A bright lilac-white room, white cards that float on soft indigo
shadows, one electric violet accent, and the brand gradient (violet, magenta, pink) for the big
moments. It should feel exciting the second it loads.

- **Playful chrome, serious money.** The fun lives in the chrome, the transitions, the
  celebrations and the people (avatars, confetti, chunky buttons that squish). The money and the
  odds are presented like a real trading product: tabular numbers, exact prices, "1 pt pays 1.37"
  before you bet, a price history per market, Room vs Model vs Gemini as numbers, trades with the
  price they filled at. Never cartoonish about money.
- **Outcomes are game tiles.** On the box a moment market is two (or more) solid tiles: YES in
  electric blue with white text, NO in tangerine with ink text, each with its label, its rolling
  price and its payout. The split bar under them is the room's opinion; the seam glides on a spring.
- **The ring.** The box has a WS2812 LED ring. The mark, the lock countdown and the connecting
  spinner are that ring. Lit pixels walk the brand gradient; the countdown pixels go dark one by
  one and turn hot pink in the last five seconds.
- **Every word arrives.** Questions, headlines and captions rise in word by word on a spring
  (`Kinetic`). Every number rolls (`Roll`, `Pct`).
- Sentence case everywhere. No tracked uppercase micro-labels.

## 2. Colour

Tokens (Tailwind names; CSS mirrors are `--k-*` in `@huddle/ui/styles.css`):

| Token | Hex | Role |
| --- | --- | --- |
| `canvas` | `#F4F3FA` | The page (cool lilac-white). `canvas-deep #EAE8F4` for docks and inset fields |
| `card` | `#FFFFFF` | Raised surfaces: cards, sheets, the stage, chips. `card-tint #FBFAFF` |
| `well` | `#ECEAF5` | Wells and tracks inside cards (split track, bar backgrounds) |
| `control` | `#E4E1F1` | Resting inputs, disabled button fill; `control-hover #D9D5EB` |
| `rule` | `#DCD9EA` | Hairlines, unlit ring pixels; `rule-strong #C4C0D8` input rings |
| `ink` | `#14123A` | Primary text (16:1 on canvas). Also the "dark chip" (caption bar, #1 on the rail, toasts) |
| `ink-2` | `#4A4770` | Secondary text (7.9:1) |
| `ink-muted` | `#6B6890` | Muted text (4.8:1 on canvas, 5.2:1 on card) |
| `ink-faint` | `#8A86AA` | Disabled text only |
| `zap` | `#6C2BFF` | **The accent.** Primary action fill (white text, 6.1:1), focus ring, lit ring pixels, "now", the room's own number. `zap-bright #8A55FF` hover, `zap-deep`, `zap-50/100/200` tints |
| `prime` (gradient) | `#6C2BFF → #B22BFF → #FF2E93` | Brand moments only: hero buttons (`btn-prime`), the join panel, the moment-market badge and ribbon, the room's scorecard bar, #1 on the podium. White text, large and bold only |
| `yes` | `#1468FF` | YES / up / win fill, white text on it (4.7:1). `yes-600 #0B57E6` for blue text on light (5.6:1), `yes-50/100/200` tints |
| `no` | `#FF6B00` | NO / down / loss fill, **ink** text on it (6.3:1). `no-600 #C24A00` for orange text on light (4.9:1), `no-50/100/200` tints |
| `sun` | `#FFC83D` | 3rd outcome on categorical markets, always hatched (`hd-tone-other`); ink text; `sun-600 #8A5F00` text |
| `lilac` | `#B9A8FF` | 4th+ outcome, hatched the other way (`hd-tone-other-alt`); `lilac-600 #5B46C7` text |
| `hot` | `#FF2E63` | The LIVE dot and the last five seconds only (ring, "Last call", urgent edge). Errors use a `hot-50` field with a `hot` ring and `hot-600` text plus an icon |
| `gold` | `#FFB020` | Money moving: coins, the pot dot, the winner's crown, big-trade ring, paid rows (`gold-50`) |

Rules
- YES/NO is blue vs orange (D14), never red vs green, and always paired with the label, an icon
  (▲ ✓ up/win, ▼ ✕ down/loss) or both. Coloured text on light surfaces uses the `-600` shades.
- Outcome tones by position (`toneFor(index, count)`): 1st `yes`, last `no`, middle `sun` / `lilac`
  hatched. Binary markets are always blue/orange.
- Model and Gemini are not colours: ink, with shapes (solid ▼ Model, hollow ▽ Gemini) and labels.
  Friends (the room) are `zap` / `prime`.
- One `zap` or `prime` primary per view at rest. Never use zap or prime for YES/NO.
- Shadows carry colour only on things that float and want to be pressed (`shadow-zap`,
  `shadow-yes`, `shadow-no`, `shadow-gold`); resting cards use `shadow-lift`, floating ones
  `shadow-pop` (indigo-tinted, light from above).
- Team colours appear on the scorebug chips and, during a moment market, as the drifting colour
  field behind the stage (`Aurora` with the home and away colours at 20% alpha).

## 3. Typography

Three families, bundled offline (`import '@huddle/ui/fonts'`):

- **Bricolage Grotesque Variable** (`font-head`), weight 200 to 800, width 75 to 100, optical size
  12 to 96 (automatic). Questions, headlines, names on the box, the wordmark, tile labels. 800 with
  `-0.025em` to `-0.045em` tracking at display sizes; `.q` = head + 800 + balance.
- **Archivo Variable** (`font-num`, legacy name `font-display`), weight 100 to 900, width 62 to
  125. Every number: odds, prices, money, scores, countdowns. Always tabular (`.num` = 800,
  condensed 75%, `tnum`). The countdown condenses from 100% to 62% width as time runs out.
- **Atkinson Hyperlegible Next Variable** (`font-sans`). Everything people read: captions,
  buttons, explanations, list rows. 400 body, 600 emphasis, 700 buttons.

Scale (rem; the box scales rem with the viewport, `font-size: min(1.5625vw, 2.6667vh)`: 16px at
1024x600, about 28.8px at 1920x1080; the phone is 16px):

| Token | rem | px @16 | Use |
| --- | --- | --- | --- |
| `text-cap` | 0.8125 | 13 | Fine print only, never on the box |
| `text-small` | 0.9375 | 15 | Secondary lines, labels on the box |
| `text-body` | 1.0625 | 17 | Body, list rows |
| `text-lead` | 1.25 | 20 | Captions, box body minimum for the room |
| `text-title` | 1.625 | 26 | Names, tile labels, section titles |
| `text-head` | 2.25 | 36 | Questions on cards |
| `text-display` | 3.5 | 56 | Odds on cards and tiles |
| `text-hero` | 5.5 | 88 | Pot, result word |
| `text-giant` | 8.5 | 136 | Reserved (scales too far for 600px tall boxes) |

Rules: headlines balance, paragraphs `text-pretty` at 60ch max; `…` and curly quotes; `&nbsp;`
between number and unit ("10&nbsp;pts"). Money through `formatUsd` / `moneyShort`; points say
"pts". Odds only through `pctText` / `payoutText` (missing "–", tiny "<1", certain ">99",
long shots "100+").

## 4. Layout and spacing

- 4px grid. Rhythm 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Radii: `rounded-chip` 8px (bars, small chips), `rounded-tile` 14px (controls, rows, tiles),
  `rounded-panel` 22px (cards, sheets, outcome tiles), `rounded-blob` 32px (the stage, the join
  panel, hero cards), `rounded-full` for pills (scorebug, rail chips, caption bar, toasts).
- **Box** (designed at 1024x600, scales to 1920x1080, no scroll on the board): a column of top bar
  (4rem: scorebug pill, join chip, controls) / optional dispute banner / stage (flex 1, a white
  `rounded-blob` card with `shadow-pop`) / rail (3rem: leader chips + trade pills) / caption bar
  (an ink pill, 3.25rem). Host controls are a dock that pushes the stage. Every screen sits on the
  canvas with an `Aurora` colour field behind it.
- **Phone**: section 9.

## 5. Elevation and surfaces

Light from above. Canvas page → white cards (`shadow-lift`) → floating things (`shadow-pop`:
stage, sheets, toasts, dock) → the one thing to press (`shadow-zap` / `-yes` / `-no` / `-gold`).
Split bars and every coloured fill carry a soft top highlight (built into `.hd-split`). Gradients
only where they mean something: the prime gradient for brand moments, the drifting `Aurora` field
on the canvas, the winner's flood. No glassmorphism except the sound gate's light blur.

## 6. Motion

Motion says one of five things: **the moment opened**, **money moved**, **the price moved**,
**the moment locked**, **the result landed**, and everything else arrives with a short spring.

Tokens (CSS variables in `@huddle/ui/styles.css`, Tailwind `duration-*` / `ease-*`, `DUR` /
`EASE` / `SPRING` in `@huddle/ui`):

| Token | Value | Use |
| --- | --- | --- |
| `--t-instant` | 90ms | Press down |
| `--t-quick` | 160ms | Hover, colour changes |
| `--t-base` | 240ms | Fades |
| `--t-spring` + `--ease-spring` | 480ms, real spring via `linear()` (~2% overshoot) | Entrances (`hd-rise`, `hd-zoom`, slides), seam glide, button release |
| `--t-bounce` + `--ease-bounce` | 820ms, spring (~12% overshoot) | Pops, stamps, kinetic words, arrows, ring pixels |
| `--t-roll` | 560ms ease-out | Digit roll (`Roll duration` overrides per use) |
| `--t-linger` | 700ms | Split seam, sparkline draw |
| `--ease-snap` | `cubic-bezier(0.85,0,0.15,1)` | The lock |
| `SPRING.reorder` | stiffness 520, damping 40 | framer `layout` reorders (rail, lobby, podium list) |

`--ease-spring` and `--ease-bounce` fall back to cubic-béziers where `linear()` is unsupported.

**Fail-safe rules (non-negotiable; both bugs below shipped once):**
1. The resting style is the final state. Keyframes describe only the journey (`from` frames).
   Anything that starts invisible is a CSS animation (time-based: it finishes in a background tab).
   Never `initial={{ opacity: 0 }}` on framer for primary content.
2. Never gate content on an exit animation. No `AnimatePresence mode="wait"` around screens or
   tabs. Swap by key with an entrance only. (Toasts keep their last frame for a 240ms exit; that
   is decorative and nothing waits on it.)
3. Do not unmount a confirmation because the data it confirms arrived (`buy-in-done`).
4. `prefers-reduced-motion`: every `hd-*` class has a reduced variant (instant, or hidden when
   purely decorative: confetti, coins, wipe, shine, aurora drift). Colour flashes still happen
   (with the arrow), without the fade. framer: the box wraps the app in
   `<MotionConfig reducedMotion="user">`; use `useReducedMotion()` for custom code.
5. Transform and opacity only for anything continuous (the countdown's variable-font width is
   the one deliberate exception, on one element). List transition properties; no `transition: all`.
6. Motion never blocks input.
7. Celebrations never cover live betting: the box drops queued result reveals when a moment market
   opens, and holds at most two. The phone does the same with its result sheets.

Named product motions (use these names in code and reviews):

| Name | What | How |
| --- | --- | --- |
| **kinetic-text** | A question, headline or caption arrives | `<Kinetic text>`: each word rises out of its own baseline mask with a 7° tilt on `--ease-bounce`, staggered 28 to 55ms; the sentence is in the DOM once for assistive tech |
| **odds-roll** | A price changes | `<Pct>` / `<Roll>`: digits roll on a 0-9 strip (560ms, 28ms stagger right to left), the number flashes the direction shade for 1.1s and a ▲/▼ pops in; on a solid tile the outcome tile kicks (`tile-kick`, scale 1.035 → 1) |
| **seam-glide** | Friends pile in | `<SplitBar>` layers scale and the seam translates on the spring |
| **price-draw** | A trade lands | `<Sparkline>` (stepped, like an order-book chart) reveals the new segment with a sliding window (transform only); the end dot pings |
| **takeover** | A moment market opens | The stage zooms in (`hd-zoom`), a prime-gradient band sweeps across it (`hd-wipe`), the badge pops, the question is kinetic, the tiles pop in 80ms apart, the split and the pros fade up; the canvas behind turns to the two team colours |
| **ring-drain** | Lock countdown | `<LockRing>`: one pixel goes dark (and shrinks) per 1/24 of the window; the seconds roll down and condense |
| **last-call** | Final 5 s | Pixels and number turn `hot`, the ring throbs and glows once a second, the number stamps each tick, the stage edge pulses hot (`urgent-edge`), the LED ring goes `locking` |
| **lock-snap** | Market locks | Padlock + "Locked" snap in (420ms, ease-snap, a small rotate), a violet flash over the stage, a white veil settles over the tiles and the split, the badge turns ink |
| **result-flood** | Result lands | The whole stage floods with the winner's colour from its own share of the split (`hd-flood`, spring), the split drains, the winner word stamps in, confetti bursts sized to the moment (`<Burst count>` 14 + 6 per caller + pot), the callers' card rises with a glint across each name (`hd-shine`) |
| **money-flow** | Buy-in, payout | Gold coins (`hd-coin`) arc from the player to the pot (or out to the player) while both numbers roll; a small gold burst over the pot on each arrival |
| **big-trade** | A trade of 5+ units | The ticker pill lands gold with a ring and a pop (`big-trade`) |
| **board-reorder** | Leaderboard changes | framer `layout` with `SPRING.reorder`; P&L rolls; the leader's chip is ink |
| **player-joined** | Someone joins | Their card pops in with a zap ring, a coin flies to the pot, the pot rolls up, the mark lights one more pixel |
| **press** | Any tap | Buttons lift 2px on hover, squish to 0.95 on press (90ms) and spring back on release (`--ease-bounce`) |
| **led-breathe** | Engine `led` patterns | The screen edge glows with the engine's pattern (idle breathe, join flash, market-open pulse, locking blink, win/loss/goal) |

## 7. Components

Shared (`@huddle/ui`; names and props are stable, additions are additive):
- `Roll` (`text`, `value`, `label`, `flash`, `arrow`, `duration`), `Pct` (`p`, `sign`, `flash`,
  `arrow`, `duration`), `DirArrow`.
- `SplitBar`, `SplitMarkers`, `MarkerShape`, `toneFor`.
- `LockRing` (`fraction`, `label`, `state`, `size`, `dots`, `caption`, `compact`): `compact`
  drops the caption, uses 16 thicker pixels and an hourglass for "locks on the play".
- `Mark`, `Wordmark`.
- `Kinetic` (`text`, `as`, `delay`, `stagger`, `replay`): kinetic type.
- `Burst` (`count`, `seed`, `colours`, `x`, `y`, `spread`, `delay`): confetti, decorative.
- `Aurora` (`blobs`): the drifting colour field.
- `Avatar` (`name`, `size`), `avatarColour(name)`: squircle with the initial, coloured from the
  name (never the YES/NO hues; every fill has a 4.5:1 text colour).
- `Sparkline` (`points`, `stroke`, `fill`, `dot`) and `useSeries(key, value, seed)`: live price
  history (seed it from fills; the box's `priceHistory(market, fills)` in `apps/box/src/lib/derive.ts`
  is the reference implementation).
- `Icon`; `pctText`, `pctLabel`, `payoutText`, `multiplierText`, `normalise`;
  `DUR`, `EASE`, `SPRING`, `useReducedMotion`, `useReplayClass`, `useDirection`.
- CSS classes: `hd-rise`, `hd-fade`, `hd-drop`, `hd-pop`, `hd-stamp`, `hd-zoom`, `hd-slide-l`,
  `hd-slide-r` (all take `--d` for delay), `hd-wipe`, `hd-flashout`, `hd-shine`, `hd-coin`,
  `hd-burst`, `hd-breathe`, `hd-float`, `hd-ping`, `hd-press`, `hd-tone-*`, `hd-sr`.

Box patterns (`apps/box/src/index.css`, `components/`):
- Buttons: `.btn-prime` (hero action: gradient, white, sheen on hover), `.btn-primary` (zap),
  `.btn-secondary` (white card, rule ring, `shadow-lift`), `.btn-quiet`, `.btn-yes`, `.btn-no`,
  `.btn-danger` (hot-50 field, hot ring). All `rounded-tile`, Atkinson 700, min 3rem tall,
  press motion built in, disabled = `bg-control text-ink-faint`.
- Outcome tile: solid tone, `rounded-panel`, label (Bricolage 800), `Pct` (Archivo, `on-fill` so
  arrows follow the text colour), payout or pool line; `lock-veil` when locked.
- Scorebug pill, join chip, leader chips (Avatar + rank badge + rolling P&L), trade pills
  ("Leo buys ▲ Yes 2 pts @ 73%"), the ink caption pill with kinetic lines, toasts as ink pills
  (errors white with a hot ring), dispute banner (white pill, hot ring, "Host decides").
- States: loading = the ring spinning with three lit pixels + a kinetic line; empty = a dashed
  rule card that says what happens next; error = what happened + what to do + retry, on `hot-50`.

## 8. Responsive and accessibility

- Box fills 1024x600 and 1920x1080 exactly; no scroll on the board (Create party's options scroll
  inside their card; its Create button is a fixed footer).
- Contrast: text 4.5:1 or better (ink 16:1, ink-2 7.9:1, ink-muted 4.8:1, white on yes 4.7:1, ink
  on no 6.3:1, white on zap 6.1:1). Large bold white on the prime gradient only.
- Focus: `:focus-visible` 3px zap outline, 3px offset, on everything.
- Live regions: captions and toasts `aria-live="polite"`; the countdown is `role="timer"` with
  `aria-live="off"`. Kinetic text puts the whole sentence in the DOM once (`hd-sr`) and hides the
  animated words from assistive tech.
- `color-scheme: light`, `theme-color #F4F3FA`.

## 9. Phone patterns (for the re-skin of `apps/player`)

The phone keeps its structure (merged on main); the re-skin is token and class work plus the
motions below. Rename with section 10, then apply this per screen.

**Shell**
- Page `bg-canvas text-ink`, `color-scheme: light`, `theme-color #F4F3FA`. An `Aurora` behind the
  app (default blobs; during an open moment market use the two team colours, as the box does).
- Column max 36rem, 16px gutters, safe areas as today. Cards: `bg-card rounded-panel shadow-lift`,
  12px apart; no hairline borders between cards (use space).
- Buttons (`apps/player/src/index.css`): `.btn-primary` → zap fill, white text, `shadow-zap`,
  56px tall, `rounded-tile`, press motion (lift on hover, 0.95 squish, spring release; copy
  `.btn` from `apps/box/src/index.css`). Add `.btn-prime` for the one hero action per screen
  (Join, Buy in, Cash out on a winning position). `.btn-secondary` → white card + `ring-rule` +
  `shadow-lift`. `.field` → `bg-card ring-1 ring-rule-strong`, focus `ring-2 ring-zap`.

**Header (scorebug)**: a white pill (`rounded-full shadow-lift`) with team chips, score digits in
ink squares (`bg-ink text-white rounded-chip`, `Roll` + `hd-beat` on change), clock with the hot
`live-dot`. Balance and P&L on the right as rolling numbers; P&L in `yes-600`/`no-600` with ▲▼.

**Home / join (`/`, `/j/CODE`)**: kinetic headline ("Your phone is the controller" or the party
name), the party preview as a card with the game title (Bricolage) and the join code as letter
tiles (white tiles, ink letters, `hd-pop` 90ms apart). The name field and the Join button live in
the thumb zone; Join is `.btn-prime`.

**Buy-in**: one `.btn-prime` "Buy in 10 pts" (`data-testid="buy-in"`). On success the confirmation
card (`buy-in-done`) shows "You're in" kinetic, gold coins arc from the button to the pot number
(`hd-coin`, 3 coins 80ms apart), the pot rolls up, and a small gold `Burst` (count 14). It stays
mounted until the player moves on.

**Live: tabs** (Markets, My bets, Board, Scorecard): bottom bar `bg-card shadow-pop` with
`rounded-t-blob`; active tab `text-zap` with a 4px zap pill under the icon that slides between tabs
(`transform: translateX`), inactive `text-ink-muted`. Tab content swaps by key with `hd-fade` only.

**Market card** (`market-card`): `bg-card rounded-panel shadow-lift`, a 4px prime ribbon on top for
moment markets plus the prime "Moment market" badge (`hd-pop`); game-long markets get a zap dot
label. Question: `Kinetic` in `.q text-title`. Status top right: `LockRing compact size="3.25rem"`
for a running clock (it goes hot under 5 s), words otherwise ("Locks at 80'"), "Locked" as an ink
pill. Under the question: the `SplitBar h-3 rounded-full` with Model/Gemini notches, then a
compact `Sparkline` (h 2rem, the first outcome's tone, from `useSeries(market.id, price, seed)`)
with "Yes price +4 pts" above it.

**Outcome button** (`outcome-<id>`): resting = tone tint (`bg-yes-50` / `bg-no-50` / `bg-sun-50` /
`bg-lilac-50`) with a 4px solid tone rule on the left, label (Bricolage 800, `-600` tone text) and
`Pct` (Archivo 800, `-600` tone text) on one line, payout under it in `text-small text-ink-2`.
Selected = solid tone (`TONE_FILL` in `apps/box/src/components/board.tsx`: white text on yes, ink
on no/sun/lilac) with a ✓ that pops, `shadow-yes`/`shadow-no`, and the `on-fill` class so arrows
follow the text colour. Press motion. 3+ outcomes stack vertically.
`apps/player/src/components/tones.ts` becomes: `text: text-{t}-600`, `deep: bg-{t}-50`,
`rule: hd-tone-{t}`, `solid: bg-{t}`, `ink: text-{t}-on` (sun/lilac for other/other-alt).

**Stake tray** (`stake-chip`): white chips `rounded-tile ring-1 ring-rule`, Archivo 800 tnum,
48px; the chosen one fills zap. Above the chips, the exact preview in one line: "You pay 2 pts ·
you get 2.74 pts if Yes" (Archivo for numbers). A tap squishes the chip, gold coins fly from it to
the split bar, the split seam glides and the chips leave (`hd-fade` out is not needed: they unmount).

**Position / stake row**: "Your stake 2 pts on Yes · pays about 2.85" on a `bg-canvas rounded-tile`
row; it stamps (`hd-stamp`) when it changes. Cash out (Market mode) is `.btn-secondary` unless the
position is in profit, then `.btn-prime` with the amount rolling.

**Result on a card** (`ResultBadge`): "Called it +0.60 pts" = `bg-yes text-white` pill with ✓, a
`Burst` of 14 over the card and `hd-shine`; "Cooked −1.00 pts" = `bg-no-50 text-no-600` with ✕,
no confetti; "Refunded" = `bg-well text-ink-2`. Settled split floods with the winner (`hd-flood`).

**Sheets** (`Sheet`, draft, top-up, sync check, take/offer): `bg-card rounded-t-blob shadow-pop`,
rising with `pl-sheet` on `--ease-spring`; a scrim of `ink/40`. Draft confirm (voice bet) uses
`.btn-prime` and the existing drain bar in zap.

**Captions**: the caption slot becomes the ink pill (`bg-ink text-white rounded-full`), the latest
line as `Kinetic` (stagger 28ms, `replay` on the line id); speaking = the speaker dot in `bg-prime`
with `hd-ping`. History sheet lists lines in `ink-2`.

**Talk button**: a 64px `bg-prime` circle with `shadow-zap`; listening = a zap ring pinging
(`pl-listen` recoloured) and the button scaled 1.06.

**Board (leaderboard)**: rows are white cards with `Avatar`, name (Bricolage 700), rolling P&L
(`yes-600`/`no-600` + ▲▼); the leader's row is `bg-ink text-white` with a gold rank badge; framer
`layout` with `SPRING.reorder`; a climber's row flashes a zap ring and ▲ for 1.1s.

**Scorecard**: as the box (`apps/box/src/screens/Scorecard.tsx`): Friends bar `bg-prime`, Model
`bg-ink`, Gemini hatched lilac with an ink ring, bars flood in 160ms apart, numbers roll, the best
gets a gold crown that pops, verdict on `bg-prime-soft`. Per-question axis: room dot `bg-zap`,
Model ▼ and Gemini ▽ in ink.

**End of game** (`my-payout`, `final-leaderboard`): your night in one number (`text-hero`,
rolling, `yes-600`/`no-600`), a `Burst` of 40 if you finished first (14 if up, none if down), the
payout card with gold coins flying from the pot to your balance and the "Paid" step lighting up,
then the podium as the box draws it (prime 1st, ink 2nd, white 3rd).

**Banners** (reconnecting, co-sign): ink pill at the top of the content, pushing it down.

## 10. Floodlight → Kickoff token map (one to one)

Round-one names still compile with their dark values, so unconverted code keeps working. Replace
them with these when re-skinning (the box is fully converted):

| Floodlight | Kickoff |
| --- | --- |
| `bg-night-950` (page) | `bg-canvas` |
| `bg-night-900` (raised) | `bg-card` (+ `shadow-lift`) |
| `bg-night-850` (well) | `bg-well` (or `bg-canvas` for rows inside cards) |
| `bg-night-800` (control) | `bg-card ring-1 ring-inset ring-rule` (controls) / `bg-control` (disabled) |
| `bg-night-700` / `border-night-700` | `bg-rule` / `border-rule` |
| `night-600` | `rule-strong` |
| `text-night-500` | `text-ink-faint` |
| `text-night-400` | `text-ink-muted` |
| `text-night-300` / `text-night-200` | `text-ink-2` |
| `text-chalk` | `text-ink` (on dark chips: `text-white`) |
| `bg-flood` / `text-flood-ink` | `bg-zap` / `text-zap-ink` (hero actions: `bg-prime text-white`) |
| `text-flood` | `text-zap` |
| `ring-flood` / `outline flood` | `ring-zap` |
| `shadow-flood` / `shadow-float` | `shadow-zap` / `shadow-pop` |
| `text-yes` / `text-no` (text on light) | `text-yes-600` / `text-no-600` |
| `bg-yes text-yes-ink` | `bg-yes text-yes-on` (white) |
| `bg-no text-no-ink` | `bg-no text-no-on` (ink) |
| `bg-yes-deep` / `bg-no-deep` | `bg-yes-50` / `bg-no-50` |
| `text-yes-bright` / `text-no-bright` | `text-yes-600` / `text-no-600` |
| `ring-no-dim` (errors) | `ring-hot` with `bg-hot-50` and `text-hot-600` |
| `other`, `other-deep`, `other-ink` | `sun`, `sun-50`, `sun-on` (`lilac*` for other-alt) |
| `bg-live` | `bg-hot` (+ `live-dot`) |
| `font-display` for questions | `font-head` (`.q`); keep `font-num`/`font-display` for numbers |
| `--c-night-*` CSS vars | `--k-*` |
| `color-scheme: dark`, `theme-color #08090B` | `color-scheme: light`, `theme-color #F4F3FA` |

## 11. Do and don't

Do
- Let the stage be the one loud thing; make the number first and the label second.
- Show exact money before and after: payout per unit, what you pay and get, the fill price.
- Animate every arrival and every number, with springs; keep the resting state the final state.
- Keep the words human: "Buy in", "Cash out", "Take it", "Called it", "Cooked".

Don't
- No red vs green, no colour without a label or icon, no zap or prime on YES/NO.
- No `AnimatePresence mode="wait"` around content, no JS fade-ins on primary content.
- No confetti for losses or on money you did not win; celebrations never cover an open market.
- Never print an empty or broken number: missing "–", tiny "<1%", long shots "100+".

## Test hooks

The Playwright e2e selects only by `data-testid` (full list in `e2e/README.md`). Every hook there
must stay on an element with the same meaning and attributes through any redesign. On the box,
`party-code` keeps its innerText exactly the code (the letter tiles are inline, not flex items).
