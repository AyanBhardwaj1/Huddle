# Huddle — Product Requirements Document (UBC 2026 Hackathon)

Nov 16, 2026 · @Ayan Bhardwaj

## 0. How to use this document

This is the single source of truth for building Huddle during the UBC 2026 Hackathon. The software must be demo-complete by **Wednesday, Nov 18**, and the Devpost submission is due **Friday, Nov 20 at 12:00 PM CST**.

**For the human team:** read sections 1 to 5 to understand the product. Section 10 is the contract between the software and the box our hardware engineer is building. Section 15 is the pitch and submission checklist.

**For the AI build agents:** export this doc as Markdown and save it as `PRD.md` in the repo root. Then paste the prompt in section 17 into the coding agent. Everything the agents need is in this file.

**Ground rules for agents**

- Priorities: **P0** = required for the Wednesday demo. **P1** = should have by Thursday. **P2** = stretch, only after all P0 and P1 items pass.
- If something is not specified here, pick the simplest option that keeps the demo working and record it in `DECISIONS.md` with one line of reasoning.
- Never block on a missing API key. Every external service has a mock or replay fallback (section 11), so the full demo runs offline.
- Never commit secrets. All keys live in `.env` files listed in `.env.example`.
- Everything uses Solana **devnet** and devnet test USDC. No real money moves in this project.

**Plain-language glossary (for the team)**

| Term | What it means here |
| --- | --- |
| Party | One watch-party session: a group of friends, one game, one box, one pot of money |
| Vault | A locked account on Solana that holds everyone's buy-in. Nobody can take money out of it alone |
| Signed balance | A small message saying "Ayan has $14.20 as of update #37," signed by both Ayan's phone and the box. The vault pays out from these |
| Market | One question people can bet on, like "Will Ronaldo score this penalty?" |
| Bet mode | Head-to-head: one friend offers a bet, another accepts the other side |
| Pool mode | Everyone puts money on an answer; winners split the whole pot |
| Market mode | A real mini prediction market: prices move as people buy and sell, and you can cash out before the answer is known |
| Market maker | The automatic "price setter" in Market mode. It always quotes a price, so you can always trade |
| Lock | The moment betting closes on a market, before the answer is known |
| Resolve | Deciding the answer (from the live sports data feed) and paying winners |
| Devnet | Solana's free test network. Same technology, fake money |
| Box | The physical device on the table: screen, speaker, NFC tag, buttons, LED ring |

## 1. Product summary

**Huddle** (working name) turns any watch party into a live micro prediction market: friends sit down with a box and an app and bet on any moment of the game, in the room or across the world.

**The moments it's built for**

- "Ronaldo is stepping up for a penalty. Does he make it?" (opens instantly, locks before the kick)
- "Will Portugal score 7 or more goals tonight?" (game-long market, tradable all game)
- "3rd and 7. Do they convert?" (opens on every key play)

**The problem.** Watching sports with friends already involves constant side bets: "$5 says he misses." Today those bets live in group chats and Venmo requests. Nobody tracks them, losers forget to pay, odds are made up, and friends watching from another city can't join in.

**The solution: one box, one app, one pot.**

- **The box** sits on the coffee table. It's the party's host and bank. Friends tap their phone on it to join and buy in. Its screen shows the live questions, odds and leaderboard. Its speaker is an AI announcer who calls the action, roasts the losers, and answers questions out loud.
- **The app** is every player's personal controller: bet, trade, cash out, see your balance, talk to the announcer. Friends in other cities join the same party from the app alone.
- **The AI** reads live game data, writes the next question at the right moment, and sets fair starting odds from real historical data and Gemini's regulated betting markets.
- **The money** sits in a vault on Solana. Bets happen instantly off-chain as signed balances, and the vault pays everyone out at the end. The box can never run off with the pot.

**Three ways to play, switchable per party or per question**

1. **Bet:** head-to-head between two friends. "I'll give you 2-to-1 he misses."
2. **Pool:** everyone picks a side, winners split the pot. Easiest to understand.
3. **Market:** a real micro prediction market. Prices move as people trade, and you can cash out mid-drive.

**One-line pitch:** "Huddle is the watch-party prediction market: a box on the coffee table, an AI announcer that runs the room, and instant bets on every moment of the game, settled on Solana."

**Why the box exists (the honest version for judges):** it holds the pot (it's the only signer that can update balances, and it posts a bond), it's the shared screen and voice of the room, and tapping it to buy in is the ritual that makes the party feel real. The same box could later run other social games (poker night, trivia), but the pitch is sports watch parties only.

## 2. Hackathon context

Huddle is being built for the **UBC 2026 Hackathon** (University Blockchain Conference, run by college.xyz), presented by Solana Foundation, Circle and Gemini, with $22,000+ in cash prizes. Building is online; finals are in person at UT Austin.

### Key dates (all CST)

| When | What |
| --- | --- |
| Thu Nov 12, 6:00 PM | Kickoff call; hacking begins. All code must be written after this |
| Nov 16 to 19 | Virtual workshops and office hours from Solana, Circle and the bounty sponsors |
| **Wed Nov 18** | **Our internal deadline: software demo-complete** |
| **Fri Nov 20, 12:00 PM** | **Devpost submission deadline** ([ubc-hackathon-2026.devpost.com](https://ubc-hackathon-2026.devpost.com/)) |
| Fri Nov 20, 11:59 PM | Finalists notified |
| Sat Nov 21 | Up to 13 finalist teams pitch live at UT Austin (5 min pitch + 2 min Q&A). Winners announced at the closing ceremony |

### Rules that shape our build

- Submit to **exactly one main track**. Within it, optionally compete for **one chain award**: Best use of Solana or Best use of Arc, never both.
- Enter **as many sponsor bounties** as the project qualifies for.
- Every submission is automatically in the running for **Official UBC 2026 Hackathon Winner** (1st/2nd/3rd). All prizes stack except Solana vs Arc.
- Teams of 1 to 4. Projects must be built during the hackathon. AI tools are encouraged. We keep our IP.
- **Must be present in person at the closing ceremony on Nov 21 to win any prize.**
- Finalists (up to 13): the top contender for Track Winner, Best use of Solana and Best use of Arc in each of the 3 tracks, the top 3 Official Winner contenders, and the 1st place Gemini bounty team.

### Main tracks (pick one)

| Track | What it rewards | Must have |
| --- | --- | --- |
| Agentic Payments and AI | Agents that hold, send and receive stablecoins; x402, Circle Agent Wallets, Solana Agent Kit | Agents execute or read onchain; document the agent's decision loop and safety limits |
| DeFi and Onchain Applications | New financial primitives, composable and safe | Interact with smart contracts; README explains economic design and risk; list contract addresses |
| **Consumer Applications (our track)** | Everyday apps where the crypto is invisible: payments, social, gaming, creator tools, loyalty | Interact with the blockchain; a working user-facing frontend (web or mobile) |

Consumer track objectives, verbatim in spirit: abstract away bridging, gas fees and seed phrases; build something people would use every day, not once; be intentional about design and UX.

### Chain awards (pick one, judged within our track)

- **Best use of Solana (our pick, $1,500):** core onchain functionality on Solana (devnet is fine); Anchor or native Rust for programs; Solana-native primitives (SPL tokens, Token Extensions, Solana Pay); smooth wallet UX. README must list program IDs and explain how we use Solana.
- Best use of Arc ($1,000): Circle's EVM L1 with USDC as gas. Not entered.

### Bounties (enter all that apply)

| Bounty | Prize | Requirements |
| --- | --- | --- |
| Gemini Prediction Markets | $2,500 / $1,000 / $500 | Use the Gemini Prediction Markets API (market data and/or trading). Objectives: analytics of odds over time, trading tools or agents, bringing prediction market data into other apps (news, social, onchain), improving market discovery |
| ElevenLabs | 3 months ElevenLabs Scale per member | Voice or audio is central, not an add-on. Demo video must show the integration with audio. README lists which ElevenLabs products we used and how |
| QuickNode Streams | $500 | Streams is a core data source. Configure at least one Stream with a filter and a destination (e.g. webhook). README explains network, dataset, filter logic, destination and why |
| Grok Bot | Mechanical keyboard per member + swag | Grok Bot does real work and is central. Include a Grok Bot chat export and a 3 to 4 sentence README section. Optional for us (P2) |

### Prizes

| Prize | Award |
| --- | --- |
| Official UBC 2026 Hackathon Winner | 1st $2,500 + 3 months ElevenLabs Pro per member; 2nd $1,000; 3rd $500 |
| Track Winner (per track) | $2,000 |
| Best use of Solana (per track) | $1,500 |
| Best use of Arc (per track) | $1,000 |
| Participation (complete working submissions) | 1 month ElevenLabs Creator, $49/mo QuickNode plan, X Premium (for up to 300 participants) |

### Judging criteria (all categories)

1. **Technical execution:** functionality, technical depth, effective use of blockchain infrastructure.
2. **Product and UX:** clear problem, intuitive experience, quality.
3. **Innovation:** originality and creativity.
4. **Impact and potential:** real-world usefulness, adoption potential, viability.
5. **Demo:** quality of the live demo and how clearly we communicate.

### What to submit on Devpost

- Project name, short description, all team members.
- Main track (Consumer), chain award (Solana), every bounty we enter.
- Written answers: What did you build? What problem does it solve? How does it work? What makes it unique? What would you build next?
- Technologies and sponsor tools used.
- Public GitHub repo with source and setup instructions; README with technical documentation and architecture overview.
- A working demo or deployed app.
- 2 to 3 minute demo video on YouTube or Google Drive, accessible to judges.
- Track and bounty specifics: program IDs, Stream configuration, ElevenLabs products used, Gemini endpoints used.

### Lessons from last year's edition (MBC 2025, same organizer)

The 2025 edition was the Midwest Blockchain Conference hackathon (97 projects, $40,000 pool). Its judges rewarded polished end-to-end prototypes over ambitious half-builds, and a problem that is obvious in the first minute of the demo ([MBC 2025 Devpost](https://mbc.devpost.com/)).

- **Solana 1st place: SolMail**, an inbox that uses micropayments to get replies to cold emails. Simple, everyday, clear.
- **Base 2nd place: tmap**, which turns food discoveries into tradeable tokens, with gasless transactions.
- **Circle bounty 1st place: HyperSphere**, an NFC tap-to-pay USDC terminal on Android. A physical demo judges could touch.
- **Crowded categories to differentiate from:** about 20 Polymarket projects (copy trading, paper trading, fantasy drafting, friend-bet escrow like Base Bets and BPointBet). Huddle's difference is the box, the live AI announcer, AI-generated in-game questions, and three play modes with a real market maker.

## 3. Target prize stack

We enter Consumer Applications with Best use of Solana, plus the Gemini, ElevenLabs and QuickNode bounties. The cash ceiling is **$9,000** plus perks, and winning Gemini 1st also earns an automatic finalist slot.

| Prize | Cash | How Huddle earns it (must be true in the build) |
| --- | --- | --- |
| Consumer Applications track | $2,000 | Friends play without knowing crypto: no seed phrase, no gas, tap-to-join, one-tap bets. Polished box screen and mobile app |
| Best use of Solana | $1,500 | Anchor program for the party vault, signed-balance settlement verified onchain with the Ed25519 program, SPL USDC, fast devnet settlement |
| Official UBC Winner | up to $2,500 | The live demo: judges buy in, bet, hear the announcer, see the payout |
| Gemini Prediction Markets | up to $2,500 | "Friends vs. the Pros": Gemini's live odds shown beside the room's odds on every comparable market; model calibration from Gemini prices; end-of-game accuracy scorecard (section 6) |
| QuickNode Streams | $500 | A devnet Stream filtered to our program; webhook drives real-time deposit, close and payout events to the box and app |
| ElevenLabs | perks | The announcer is the product's personality: event callouts, sport-specific personas, a talk-back voice agent with tools, generated sound effects |
| Grok Bot (P2 only) | perks | Optional: Grok Bot posts the party's markets and recap to X |

## 4. Users, experience and flows

Four people use Huddle: the **host** who owns the box, **in-room friends** with phones, **remote friends** in other cities, and the **judge** at the demo table. Every flow below must work end to end in Replay mode (section 11) with no network keys.

### Users

| User | Wants | Uses |
| --- | --- | --- |
| Host | Start a party in under a minute, pick the game and the play mode, keep it fair | Box touchscreen + app (host controls) |
| In-room friend | Join instantly, bet with one tap, hear the trash talk | Phone (PWA), taps box to join |
| Remote friend | Join the same party from another city and feel part of the room | Phone or laptop (PWA) via invite link |
| Judge (demo) | Understand it in 30 seconds and play it in 2 minutes | Demo phone handed to them |

### Flow A: host starts a party (P0)

1. Box boots into the Huddle home screen.
2. Host picks the game from a list (live games from the sports data feed, or a recorded game in Replay mode).
3. Host picks the default play mode (Bet, Pool or Market), the buy-in (e.g. 10 USDC), and the announcer persona (auto-picked by sport).
4. Box creates the party onchain (vault + host bond) and shows a big QR code and "Tap your phone here to join."

### Flow B: a friend joins and buys in (P0)

1. Friend taps their phone on the box's NFC tag (or scans the QR). The PWA opens to the party.
2. First time only: they type a display name. A Solana wallet is created silently on the phone. No seed phrase, no wallet app.
3. They tap "Buy in $10." On devnet, the app first auto-funds the wallet with test USDC from our faucet endpoint.
4. The deposit lands in the vault. QuickNode Streams notifies the engine, the box flashes, and the announcer says "Jake's in for ten. Brave man."

### Flow C: a moment market (P0, the core loop)

1. The data feed reports a penalty awarded to Portugal.
2. The AI question generator creates "Will Ronaldo score this penalty?" with a model starting price (e.g. YES 77%). If Gemini has a related market, its odds show beside it.
3. Box and phones show the question with a lock countdown. The announcer calls it out.
4. Friends bet or trade with one tap. Odds update live on every screen.
5. Lock: by countdown, by a related data feed event, or by the host pressing the box's LOCK button.
6. Result arrives from the data feed. The market resolves, balances update instantly, everyone's phone countersigns the new balance, and the announcer reacts.
7. A 20-second dispute window lets anyone flag a wrong result (section 5).

### Flow D: game-long markets (P0)

At kickoff the AI opens 2 to 4 game-long markets (winner, total goals or points over/under, first scorer). They stay tradable until a lock point (e.g. end of the 3rd quarter, or the 80th minute) and resolve at full time. In Market mode, players can cash out at the current price at any time before lock.

### Flow E: talk to the announcer (P1)

A player holds the TALK button on the box (or in the app) and asks "What are the odds Portugal hits seven?" The voice agent answers with live numbers. "Put 5 on yes for me" creates a **draft** bet that the player confirms in the app with one tap. The voice agent never moves money by itself.

### Flow F: end of game and payout (P0)

1. Final whistle: all open markets resolve or are voided (voided = refunded).
2. Box shows the final leaderboard and the "Friends vs. Model vs. Gemini" scorecard. The announcer does a 20-second recap.
3. The box closes the party onchain and submits every player's latest signed balance. After the challenge window (60 seconds in demo mode), each player's winnings land in their wallet automatically.
4. Players can withdraw to an external Solana wallet from the app (P1).

### Flow G: remote friend (P0 basic, P1 full)

The host shares an invite link. The remote friend joins in the PWA, buys in the same way, sees the same markets and odds, and hears the announcer through the app (P1). Latency handling is in section 12.

### User stories (acceptance tests)

- [ ] As a friend, I can join a party and buy in within 30 seconds of tapping the box, without installing anything.
- [ ] As a friend, I can place a bet in one tap and see it on the box screen within 1 second.
- [ ] As a host, I can switch the play mode for the party or for a single question.
- [ ] As a player, I can cash out a Market-mode position before it locks.
- [ ] As a player, I get paid automatically after the game without trusting the host.
- [ ] As a player, I can see Gemini's odds next to my room's odds when Gemini has a matching market.
- [ ] As a remote friend, I can play the same party from another city.

## 5. Market modes and lifecycle

Every question is a **market** with one of three modes (Bet, Pool, Market). The party sets a default and the host can override it per market. All three share one lifecycle, one ledger and one settlement path, so the mode only changes how prices and payouts are computed.

### Shared rules (P0)

- All amounts are integers in USDC base units (6 decimals). Never use floating point for balances. Market-maker math may use a decimal library internally but always rounds in the house's favor.
- Outcomes: binary (YES/NO) for most props; categorical (2 to 6 outcomes) for things like "next goal: Portugal / Spain / none."
- Limits (configurable per party): minimum stake 0.10 USDC; maximum stake per player per market 50% of their balance.
- A player can never bet more than their available balance (balance minus funds locked in open positions and unmatched offers).

### Mode 1: Bet (head-to-head) (P0)

One player makes an offer; others take the opposite side.

- Offer: `{ market, side, makerStake, odds }`. Default odds come from the model's fair price for that side, e.g. 77% → maker pays 1.30x. The maker can adjust before posting.
- Taker stake = `makerStake × (decimalOdds − 1)`. Partial fills allowed by multiple takers.
- At lock, any unmatched part of an offer is released back to the maker.
- At resolution, the winner of each matched pair receives both stakes.

### Mode 2: Pool (pari-mutuel) (P0)

Everyone stakes on an outcome; winners split the whole pool pro rata.

```latex
\text{payout}_i = \text{stake}_i \cdot \frac{S_{\text{total}}}{S_{\text{winning}}}
```

- Displayed odds = share of the pool on each outcome, updating live.
- If nobody backed the winning outcome, everyone is refunded.
- No house, no fee in friends mode.

### Mode 3: Market (automated market maker) (P0)

A real micro prediction market. Each outcome has shares that pay 1 USDC if it wins. A logarithmic market scoring rule (LMSR) market maker always quotes a price, so anyone can buy or sell instantly, and prices move with every trade.

Cost function over outstanding shares q, and the price of outcome i:

```latex
C(\mathbf{q}) = b \ln \sum_{j=1}^{n} e^{q_j / b} \qquad p_i = \frac{e^{q_i / b}}{\sum_{j} e^{q_j / b}}
```

Buying Δ shares of outcome k costs C(q + Δ·e\_k) − C(q); selling (cashing out) returns C(q) − C(q − Δ·e\_k).

- **Starting prices come from the AI model** (section 6): initialize q\_i = b · ln(prior\_i), so the market opens at the model's probabilities.
- **Liquidity:** the house's worst-case loss is b · ln(n). Pick b from the per-market house budget L: b = L / ln(n). Default L = 2 USDC per binary market in demo.
- **Who is the house:** the host's balance funds the market maker (they choose a house budget when creating the party). House profit or loss flows to the host's balance, so the money always sums to the vault.
- **Cash out:** a player can sell any number of shares before lock at the current price. The app shows "Cash out now: $3.40."
- **UI:** show price as a percentage ("Yes 77%") and as a payout ("$1 pays $1.30"). For NFL, optionally show American odds.
- Fee: 0% by default; optional 1% house fee (P2).

### Lifecycle (all modes)

| State | Meaning | Moves to |
| --- | --- | --- |
| `draft` | Generated by AI or host, not yet visible | `open` (host or auto-approve), `discarded` |
| `open` | Accepting bets and trades | `locked` |
| `locked` | No more bets; waiting for the result | `resolved`, `voided` |
| `resolved` | Outcome set from the data feed; balances updated; dispute window running (20 s default) | `final`, `disputed` |
| `disputed` | A player flagged the result; host decides on the box: confirm, change outcome, or void | `final`, `voided` |
| `final` | Done; included in settlement | none |
| `voided` | Cancelled; every stake and trade refunded at cost | none |

**Lock triggers** (whichever comes first): the countdown ends (default 20 s for moment markets); a linked data-feed event fires (e.g. "penalty kick taken", "snap" when available); the host presses LOCK on the box; or the game-long lock point is reached.

**Resolution:** each market stores a `resolver`: a rule that maps normalized data-feed events to an outcome (e.g. `penalty_result(player=Ronaldo) → scored/missed`). Unknown or ambiguous results → `voided`. The host can always resolve manually from the box (P0 fallback).

### Core types (shared package, P0)

```ts
type MarketMode = 'bet' | 'pool' | 'amm';
type MarketState = 'draft' | 'open' | 'locked' | 'resolved' | 'disputed' | 'final' | 'voided' | 'discarded';

interface Market {
  id: string; partyId: string;
  question: string;            // "Will Ronaldo score this penalty?"
  kind: 'moment' | 'game';
  mode: MarketMode;
  outcomes: { id: string; label: string }[];
  prior: Record<string, number>;          // model probabilities, sum to 1
  geminiRef?: { eventTicker: string; contractTicker: string; prob: number; asOf: string };
  ammB?: number;                          // LMSR liquidity, amm mode only
  q?: Record<string, string>;             // outstanding shares (decimal strings)
  pool?: Record<string, number>;          // pool stakes in base units
  lock: { at?: string; onEvent?: string; manual: true };
  resolver: { type: string; params: Record<string, unknown> };
  state: MarketState; outcome?: string; createdBy: 'ai' | 'host' | 'player';
}

interface Position { partyId: string; marketId: string; player: string; outcome: string; shares?: string; stake: number; }
interface BetOffer { id: string; marketId: string; maker: string; side: string; makerStake: number; odds: number; filled: number; }
```

## 6. AI question generator and pricing models

The AI decides **what to ask and when**; the models decide **the starting odds**. The language model never sets a price. Prices come from data-driven models, calibrated against Gemini when Gemini has a matching market.

### Pipeline (P0)

1. **Game state** arrives as normalized events from the sports data adapter (section 11): score, clock, possession, down and distance, field position, cards, penalties, substitutions.
2. **Trigger rules** (deterministic, per sport) propose candidate questions from a template catalog the moment something happens.
3. **Pricing** fills each candidate's prior from the sport model.
4. **Ranking and phrasing (LLM):** the LLM picks the best 1 to 2 candidates for this moment (avoid spamming), writes a punchy question and a one-line announcer hook, using room context (who's winning, streaks). Output must validate against a JSON schema; invalid output falls back to the template's default text.
5. The market is created as `draft` and auto-opened (or held for host approval if the party setting says so).

Rate limit: at most one new moment market every 20 seconds per party, and at most 3 open moment markets at once.

### Template catalog (P0 = first 4 per sport)

| Sport | Trigger | Question template | Resolver | Lock |
| --- | --- | --- | --- | --- |
| Soccer | Penalty awarded | Will {player} score this penalty? | penalty\_result | Kick taken / 45 s |
| Soccer | Kickoff | Will {team} score {N}+ goals? (game) | total\_goals ≥ N | 80th minute |
| Soccer | 60th minute, game level | Next goal: {home} / {away} / none | next\_goal | Next goal / full time |
| Soccer | Corner awarded | Shot on target from this corner? | corner\_outcome (P1) | 20 s |
| Soccer | Yellow card shown | Another card before halftime? | card\_count | Halftime |
| NFL | Every snap (3rd/4th down only in P0) | Do they convert on {down} and {distance}? | first\_down\_result | Snap / 20 s |
| NFL | Drive start | Does this drive end in a TD, FG or no score? | drive\_result | Drive start + 20 s |
| NFL | Any snap (P1, when play-type data is available) | Run or pass? | play\_type | Snap / 15 s |
| NFL | Kickoff | Total points over {line}? (game) | total\_points | End of Q3 |
| NFL | Red zone entry | Touchdown on this possession? | drive\_result | 20 s |
| Any | Quarter or half start | Who wins this quarter / half? | period\_winner | Period start + 30 s |

### Pricing models (P0 simple, P1 trained)

Models are trained offline in Python and exported as JSON coefficients that the TypeScript engine evaluates at runtime. No Python in the live path.

**NFL (P1 trained, P0 lookup table):** train on free historical play-by-play from nflverse ([nflverse-data releases](https://github.com/nflverse/nflverse-data/releases)).

- Conversion probability: logistic regression on down, yards to go, yard line, score difference, seconds remaining, timeouts.
- Drive result (TD / FG / none): multinomial logistic regression on starting field position, score difference, time remaining.
- Pass probability (for Run or pass): logistic regression on the same features.
- P0 fallback: a lookup table of empirical rates by down and distance bucket, computed from the same data.

**Soccer:**

- Penalty conversion: league-wide base rate computed from open event data ([StatsBomb open data](https://github.com/statsbomb/open-data)); adjust toward the taker's career rate when we have it, shrunk toward the base rate (empirical Bayes, k = 20 attempts).
- Goals: independent Poisson model per team. Pre-match goal expectations come from Gemini or bookmaker-style win odds when available (solve for the two rates that match the implied win/draw/loss probabilities), else a default of 1.35 home and 1.10 away. During the game, scale the remaining expectation by minutes left and add goals already scored.
- "N+ goals" markets = 1 − Poisson CDF of the remaining goals needed. "Next goal" = split by the two remaining rates, with "none" = probability of zero further goals.

**Calibration to Gemini (P1):** when Gemini lists a market on the same game (e.g. NFL moneyline, a quarter or half winner), adjust the team-strength parameter so our model's game or period probability matches Gemini's mid price, then derive the micro-market priors from the adjusted model. This keeps our odds consistent with a regulated market.

### Friends vs. Model vs. Gemini scorecard (P0 for Gemini bounty)

For every market that resolves, store three probabilities for the outcome that happened: the room's (the final market price at lock, or the pool share), the model's prior, and Gemini's mid price at lock when a comparable Gemini contract exists. Score each with the Brier score (lower is better):

```latex
\text{Brier} = \frac{1}{N} \sum_{m=1}^{N} (p_m - o_m)^2
```

The box shows a live "Who's smarter?" panel and the end-of-game recap names the winner ("The room beat the model by 0.04 tonight; Gemini still wins").

### LLM usage

- Provider is configurable; default the Anthropic Messages API (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`).
- Two prompts: `question_ranker` (candidates + room context → JSON choice and text) and `announcer_lines` (event + room context → 1 to 2 spoken lines, max 25 words each).
- Hard rules in the system prompt: never invent numbers (all odds and stats are passed in), no slurs or harassment, light roasting only of willing players, no encouragement to chase losses.
- If the LLM is unavailable or slow (more than 1.5 s), use the template's default text so the game never stalls.

## 7. ElevenLabs announcer

The announcer is Huddle's personality and must feel central: it calls every market, reacts to every result, knows the room, and talks back. It uses three ElevenLabs products: **Text to Speech** for callouts, **ElevenLabs Agents** for two-way conversation, and **Sound Effects** for stingers.

### Personas (P0)

- Picked automatically by sport, changeable by the host: Soccer (energetic European-style commentator), NFL (big-voice American play-by-play), Calm (low-key, for late games).
- Use voices from the ElevenLabs voice library or designed voices. **Never clone or imitate a real commentator or celebrity.** Voice IDs live in config (`ELEVENLABS_VOICE_SOCCER`, `ELEVENLABS_VOICE_NFL`, `ELEVENLABS_VOICE_CALM`).

### Event callouts (P0)

The engine emits announcer events; an announcer service turns each into speech.

| Event | Example line | Priority |
| --- | --- | --- |
| `market_opened` | "Penalty to Portugal! Ronaldo steps up. Room's got him at 77%. Twenty seconds, get in!" | High |
| `lock_soon` (5 s left) | "Five seconds! Last call!" | High |
| `big_trade` | "Jake just dumped $8 on NO. Bold." | Medium |
| `market_resolved` | "He buries it! YES pays out, Jake you're cooked." | High |
| `player_joined` | "Priya's in for ten from Chicago!" | Low |
| `leaderboard_change` | "New leader: Ayan, up $12." | Low |
| `game_recap` | 20-second recap with winner, biggest swing, and the Friends vs. Gemini verdict | High |

- Lines come from the LLM `announcer_lines` prompt with all numbers passed in, with template fallbacks.
- **Latency target:** under 2.5 s from event to first audio. Use the low-latency TTS model with streaming output. Pre-generate and cache common lines per persona at party start ("Five seconds!", "Locked!", "Last call!").
- **Queue:** one speaking line at a time; high priority preempts low; drop stale low-priority lines older than 6 s.
- **Playback:** on the box speaker via the box UI (browser audio). In the PWA, remote players can toggle announcer audio (P1); the server returns a short-lived audio URL or streams bytes over the WebSocket.

### Talk-back voice agent (P1)

- An ElevenLabs Agent configured with the persona voice and a system prompt about Huddle. Triggered by the box TALK button (push-to-talk) or the app's mic button.
- The agent gets **server tools** (webhooks to our engine), all read-only except drafts:
  - `get_party_state` → score, clock, open markets with prices, leaderboard.
  - `get_market(id)` → prices, volume, Gemini comparison.
  - `explain_odds(id)` → plain-language explanation of the price and the model behind it.
  - `draft_bet(player, market, outcome, amount)` → creates a **draft** that the player must confirm with one tap in the app. The agent can never move money.
- Webhooks are authenticated with a shared secret header; the party is identified by a signed session token passed as a dynamic variable at conversation start.

### Sound effects (P1)

Generate and cache at build time: goal horn, touchdown crowd roar, lock buzzer, cash register (payout), sad trombone (big loss). Played on the box with the LED patterns from section 10.

### Fallbacks

- No ElevenLabs key or an API error → browser Web Speech API on the box, so the demo never goes silent. Log a warning on the host screen.
- The README must list exactly which ElevenLabs products are used and how, and the demo video must include the announcer audio (bounty requirement).

## 8. Blockchain design: the party vault

Money goes into a Solana vault at buy-in, every bet during the game is an instant off-chain balance update signed by both the box and the player, and the vault pays out from the latest signed balances at the end. This gives instant, free betting with a guarantee that the box can never take the pot.

### In plain words (for the team)

Think of chips at a poker night, but the cash sits in a locked safe instead of the host's pocket. After every play, the box writes everyone's new chip count, and each player's phone automatically initials their own line. At the end, the safe pays out by the last chip counts everyone initialed. If the box crashes or lies, any player can show the safe their last initialed line and get paid from it.

### Program: `huddle_vault` (Anchor, P0)

**Accounts**

| Account | Seeds | Fields |
| --- | --- | --- |
| `Party` | `["party", host, party_id]` | host, box\_signer (pubkey), mint (USDC), vault (token account owned by the Party PDA), status (Open / Closing / Finalized), total\_deposits, bond, challenge\_secs, close\_requested\_at, require\_member\_sig (bool), member\_count, finalized\_sum |
| `Member` | `["member", party, wallet]` | wallet, deposited, claim\_balance, claim\_nonce, has\_claim, withdrawn |

**Instructions**

1. `create_party(party_id, box_signer, challenge_secs, bond, require_member_sig)`: host creates the party and deposits the bond (demo: 5 USDC) into the vault.
2. `deposit(amount)`: creates the Member account if needed and transfers USDC from the player's token account to the vault.
3. `request_close()`: host or box signer, or any member after a timeout (e.g. 6 hours). Status becomes Closing and starts the challenge window (demo: 60 s; default: 10 min).
4. `submit_state(member, nonce, balance, state_hash)`: during Closing, anyone can submit a member's signed balance. The program verifies the signatures (below) and keeps the claim only if its nonce is higher than the stored one.
5. `finalize()`: after the window, anyone calls it. Members with no submitted state default to their deposit (no bets). If the sum of claims exceeds total deposits, the host's bond covers the shortfall; if the bond is not enough, every claim is cut pro rata. Any surplus (house profit, rounding) goes to the host.
6. `withdraw()`: a member (or a crank on their behalf) receives their final amount from the vault.

**Why the box can't cheat:** it can't move vault funds; it can only co-sign balances. A player always holds their own latest co-signed balance and can submit it. The box submits every member's latest state at close because unsubmitted losers default to their deposit, and any shortfall is paid from the host's own bond.

### Signed balance message (P0)

Canonical bytes, little-endian integers:

```text
"HUDDLE_STATE_V1" (15 bytes)
|| party_pubkey (32) || member_pubkey (32)
|| nonce (u64) || balance (u64, USDC base units)
|| state_hash (32)   // sha256 of the member's ledger since the last state (audit trail)
```

- Signed with ed25519 by the box signer key and by the member's wallet key.
- On-chain verification: the transaction includes Ed25519 signature-verify program instructions before `submit_state`; the program reads the instructions sysvar to confirm both signatures cover exactly this message and these public keys. This is the standard Solana pattern for verifying off-chain signatures.
- **Trusted-host fallback (P0 safety net):** if `require_member_sig = false`, only the box signature is required. Use this if phone co-signing slips; the README must say which mode the demo ran.

### Off-chain ledger (party engine, P0)

- Every balance change (bet placed, offer filled, trade, cash out, resolution, void) creates a new state for each affected member: nonce + 1, new balance, new state\_hash.
- The engine signs the state with the box key and sends it to the member's app. The app re-checks the change against its own copy of the market events (it receives every fill and resolution), then countersigns automatically and returns the signature. A mismatch shows a dispute prompt instead of signing.
- The engine persists every state and both signatures (SQLite), so the box can submit all final states at close.
- Positions still open at close (locked but unresolved) are voided and refunded at cost before final states are produced.

### Wallets and payments UX (P0)

- **Invisible wallet:** on first launch the PWA generates an ed25519 keypair and stores it in IndexedDB (devnet only). No seed phrase is shown. A "Back up" screen is P2.
- **Test funds:** an engine endpoint `POST /faucet` sends 25 devnet USDC from a treasury wallet to new players, rate-limited per wallet. SOL for fees: the treasury pays fees as fee payer, so players never need SOL.
- **External wallets (P1):** a Solana Pay transaction request link (`solana:https://…/pay/deposit?party=…`) lets Phantom or Solflare users deposit from their own wallet. These users still get an in-app session key that co-signs balances.
- USDC: the devnet USDC mint from Circle (faucet at [faucet.circle.com](https://faucet.circle.com/)), configured via `USDC_MINT`.

### Settlement modes (host chooses at party creation)

| Mode | When | How |
| --- | --- | --- |
| Vault + signed balances (default, P0) | Normal play | As above |
| Trusted host (P0 fallback) | If co-signing is not ready | Box-only signatures; same program |
| Points only (P0) | No money at all | Same engine and UI, no on-chain calls except an optional final leaderboard memo |

### Solana requirements for the README

Program ID(s), devnet deployment transaction, the account layout above, the signed-message format, and a paragraph on why Solana: sub-second confirmation, near-zero fees for fee-payer sponsorship, and SPL USDC.

## 9. System architecture

One TypeScript monorepo. The **party engine** runs on the box (or a laptop standing in for it), serves the box screen, talks to phones over WebSockets, and is reachable by remote friends through a public tunnel. The Solana program, the PWA and the model-training scripts live beside it.

&#91;embedded content: Huddle architecture · box, phones, services, Solana\]

Phones send their buy-in deposits straight to the vault; every other money movement is a signed balance held by the engine until the box closes the party on Solana.

### Components

| Component | Runs on | Responsibility | Priority |
| --- | --- | --- | --- |
| Party engine (`apps/engine`) | Box (Raspberry Pi 5) or laptop | Parties, markets, the three mode engines, ledger and state signing, lock and resolve, WebSocket hub, REST API, faucet, Solana client, QuickNode webhook receiver | P0 |
| Box UI (`apps/box`) | Box touchscreen, Chromium kiosk at `http://localhost:8080/box` | Big-screen party view, host controls, QR and join prompt, announcer audio playback, LED and button bridge client | P0 |
| Player app (`apps/player`) | Phones and laptops (PWA) | Join, wallet, buy in, bet/trade/cash out, positions, leaderboard, co-signing, talk button | P0 |
| Vault program (`programs/huddle_vault`) | Solana devnet | Section 8 | P0 |
| Shared package (`packages/shared`) | All TS apps | Types, zod schemas, WebSocket protocol, state-message encoding, LMSR / pool / bet math, odds formatting | P0 |
| Sports data adapters (`packages/sports`) | Engine | Replay, ESPN, API-Football adapters to one normalized event stream | P0 (Replay), P1 (live) |
| Pricing models (`packages/models` + `ml/`) | Engine (JSON) / offline Python | Priors per template; Gemini calibration | P0 tables, P1 trained |
| Gemini client (`packages/gemini`) | Engine | Find and poll matching Gemini markets | P0 |
| Announcer (`packages/announcer`) | Engine | LLM lines, ElevenLabs TTS, queue, SFX cache, agent tool webhooks | P0 TTS, P1 agent |
| Box bridge (`apps/box-bridge`) | Box | Hardware I/O daemon (owned by our hardware engineer; contract in section 10); mock version for dev | P0 mock |

### Tech stack

- Node 20+, TypeScript strict, pnpm workspaces, Turborepo.
- Engine: Fastify + `ws`, SQLite via `better-sqlite3` (single-file persistence on the box), `decimal.js` for market-maker math, `zod` validation, `pino` logging.
- Box UI and player app: React + Vite + Tailwind, `vite-plugin-pwa` for the player app, Zustand for state, Framer Motion for odds animations.
- Solana: Anchor (latest stable), Rust; TS client with `@coral-xyz/anchor` and `@solana/web3.js` + `@solana/spl-token`; `tweetnacl` for ed25519 signing in the browser.
- ML: Python 3.11, pandas, scikit-learn; exports `models/*.json`.
- Tests: Vitest (TS), `anchor test` (program), Playwright smoke test for the join-bet-resolve loop.
- Deploy: engine runs locally on the box; remote access via Cloudflare Tunnel (or ngrok); optional cloud copy of the engine on Fly.io or Render; player app also deployable to Vercel pointing at the engine URL.

### Repo layout

```text
huddle/
  PRD.md  DECISIONS.md  README.md  .env.example
  apps/
    engine/        # Fastify + ws party engine
    box/           # kiosk UI for the box screen
    player/        # PWA for players
    box-bridge/    # hardware daemon (mock first; real by hardware engineer)
  packages/
    shared/        # types, protocol, math, state encoding
    sports/        # data adapters + normalized events + replay files
    models/        # runtime model evaluation from JSON
    gemini/        # Gemini Prediction Markets client
    announcer/     # LLM lines, ElevenLabs TTS/agent/SFX
    solana-client/ # TS client for huddle_vault
  programs/huddle_vault/   # Anchor program
  ml/              # Python training scripts + notebooks
  replays/         # recorded games: event timelines (+ optional video)
  scripts/         # seed, demo, deploy helpers
```

### WebSocket protocol (`/ws`, JSON messages, P0)

Client to engine: `join {partyCode, playerPubkey, name}`, `place_bet {marketId, outcome, stake}`, `post_offer {...}`, `take_offer {offerId, amount}`, `amm_trade {marketId, outcome, shares | spend, side: buy|sell}`, `cosign {member, nonce, signature}`, `dispute {marketId, reason}`, `host_action {lock | resolve | void | approve_draft | set_mode, ...}`, `talk_start` / `talk_end`.

Engine to clients: `party_state` (full snapshot on join), `market_upsert`, `price_update`, `fill`, `balance_state {nonce, balance, stateHash, boxSig}` (to the member only), `leaderboard`, `game_event`, `announcer {text, audioUrl?, priority}`, `scorecard`, `error {code, message}`.

Every client message carries a client-generated id; the engine acks with `ack {id, ok, error?}`. Target: ack within 300 ms on LAN, 800 ms remote.

### REST API (P0)

- `POST /parties` (host creates) · `GET /parties/:code` · `POST /parties/:code/close`
- `GET /games?sport=` (live or replay games) · `POST /replays/:id/start` (demo control: start, pause, seek, speed)
- `POST /faucet` (devnet USDC to a new player)
- `POST /webhooks/quicknode` (Streams destination; verify the security token)
- `POST /agent-tools/:tool` (ElevenLabs agent server tools)
- `GET /health`

### Environment variables (`.env.example`)

```text
SOLANA_RPC_URL=            # QuickNode devnet endpoint preferred
SOLANA_CLUSTER=devnet
HUDDLE_PROGRAM_ID=
USDC_MINT=                 # devnet USDC mint
TREASURY_SECRET_KEY=       # fee payer + faucet (devnet only)
BOX_SIGNER_SECRET_KEY=     # box key (on the box only)
QUICKNODE_STREAM_SECRET=   # verify webhook
ANTHROPIC_API_KEY=  LLM_PROVIDER=anthropic  LLM_MODEL=
ELEVENLABS_API_KEY=  ELEVENLABS_AGENT_ID=  ELEVENLABS_VOICE_SOCCER=  ELEVENLABS_VOICE_NFL=  ELEVENLABS_VOICE_CALM=
SPORTS_PROVIDER=replay     # replay | espn | apifootball
API_FOOTBALL_KEY=
GEMINI_API_BASE=https://api.gemini.com
PUBLIC_ENGINE_URL=         # tunnel URL for remote players
```

## 10. Hardware box and the bridge contract

Our hardware engineer is building the box now; the software team builds against the contract below and a mock bridge, so neither side blocks the other. **The parts list is the expected build; the hardware engineer confirms the final parts and fills the open items at the end of this section.**

### Expected hardware

| Part | Purpose |
| --- | --- |
| Raspberry Pi 5 (8 GB) + microSD/SSD | Runs the party engine and the kiosk browser |
| 7-inch touchscreen | Box UI: questions, odds, leaderboard, host controls |
| Speaker (USB or I2S amp) | Announcer audio |
| Microphone (USB) | Talk-back push-to-talk |
| NFC tag (NTAG215 sticker) or PN532 reader/writer | "Tap to join": phone reads a URL from the tag |
| WS2812 LED ring | Status and celebration lights |
| 2 to 3 arcade buttons | LOCK (host), TALK (push-to-talk), NEXT (host menu) |
| Optional: ATECC608 secure element | Stores the box signer key (P2) |

### Bridge daemon contract (P0)

The bridge is a small local service (`apps/box-bridge`) exposing a WebSocket at `ws://localhost:7777`. The box UI and the engine connect to it. Messages are JSON.

**Bridge to software (events)**

```json
{"type": "button", "id": "lock" | "talk" | "next", "action": "down" | "up"}
{"type": "nfc_written", "url": "https://…/j/ABCD"}
{"type": "bridge_status", "leds": true, "nfc": true, "buttons": true}
```

**Software to bridge (commands)**

```json
{"type": "led", "pattern": "idle" | "join" | "market_open" | "locking" | "locked" | "win" | "loss" | "goal" | "error", "color": "#RRGGBB"}
{"type": "nfc_set_url", "url": "https://…/j/ABCD"}   // only if a writable NFC module is fitted
```

- With a passive sticker tag, the tag permanently holds `https://<PUBLIC_ENGINE_URL>/j` and the engine redirects to the current party. With a PN532, the engine writes the party URL at party creation.
- Audio and the microphone are handled by the kiosk browser (Web Audio and getUserMedia), not the bridge.
- The box signer key lives at `/etc/huddle/box-signer.json` (mode 600) on the Pi, or in the secure element (P2). It never leaves the box.

### Mock bridge (P0, built by the software agents)

`apps/box-bridge --mock` serves the same WebSocket, logs LED commands with a colored terminal preview, and maps keyboard keys L / T / N to the LOCK, TALK and NEXT buttons. The whole demo must run with the mock.

### Boot sequence on the Pi

1. systemd starts `huddle-engine` (Node) and `huddle-bridge`.
2. Chromium starts in kiosk mode at `http://localhost:8080/box`.
3. Cloudflare Tunnel exposes the engine as `PUBLIC_ENGINE_URL` for remote players.

### Open items for the hardware engineer

- [ ] Confirm the final parts list and which NFC option (sticker or PN532).
- [ ] Confirm button count and GPIO pins; implement the real bridge against the contract.
- [ ] Confirm the audio path (USB speaker or I2S amp) and the microphone.
- [ ] Enclosure photos for the demo video and README.

## 11. Integrations

Every external service sits behind an adapter with a mock or replay fallback, so the full demo runs offline. Live providers are swapped in by environment variable.

### Sports data (P0 Replay, P1 live)

All providers emit one normalized event stream:

```ts
interface GameEvent {
  gameId: string; sport: 'soccer' | 'nfl'; seq: number; ts: string;   // wall clock of the event
  clock: { period: number; display: string };
  type: 'kickoff' | 'goal' | 'penalty_awarded' | 'penalty_result' | 'corner' | 'card' | 'sub'
      | 'snap' | 'play_result' | 'drive_start' | 'drive_end' | 'period_end' | 'final' | 'score_update';
  team?: string; player?: string;
  data: Record<string, unknown>;  // e.g. {down:3, distance:7, yardline:30, playType:'run', gained:7, firstDown:true}
  score: { home: number; away: number };
}
```

| Provider | Use | Notes | Priority |
| --- | --- | --- | --- |
| **Replay** | Demo and development | Plays a recorded JSON timeline of `GameEvent`s at 1x to 10x speed, with pause and seek; can sync to a local video file played on the box/TV | **P0, the demo depends on it** |
| ESPN public JSON | Live NFL and soccer | Unofficial scoreboard and summary endpoints; poll every 5 to 10 s; verify fields before relying on them | P1 |
| API-Football (api-sports.io) | Live soccer events (goals, cards, penalties) | Free tier is rate limited; poll the fixture events endpoint | P1 |

Replay content (P0): create at least two timelines in `replays/`: one soccer match with a penalty, goals and cards, and one NFL game segment with 3rd downs, a red-zone drive and a score. They can be hand-authored or built from public play-by-play. For the demo video, pair a timeline with **video-game footage we record ourselves** (EA FC or Madden) to avoid broadcast rights issues.

### Gemini Prediction Markets (P0)

Gemini's prediction market data is public and needs no API key for reads ([developer docs](https://developer.gemini.com/products/prediction-markets)).

- List events: `GET https://api.gemini.com/v1/prediction-markets/events?status=active&category=sports&search=<team>&limit=50`
- Get one event: `GET https://api.gemini.com/v1/prediction-markets/events/{eventTicker}`
- Each event has `contracts[]` with `ticker`, `label`, `instrumentSymbol`, and `prices` (`bestBid`, `bestAsk`, `lastTradePrice`) as strings in the 0 to 1 range.
- NFL tickers seen live look like `NFL-2611152125-SF-DAL-M` (moneyline), with sibling events for quarters and halves (`-1QM`, `-1HM`, ...) and spreads (`-S`).
- Real-time (P1): WebSocket `wss://ws.gemini.com`, stream `{instrumentSymbol}@bookTicker`.
- Mid price = (bestBid + bestAsk) / 2. If the spread is wider than 0.10 or a side is missing, use `lastTradePrice`; if that is missing too, mark Gemini's price as unavailable rather than showing a misleading number.
- **Matching:** when a party starts, search Gemini for the game by team names and date; map Gemini contracts to our market templates (game winner, period winners, totals). Show matched Gemini prices with an "as of" time and a link.
- **Uses in the product:** (1) "Friends vs. the Pros" odds beside every comparable market; (2) model calibration (section 6); (3) the end-of-game accuracy scorecard; (4) P2: show a Gemini combo (parlay) price for a room parlay. Trading on Gemini is out of scope.
- Fallback: if no Gemini market matches (e.g. a soccer friendly), hide the Gemini column for that game and say so on the host screen.

### QuickNode Streams (P0)

- **Network:** Solana devnet. **Dataset:** blocks with program data.
- **Filter function:** keep only transactions that invoke `HUDDLE_PROGRAM_ID` and succeeded; decode the Anchor instruction discriminator; emit `{signature, slot, blockTime, instruction, accounts, partyPda, member, amount?}`.
- **Destination:** webhook `POST {PUBLIC_ENGINE_URL}/webhooks/quicknode`, verified with a security token.
- **What the engine does with it:** confirm deposits (player shows as bought in, box flashes, announcer line), show close and finalize progress, show each payout landing, and update the global "Huddle network" leaderboard across parties.
- **Why Streams:** pushed, ordered delivery means the box reacts the moment money moves, without polling. Note: on QuickNode free trials, Solana Streams only follow the chain tip in real time; claim the hackathon QuickNode credits if backfill is needed.
- **Fallback:** if Streams is not configured, the engine subscribes to program logs over RPC so the demo still works. The README states Streams is the primary path.

### ElevenLabs (P0 TTS, P1 agent)

Text to Speech (streaming, low-latency model), ElevenLabs Agents with server tools, Sound Effects. Details in section 7.

### LLM (P0)

Anthropic Messages API by default for question ranking and announcer lines (section 6). Time out at 1.5 s and fall back to templates.

### Grok Bot (P2)

If everything else is done: a Grok Bot routine posts each party's best moments and the final recap to an X account, triggered by a webhook from the engine at game end. Requires a chat export and a 3 to 4 sentence README section to qualify.

## 12. Remote and global parties

Friends anywhere in the world can join the same party from the app: same markets, same odds, same pot. The box stays the host. Version 1 keeps one timeline for the party (the host's TV) and is honest with remote players about their delay; smarter delay handling is P2.

**Why delay matters only for remote players:** everyone in the room watches the same TV, so they see each play at the same moment. A remote friend may be on a different stream. Streaming services typically run about 20 to 60 seconds behind live action, and the gap between two viewers on the same service can be larger ([Stats Perform Super Bowl LX study](https://www.statsperform.com/wp-content/uploads/2026/02/2026-Super-Bowl-%E2%80%93-Latency-Study.pdf)). A remote friend who is behind the room could see a market lock before their screen shows the moment; one who is ahead could know the result early.

### Version 1 rules (P0 and P1)

1. **One clock per party:** markets open and lock on the engine's timeline (host TV plus the data feed). Remote players see the same countdown.
2. **Sync check (P1):** when joining, a remote player taps "I see kickoff" (or the next snap) on their screen. The app estimates their delay versus the room and shows a badge such as "You're about 25 s behind the room."
3. **Delay-aware market access (P1):** players more than 15 s behind the room automatically see only game-long markets, not moment markets, with a short explanation. Players ahead of the room are capped to game-long markets as well, because they could know results early.
4. **Announcer audio for remote players (P1):** the app can play the announcer; lines are tagged with the market they refer to.
5. **Connectivity:** remote players connect through `PUBLIC_ENGINE_URL` (tunnel). If the box goes offline mid-game, open markets are voided after 60 s and players keep their last co-signed balances (section 8).

### Future (P2, pitch only)

A network of boxes: each box timestamps when its own TV shows each moment, the earliest sighting across the network defines the true time, and markets lock fairly for every room. Mention in the pitch as the path from a friends' party to a bar or campus network.

## 13. Non-functional requirements, safety and legal

The demo must feel instant, never stall, and never move real money.

| Area | Requirement |
| --- | --- |
| Latency | Bet ack under 300 ms on LAN, 800 ms remote; price updates broadcast within 200 ms of a fill; announcer first audio within 2.5 s of an event |
| Scale | 12 players per party and 3 concurrent parties on one Pi 5 without lag |
| Reliability | Engine restarts without losing state (SQLite, write-ahead log). Replay mode works with zero internet except the Solana RPC; with `SETTLEMENT=points` it works fully offline |
| Correctness | Market math has unit tests: LMSR cost and price consistency, pool payout sums, bet matching, rounding always in the house's favor, ledger total equals the vault total at every step |
| Security | Keys only in `.env` or `/etc/huddle`; never logged; WebSocket sessions bound to the player's pubkey via a signed challenge; webhooks verified; host-only actions require the host key |
| Accessibility | Large type on the box (readable from 3 m), color-blind-safe win/loss colors, every announcer line also shown as a caption |
| Design | Dark, sporty UI; odds animate on change; one-tap actions; no crypto words in the main player flow ("Buy in", "Cash out", never "sign transaction") |

### Safety and legal (P0 in product, pitch and README)

- **Devnet only:** all money in this project is Solana devnet test USDC. No real-money wagering is offered.
- **Points mode** is built in for anyone who wants zero money involved.
- Real-money social betting is regulated differently in each jurisdiction; a real launch would require legal review, age verification (21+ in many US states), geofencing and responsible-gaming controls. Say this plainly if judges ask.
- Product guardrails built now: per-market and per-party stake limits, a host-set maximum buy-in, no house rake in friends mode, and no announcer lines that encourage chasing losses.
- Not affiliated with any league or team; use our own recorded video-game footage in demos.

## 14. Build plan

One orchestrator agent sets up the shared foundation, then seven agents build in parallel against it. The goal is a demo-complete build by **Wednesday night, Nov 18**, leaving Thursday for hardware integration and the demo video.

### Phase 0: foundation (orchestrator, first 1 to 2 hours, blocks everything)

1. Create the monorepo (section 9 layout), pnpm workspaces, Turborepo, TypeScript strict, lint, Vitest.
2. Write `packages/shared`: all types (section 5), zod schemas, the WebSocket protocol (section 9), the signed-state encoding (section 8), and the LMSR / pool / bet math with unit tests.
3. Write `.env.example`, `DECISIONS.md`, and stub interfaces with mock implementations for: settlement (`SettlementClient`), sports data (`SportsAdapter`), Gemini (`GeminiClient`), announcer (`Announcer`), LLM (`LlmClient`), bridge (`BoxBridge`).
4. Commit, then spawn the workstream agents, each in its own git worktree or branch, each owning the folders listed below.

### Workstreams (run in parallel)

| Agent | Owns | Delivers | Done when |
| --- | --- | --- | --- |
| A1 Solana | `programs/huddle_vault`, `packages/solana-client`, `scripts/solana-*` | Anchor program (section 8), tests, devnet deploy, TS client, treasury and faucet scripts | `anchor test` covers deposit, two-signature `submit_state`, higher nonce wins, bond shortfall, pro-rata cut, withdraw; program ID in `.env.example` and README |
| A2 Engine | `apps/engine` | Parties, markets, the three mode engines, ledger and state signing, lock/resolve/dispute, WebSocket + REST, SQLite, faucet endpoint | A scripted party with 5 bot players plays a full replay in all three modes; the ledger total always equals deposits; restart restores state |
| A3 Data and AI | `packages/sports`, `packages/models`, `packages/gemini`, `ml/`, `replays/` | Replay adapter + 2 replay files, ESPN and API-Football adapters, trigger rules and templates, pricing tables and trained models, Gemini matching and pricing, scorecard, LLM ranking | Replay fires the right markets at the right moments with sensible priors; Gemini client returns live mids for a current NFL game; scorecard computes Brier scores |
| A4 Player app | `apps/player` | PWA: join by link, invisible wallet, faucet, buy in, bet / pool / market trading, cash out, auto co-sign, positions, leaderboard, mic button | A new phone can join and place a bet in under 30 s; works on iOS Safari and Android Chrome; installable |
| A5 Box UI and bridge | `apps/box`, `apps/box-bridge` | Kiosk screens (home, create party, join QR, live board, market takeover, results, leaderboard, scorecard, host controls), mock bridge, LED and button handling | The whole demo can be run from the box screen plus keyboard mock buttons; readable from 3 m |
| A6 Announcer | `packages/announcer` | LLM lines, ElevenLabs streaming TTS with cache and queue, personas, sound effects, agent server tools, Web Speech fallback, agent setup guide | Every event in section 7 speaks within 2.5 s; TALK button answers "what are the odds" correctly; voice draft bets need app confirmation |
| A7 Integration and docs | `scripts/`, `README.md`, CI, Streams config | QuickNode Stream filter + webhook + RPC fallback, tunnel setup, Pi systemd units, Playwright end-to-end test, `pnpm demo` runner, README with every sponsor section | `pnpm demo` starts engine + box + bridge mock + replay and a browser player; e2e test passes; README complete |

**Integration order:** A2 uses the mock settlement client until A1 lands, then swaps in the real one. A4 and A5 build against the shared protocol with a fake engine until A2 is up. A6 starts with Web Speech and swaps in ElevenLabs. Merge to `main` at least twice a day; the orchestrator runs the e2e test after every merge.

### Day-by-day

1. **Mon Nov 16:** Phase 0; all agents start. End of day: replay drives markets in Pool mode with points; box and PWA show live odds; program skeleton compiles.
2. **Tue Nov 17:** Market (LMSR) and Bet modes; cash out; vault on devnet; deposits and signed balances; ElevenLabs callouts; Gemini panel.
3. **Wed Nov 18 (demo-complete):** QuickNode Streams; settlement end to end; talk-back agent; scorecard; polish; e2e green; README draft.
4. **Thu Nov 19:** Install on the real box with the hardware engineer; fix bugs; record the demo video; finish the README.
5. **Fri Nov 20:** Final checks, submit on Devpost by 11:00 AM (1 hour buffer before the noon deadline).

### Definition of done (Wednesday)

- [ ] A full replayed game runs from party creation to on-chain payout with 3+ players, in each of the three modes.
- [ ] Join via the NFC/QR link and buy in with no wallet app and no seed phrase.
- [ ] AI-generated moment markets appear at the right moments with model priors; Gemini prices show where available.
- [ ] The announcer speaks every key event via ElevenLabs.
- [ ] QuickNode Streams events reach the box within a few seconds.
- [ ] README covers every track and bounty requirement (section 15).

### Model choice for the build

Use Claude Fable 5.2 as the orchestrator and for the hardest workstreams (A1 Solana program, A2 engine math). If your coding tool lets you set a model per subagent, the UI and docs agents (A4, A5, A7) can run on Opus 5.5 to save tokens with little quality loss; otherwise run everything on Fable 5.2.

## 15. Demo script and submission checklist

The live pitch is 5 minutes plus 2 minutes of Q\&A; the Devpost video is 2 to 3 minutes. Both follow the same story: the problem in 20 seconds, then judges play.

### Live pitch (5 minutes)

1. **0:00 to 0:30, the hook.** "Every watch party has side bets. They live in group chats and Venmo, and half never get paid. Huddle fixes that." Box on the table, lights idle.
2. **0:30 to 1:15, join.** Hand two judges phones. They tap the box, buy in with one tap. QuickNode fires, the box flashes, the announcer welcomes them by name.
3. **1:15 to 3:00, play.** Start the replay (our recorded EA FC footage). A penalty is awarded: the AI opens "Will he score?" at 77%, with Gemini-style odds beside it where available. Judges trade in Market mode and watch the price move. Lock, result, the announcer roasts the loser, balances update instantly. Show a cash-out on a game-long market. Flip one market to Pool mode to show the toggle.
4. **3:00 to 3:45, talk back.** Press TALK: "What are the odds Portugal hits seven?" The announcer answers with live numbers.
5. **3:45 to 4:30, payout.** Final whistle: the scorecard ("Friends vs. Model vs. Gemini"), the vault closes, payouts land on devnet; show the transaction on the explorer.
6. **4:30 to 5:00, why it wins.** Consumer-grade UX with invisible crypto; Solana vault with signed balances so the host can't run off with the pot; AI that writes and prices the questions; a network of boxes as the path to bars and campuses.

### Q&A prep

- **"Why a box and not just an app?"** It holds the pot (sole co-signer, bonded), it's the room's shared screen and voice, and tapping to buy in is the ritual. Remote friends use the app alone.
- **"Is this gambling?"** Devnet test money and points mode in this build; a real launch needs licensing, age checks and geofencing, and we built stake limits from day one.
- **"What if the box lies?"** Players hold co-signed balances and can settle without the box; the host's bond covers any shortfall.
- **"Where do the odds come from?"** Models trained on public play-by-play data, calibrated to Gemini's regulated markets; the LLM only writes the words.

### Demo video (2 to 3 minutes)

Same story, recorded on the real box. Must include audible announcer audio (ElevenLabs requirement), a Gemini price on screen, a QuickNode-driven update, and the devnet explorer showing a payout.

### Submission checklist (Devpost, due Fri Nov 20 12:00 PM CST)

- [ ] Project name, short description, all team members.
- [ ] Main track: Consumer Applications. Chain award: Best use of Solana. Bounties: Gemini Prediction Markets, ElevenLabs, QuickNode Streams (+ Grok Bot only if built).
- [ ] Answers: What did you build? What problem does it solve? How does it work? What makes it unique? What would you build next?
- [ ] Technologies and sponsor tools used.
- [ ] Public GitHub repo with setup instructions.
- [ ] Working demo link or deployed app.
- [ ] Demo video link (YouTube or Google Drive), access checked from a logged-out browser.
- [ ] README sections: architecture overview and diagram; how we use Solana with program ID(s) and deploy transaction; settlement design and risks; QuickNode Stream config (network, dataset, filter, destination, why); ElevenLabs products used and how; Gemini endpoints used and how; setup and `pnpm demo`; safety and legal note; Grok section if built.
- [ ] Everyone who will pitch is available in person at UT Austin on Sat Nov 21.

## 16. Risks and open questions

The biggest risk is scope: three modes, a program, a box and an AI announcer in three days. Every risk below has a fallback that keeps the demo alive.

| Risk | Fallback |
| --- | --- |
| Phone co-signing of balances is buggy | Switch the party to Trusted-host mode (box-only signatures); same program, same demo |
| Anchor program not ready by Tuesday night | Points mode for UX work; keep the vault demo to deposit + finalize + withdraw |
| Live sports APIs unreliable or rate-limited | Replay mode is the demo path; live data is a bonus shown separately |
| No matching Gemini market for the demo game | Use an NFL replay for the Gemini moment, or show Gemini's live NFL odds panel for a current game alongside the replay |
| ElevenLabs latency or quota | Pre-cached lines + Web Speech fallback |
| QuickNode Stream not delivering on devnet | RPC log subscription fallback; still configure and document the Stream |
| Hardware late | The box UI runs on any touchscreen laptop; mock bridge for buttons and LEDs |
| LLM produces bad questions or text | Schema validation + template fallback; prices never come from the LLM |
| Wi-Fi at the venue | Run the engine on the box with a phone hotspot; points mode works offline |

### Open questions for the team

- [ ] Final product name (Huddle is a working name).
- [ ] Which sport leads the demo: soccer (penalty moment) or NFL (Gemini has live NFL markets)? Recommendation: soccer moment for the wow, plus an NFL clip for the Gemini panel.
- [ ] Who owns the Anthropic, ElevenLabs and QuickNode keys, and who claims the hackathon perks (ElevenLabs Discord coupon, QuickNode credits)?
- [ ] Team member roles for Thursday's box integration and the pitch.

## 17. The build prompt

Paste the prompt below into Claude Code (model: Claude Fable 5.2) in an empty repo folder that contains only `PRD.md` (this document exported as Markdown). It is written to run autonomously for many hours; if the session ends, start a new one with: "Continue the Huddle build. Read PRD.md, STATUS.md and DECISIONS.md, then resume from the first unmet item."

```text
You are the lead engineer and orchestrator for Huddle, a watch-party micro prediction market (a hardware box + a mobile web app + a Solana vault) that we are entering in the UBC 2026 Hackathon. The complete product requirements are in PRD.md in this folder. Read ALL of PRD.md carefully before doing anything else. It is the source of truth; when it is silent, choose the simplest option that keeps the demo working and record it in DECISIONS.md with one line of reasoning.

DEADLINE AND PRIORITIES
- Demo-complete software is due Wednesday Nov 18 (America/Chicago). Build every P0 item first, then P1, then P2 only if all P0 and P1 items pass.
- The demo must run end to end with NO external API keys using Replay mode, mock adapters, the mock box bridge, and points or devnet settlement. External services (ElevenLabs, Anthropic, QuickNode, live sports data) are swapped in by environment variables when keys exist.
- Solana devnet and devnet test USDC only. No real money anywhere.

STEP 1: ENVIRONMENT
- Check for Node 20+, pnpm, git, Rust, the Solana CLI and Anchor. Install anything missing using the official installers. If an install truly cannot complete in this environment, note it in STATUS.md, keep building everything else, and leave exact commands for the human to run.

STEP 2: PHASE 0 FOUNDATION (do this yourself before spawning anyone)
- Create the monorepo exactly as in PRD section 9 (apps/engine, apps/box, apps/player, apps/box-bridge, packages/shared, packages/sports, packages/models, packages/gemini, packages/announcer, packages/solana-client, programs/huddle_vault, ml, replays, scripts) with pnpm workspaces, Turborepo, strict TypeScript, ESLint and Vitest.
- Implement packages/shared completely: the types in PRD section 5, zod schemas, the WebSocket protocol in section 9, the signed-state message encoding in section 8, and the LMSR, pool and bet math with thorough unit tests (cost/price consistency, payouts summing to the pool, rounding in the house's favor, ledger conservation).
- Define interfaces with working mock implementations: SettlementClient, SportsAdapter, GeminiClient, Announcer, LlmClient, BoxBridge.
- Create .env.example (PRD section 9), DECISIONS.md, STATUS.md (a checklist of every P0/P1 item in the PRD with status), and a root script pnpm demo placeholder.
- Commit to main.

STEP 3: PARALLEL WORKSTREAMS
Spawn subagents to build the seven workstreams in PRD section 14 in parallel (A1 Solana, A2 Engine, A3 Data and AI, A4 Player app, A5 Box UI and bridge, A6 Announcer, A7 Integration and docs). For each subagent:
- Use a separate git worktree or branch. It owns only the folders listed for it in section 14 and must not edit other agents' folders; shared-package changes go through you.
- Give it: the relevant PRD sections by number, its deliverables and its done-when criteria from the section 14 table, the shared interfaces it must use, and the instruction to write tests, commit often, and report back a short summary of what works, what is mocked, and what is left.
- Tell it to build against mocks first so it is never blocked by another workstream.

STEP 4: INTEGRATION LOOP (repeat until the Wednesday definition of done in PRD section 14 is fully met)
- Merge finished work into main at least twice a day of work. After every merge: install, build, run all unit tests, run anchor test, and run the end-to-end test (join, buy in, bet in each mode, resolve, close, payout) in Replay mode. Fix or delegate every failure before merging more.
- Swap mocks for real implementations as they land (real settlement client, ElevenLabs, Gemini, QuickNode webhook).
- Keep STATUS.md current: done, in progress, blocked (with the exact reason), and what the human must do (for example: add an API key, run a command, fund a wallet).

STEP 5: FINISH
- pnpm demo must start the engine, the box UI, the mock bridge, a replay game and open a player app in the browser, so one command shows the whole product.
- Write README.md covering every item in the PRD section 15 checklist, including how we use Solana (program ID and deploy transaction), the settlement design and risks, the QuickNode Stream configuration (network, dataset, filter, destination, why), the ElevenLabs products used, the Gemini endpoints used, setup instructions, and the safety and legal note. Include an architecture diagram (Mermaid is fine).
- Write scripts/pi-setup.sh and systemd units so the hardware engineer can install the engine, bridge and kiosk browser on the Raspberry Pi (PRD section 10).

RULES
- Never commit secrets; keep keys in .env (gitignored). Never print keys in logs.
- Never let an LLM set odds or move money; prices come from the models, and voice bets are drafts the player confirms.
- Prefer working, tested, polished P0 features over many half-built ones. The judges reward a smooth end-to-end demo and clear, invisible-crypto UX.
- Do not stop to ask questions. If you need something only the human can provide, record it in STATUS.md under "Needs human" and continue with mocks.
- When everything in the Wednesday definition of done passes, do a final review pass yourself: read the PRD section by section, check each requirement against the code, and fix gaps.

Begin now: read PRD.md in full, then start Step 1.
```
