# DECISIONS

Where the PRD is silent, we pick the simplest option that keeps the demo working and record it here with one line of reasoning.

## Foundation (orchestrator)

| # | Decision | Why |
| --- | --- | --- |
| D1 | Workspace packages export TypeScript source directly (`"main": "./src/index.ts"`); the engine runs under `tsx`, the UIs under Vite. No per-package build step. | Removes a whole class of build-order and stale-dist problems in a 3-day build. |
| D2 | `lmsr-b`: LMSR liquidity is `b = L / max(ln n, ln(1/minPrior))` (x0.999), not always `L / ln n`. Priors are clamped to >= 2%. | The PRD formula is the worst-case loss only for uniform priors. Opening at the model's prior (`q_i = b ln p_i`) makes the true worst case `b ln(1/minPrior)`; this keeps the house's loss <= its budget L for any prior. Equal to the PRD formula when priors are uniform. |
| D3 | AMM shares are fixed to 6 decimals; buys round cost up, sells round proceeds down, share payout rounds down; all remainders go to the house (host). | "Rounds in the house's favor" with exact integer conservation: escrow = L + net trade costs always covers the winning payout (unit-tested). |
| D4 | The host has a separate **house** member (an engine-held keypair) that funds the market maker and receives pool dust; the host can also join from their phone as a normal player. | Keeps "money always sums to the vault" true without mixing the host's personal bets with the market maker. |
| D5 | The signed balance is the member's **available cash** (stakes already deducted). Open positions at close are voided and refunded at cost before final states are signed. | Matches PRD section 8 ("positions still open at close are voided"); a mid-game snapshot is always safe to settle from. |
| D6 | A player with an un-countersigned balance state older than 10 s cannot place new bets (`cosign_required`). | Stops a loser from free-riding on an old, higher signed balance; phones countersign automatically so honest players never notice. |
| D7 | `stateHash = sha256(prevHash || canonical JSON of the ledger entries since the last state)`; the phone checks box signature, nonce +1, hash chain and that entries add up before countersigning. | A cheap, deterministic audit trail both sides can recompute (PRD: "re-checks the change"). |
| D8 | Buy-in in vault mode: the engine builds the deposit transaction with the treasury as fee payer and sends the phone only the **message bytes** to sign with tweetnacl. | Keeps `@solana/web3.js` out of the PWA bundle and means players never need SOL. Devnet-only trade-off: the phone signs bytes it does not decode. |
| D9 | Host actions are authorized by a `hostToken` returned once from `POST /parties` and held by the box UI (role `box`). | Simplest "host-only actions require the host key" that works on a kiosk with no wallet UI. |
| D10 | One-tap `place_bet` in Bet mode auto-matches the best opposite offers, then posts the remainder as an offer at the model's odds. | Keeps the "bet with one tap" story in head-to-head mode; `post_offer` / `take_offer` remain for custom odds. |
| D11 | Bet mode on categorical markets: takers win if **any other** outcome wins. | Simplest generalisation of "the other side". |
| D12 | TALK works offline: Web Speech recognition in the browser -> `talk_text` -> rule-based answer -> announcer line. The ElevenLabs Agent replaces it when `ELEVENLABS_AGENT_ID` is set. | "Never block on a missing API key." |
| D13 | Only **high** priority announcer lines preempt the line being spoken; medium waits its turn. | PRD says "high priority preempts low"; avoids choppy audio from medium lines cutting in. |
| D14 | Color-blind-safe palette: YES/win = cyan-blue, NO/loss = orange, never red vs green alone. Shared Tailwind preset in `packages/shared/tailwind-preset.cjs`. | PRD section 13 accessibility; one preset keeps box and phone consistent. |
| D15 | Tailwind v3 + PostCSS, React 18, Vite 5. | Most battle-tested combination for a fast build. |
| D16 | The engine serves the built box UI at `/box` and the built player PWA at `/` (join links are `/j/:code`; bare `/j` redirects to the current party for a passive NFC sticker). | One port (8080), one tunnel URL, matches the Pi kiosk URL in PRD section 10. |
| D17 | A phone with no stored last-signed state (cleared storage, new device) accepts the next balance state by chaining from that state's own `prevBalance` / `prevStateHash` instead of showing a mismatch. | Otherwise a cleared browser locks the player out mid-party. The box signature, entry arithmetic and hash are still verified; only the link to a state this device signed is taken on trust. Devnet trade-off. |
| D18 | Default house budget is 6 USDC per AMM market (PRD suggests 2) and 50 USDC per party. | With D2's tighter `b`, a 2 USDC budget on an 83/17 prior gave `b` of about 1.1, so one 2 USDC bet pushed the price to 99%. 6 USDC keeps prices moving visibly without pinning. The house still cannot lose more than its per-market budget. |
| D19 | With no `PUBLIC_ENGINE_URL`, the engine advertises its LAN IPv4 address in join links and the QR code (`HUDDLE_NO_LAN=1` turns this off). | A QR code pointing at `localhost` is useless to a phone on the same Wi-Fi. |

## Workstreams

Copied from each workstream's doc in `docs/workstreams/` (the source of truth for the details).

### A1 Solana (from docs/workstreams/A1.md)

| # | Decision |
| --- | --- |
| A1-1 | `party_id` is 32 opaque bytes (padded or hashed engine id): a seed must be <= 32 bytes. |
| A1-2 | The vault is a PDA token account (`["vault", party]`), not an ATA: one less program in `create_party`. |
| A1-3 | Running sums + per-member pro-rata in `withdraw`, host dust swept at the end: the only way to mirror `settleClaims` without iterating accounts. |
| A1-4 | Separate `withdraw_host` crank, bundled into `finalize` by the client: keeps `finalize` free of token accounts so anyone can call it. |
| A1-5 | `payer` is a separate account in every instruction that creates accounts: players and the host key never need SOL. |
| A1-6 | Member close timeout is a constant (6 h from creation), not a `create_party` argument: keeps the PRD signature. |
| A1-7 | `challenge_secs` is capped at 7 days: a typo cannot lock a vault for years. |
| A1-8 | A first claim is accepted at any nonce (including 0); after that strictly higher: same rule as the mock. |
| A1-9 | Hand-rolled instruction encoding in the client, checked against the IDL with Anchor's coders in tests: keeps the Streams decoder dependency-free and avoids pinning the Anchor TS runtime to the 1.x IDL. |
| A1-10 | One Ed25519 instruction with both signatures over one message copy: smaller transaction; the program accepts the standard layout as well. |
| A1-11 | `challengeEndsAt` is reported on the local clock: a validator that slept was 55 minutes behind wall time in testing, and devnet drifts too. |
| A1-12 | On-chain tests are Vitest files in `packages/solana-client/tests`, run by `anchor test`: the repo root has no Solana dependencies and root config is not mine to edit. |
| A1-13 | Keys default to `./keys` (gitignored by name); for this run they went to `~/.config/huddle/devnet` because the worktree is temporary. |
| A1-14 | No dependencies added; `pnpm-lock.yaml` is untouched. |

### A2 Engine (from docs/workstreams/A2.md)

| # | Decision | Why |
| --- | --- | --- |
| A2-1 | D6 is enforced whenever `requireMemberSig` is true, in every settlement mode; `trusted` defaults it to false. | Points parties run the same vault rules through the mock, so they exercise co-signing; trusted-host is the escape hatch. |
| A2-2 | Stake cap: a player's total in one market <= `maxStakeFraction` x (available balance + what they already have in that market). | A stable reading of "50% of their balance" that does not shrink as they bet. |
| A2-3 | AMM exposure (for the cap and `locked`) is the cost basis of shares still held; a void refunds net cost (buys minus sells), clawing back profit already cashed out. | "Refunded at cost" has to undo every trade or money is not conserved. |
| A2-4 | One settlement path for resolve, void and changed results: compute the full distribution, apply only the difference to what was already paid. A member who cannot cover a claw-back is debited to zero; the house covers the rest, then credits are cut pro rata. | Atomic reversal, always conserves money, never a negative balance. |
| A2-5 | A host `resolve` or `confirm_result` on a resolved or disputed market is final. | The host is the arbiter of disputes (PRD section 5). |
| A2-6 | One-tap Bet mode auto-matches only on binary markets and only offers within 10% of the model's fair odds; on categorical markets it posts an offer. | Protects one-tap users from bad prices; "anything but X" is not the same as backing one outcome. |
| A2-7 | A taker's position on a categorical bet market has outcome `not:<side>`. | `Position.outcome` cannot say "against X". |
| A2-8 | AMM falls back to pool for a market when the house balance is below the per-market budget; box connections get an `error` message with code `insufficient_funds` explaining it. | The protocol has no notice message. |
| A2-9 | Drafts go to box connections only until they open. | PRD: a draft is "not yet visible". |
| A2-10 | At close, markets with no result are voided at once; markets still disputed after 60 s are voided. | Refund at cost when nobody decided. |
| A2-11 | If the settlement client does not know the party at close (the in-memory mock after a restart), the engine settles locally with the shared `settleClaims` rules. Only for points / mock clients; a real vault failure leaves the party `closing` so the host can close again. | The mock vault forgets everything on restart. |
| A2-12 | `chain_event` is broadcast once per signature; a later sighting via QuickNode is re-broadcast once. | Lets screens show Streams as the source without triple events. |
| A2-13 | Keys live in `DATA_DIR/keys` (dir 700, files 600), never in SQLite; the host token is stored only as a SHA-256 hash. | Keeps secrets out of the database and the logs. |
| A2-14 | `timing.timeScale` divides every engine-controlled duration; tests run at 20x. | A full game runs in seconds on real timers. |
| A2-15 | Package entry is `src/lib.ts` (no side effects); `src/index.ts` is the process entrypoint only. | Importing `@huddle/engine` must not start a server. |
| A2-16 | The QuickNode webhook is refused when `QUICKNODE_STREAM_SECRET` is unset, and agent tools when `AGENT_TOOLS_SECRET` is unset. | Both can change state; never accept them unauthenticated. |
| A2-17 | Messages caused by a request are sent before its ack. | After `await request(...)` a client's view is already current. |
| A2-18 | The house's payout is its vault payout plus whatever the vault returns to the host beyond the bond. | Dust and surplus are house money; payouts then always sum to deposits. |
| A2-19 | Points parties use a challenge window of at most 2 s; `maxBuyIn` is 5x the buy-in. | No real challenge to wait for; matches the default 10 / 50 USDC. |
| A2-20 | `sync_mark.clientTs` is compared with the engine time of the last kickoff or snap; clients should send engine time (`HuddleClient.now()`). | The phone clock may be off. |

### A3 Data and AI (from docs/workstreams/A3.md)

| # | Decision | Why |
| --- | --- | --- |
| A3-1 | The NFL replay is Tennessee at Dallas, not San Francisco vs Dallas as the brief suggested. | SF at DAL was played Nov 15 and is settled on Gemini. TEN at DAL (Nov 22) is listed with live prices for the whole hackathon week, so the Gemini panel matches for real. |
| A3-2 | Gemini matching needs the league and **both** teams; one team alone is never enough. | Showing another game's odds next to our market would be misleading. |
| A3-3 | Unreachable Gemini falls back to flagged sample odds by default; no match hides the column. `GEMINI_FALLBACK=none` hides it in both cases. | PRD: the demo must run offline, and a missing market must be said out loud. |
| A3-4 | Penalty market locks 20 s after it opens (PRD says kick taken / 45 s). | In demo time the kick comes 27 s after the award; 20 s gives a locked beat before the result. |
| A3-5 | "Another card before halftime" locks 30 s after opening (PRD says halftime); next goal locks on the goal or at the 85th minute. | Otherwise a late "No" (or "none") bet is nearly free money in pool mode, where the price does not move. |
| A3-6 | `lock.onEvent` accepts alternatives separated by a vertical bar, for example `goal` or `minute:85` in one string. | One field had to express "whichever comes first". |
| A3-7 | Corners use two events: the award (no `shotOnTarget`) and the outcome (with it). | A market cannot resolve from the event that created it. |
| A3-8 | A `snap` event is the pre-snap situation and opens the market; it locks after 15 s, and the `play_result` resolves it. | Live feeds only report a play after it ends, so the end of the previous play is the only usable trigger. |
| A3-9 | 4th-down price = P(go for it) x P(convert), unless the feed says `goForIt`; no market when that is under 10% or the feed says punt/kick. | Most 4th downs are punts; a 4% market is not fun. |
| A3-10 | The rationale is stored in `resolver.params.rationale`. | `Market` has no rationale field and `explain(market)` needs it after a restart. |
| A3-11 | No proposals for events flagged `data.catchUp` (replay seek, live history). | The moment has already passed. |
| A3-12 | Seek backward replays the prefix from seq 1 instead of only moving a cursor. | Counters cannot be rebuilt otherwise; `reduce` resets itself when `seq` goes backwards. |
| A3-13 | Soccer keeps the PRD default goal rates (1.35 / 1.10) rather than the sample means. | The PRD names them; the sample is tournament-heavy. |
| A3-14 | The ranker checks numbers, length and loss-chasing phrases in code, not only in the prompt. | "The LLM never sets a price" should not depend on the LLM obeying. |

### A4 Player app (from docs/workstreams/A4.md)

| # | Decision | Why |
| --- | --- | --- |
| A4-1 | Stake chips place the bet on tap (no extra confirm); the chip shows the payout before you tap. | "One tap" from PRD; the preview removes the need for a confirm step. |
| A4-2 | Chips are $1/$2/$5 under the cap plus "max" = `floor(balance x maxStakeFraction)`. | Matches the engine's per-market stake limit so "max" never hits `stake_limit`. |
| A4-3 | `cosign_required` is retried once after 1.2 s before showing an error. | D6 makes a just-arrived state block bets for a moment; honest players should never see it. |
| A4-4 | One-tap "Back" in bet mode shows a friend's offer odds only when they beat the model odds. | Mirrors D10 (match best opposite offers first) without promising odds the engine won't give. |
| A4-5 | Returning players (name stored) auto-join on `/j/CODE`; first-timers type a name and can tick "watching from somewhere else". | Fastest path for the 30-second join; remote can still be chosen without an `?r=1` link. |
| A4-6 | The buy-in screen can be skipped ("Just watch for now"); the balance pill opens top-up later. | Lets a judge look before paying in; never a dead end. |
| A4-7 | The house account is hidden from the leaderboard. | It is the market maker, not a player. |
| A4-8 | Captions sit above the tab bar, left of the mic, and auto-expire after 7 s. | Visible but never over the score or the stake chips. |
| A4-9 | Friends vs. the Pros shows on binary markets and any market with a Gemini ref, for the Gemini outcome (else the first outcome). | "Every comparable market"; categorical markets without a Gemini price have nothing to compare. |
| A4-10 | Tiny dependency-free icon generator script instead of an image toolchain. | Keeps the install small; icons are simple shapes. |

### A5 Box UI and bridge (from docs/workstreams/A5.md)

| # | Decision | Why |
| --- | --- | --- |
| A5-1 | Layout designed in rem at 1024x600 with `html { font-size: min(1.5625vw, 2.667vh) }`. | One composition scales from the 7-inch box to a 1080p TV with no breakpoints. |
| A5-2 | Screen is derived from `party.status` (lobby / live / ended+), not local routing; NEXT cycles overlays board → host → scorecard. | Reloads and multiple kiosks always agree with the engine; the NEXT button has one obvious meaning. |
| A5-3 | Result reveals fire only on transitions seen live (`detectSettled` ignores the first snapshot). | A reload must not replay old celebrations. |
| A5-4 | "Who won / lost" in the reveal comes from public fills (stake level), labelled "in" / "lost". | The box has no per-player positions; exact payouts appear on phones. |
| A5-5 | The box UI never sends LED commands; it mirrors the engine's `led` messages and ignores the bridge LOCK button. | The engine already drives the bridge; double-handling would double-lock. |
| A5-6 | TALK on release with the ElevenLabs agent mutes the mic and hangs up after the agent finishes its reply (cap 30 s). | Ending the session on release would cut off the answer. |
| A5-7 | HuddleClient is created inside an effect (not `useMemo`). | The shared client cannot be `close()`d and `connect()`ed again (StrictMode double mount). |
| A5-8 | Bridge binds 127.0.0.1 and ::1 (loopback only) by default. | `localhost` resolves to ::1 first in Node on macOS; loopback-only keeps LAN users from pressing buttons. |
| A5-9 | Stingers are synthesized with Web Audio when there is no `sfxUrl`. | Works offline with zero assets. |
| A5-10 | No crypto words on main screens: "Vault · test money", "Payout landed", "receipt" link for explorer URLs. | PRD section 13 design row. |

### A6 Announcer (from docs/workstreams/A6.md)

| # | Decision | Why |
| --- | --- | --- |
| A6-1 | Default `LLM_MODEL` is `claude-haiku-5-5`, sent with thinking disabled and effort `low` | The announcer has 1.5 s; the Haiku tier is the fast one, and thinking only adds latency for a two-line reply |
| A6-2 | `anthropic-version: 2026-10-21`, plain `fetch`, no sampling parameters | The task allows `fetch`; that API version rejects `temperature`, so none is sent |
| A6-3 | Default TTS model `eleven_flash_v2_5` (override: `ELEVENLABS_TTS_MODEL`) | Documented at about 100 ms and long established. The docs also recommend the newer `eleven_v4_turbo` for low latency; switch with the env var after listening |
| A6-4 | Captions keep "$8" and "77%"; the text sent to TTS is rewritten locally to "8 dollars", "77 percent" | The low-latency models skip text normalisation by default; doing it ourselves works on every model and plan |
| A6-5 | Whole amounts are spoken without ".00" ("$8", "8 pts"), still produced by `formatUsd` | "Eight dollars" reads and sounds better than "eight dollars zero zero" |
| A6-6 | One deadline per line from the moment of the event: 2.2 s for high priority, 0.8 s for countdown lines, 4 s for low and medium | Late audio is worse than browser speech; countdown lines are worthless late; low-priority lines are dropped by the queue at 6 s anyway |
| A6-7 | A line that misses its budget still finishes generating in the background | The clip is ready for the next time the same line is needed |
| A6-8 | An ElevenLabs error puts TTS in a 30 s cooldown (10 s for 429, permanent for 401/403) with one warning per outage | "Log one warning", and do not hammer a failing API during a live game |
| A6-9 | A rejected persona voice falls back to the default voice for that persona only | Two of the three default ids could not be confirmed in the docs; a wrong one must not silence the room |
| A6-10 | LLM lines must contain the key fact (for example the favourite's percentage or the result) and no number outside the facts, in digits or words; a lone "one" is not treated as a number | Stops the model dropping or inventing the news; "that one is off" must not trip the check |
| A6-11 | Templates are chosen by an FNV hash of the event's own identity (market id, fill id, names) | Deterministic for tests and replays, varied across a game |
| A6-12 | Stinger choice for a resolved market: nobody won = sad trombone; a goal or touchdown = goal horn (soccer) or crowd roar (NFL); one big loss (5 USDC or more, larger than any win) = sad trombone; otherwise a payout = cash register | One stinger per line; the moment itself outranks the money |
| A6-13 | TALK picks the market that explains the most words after "on"; ties go to a named outcome, then keywords, then the newest open moment market | "Five on Portugal" is the match winner; "five on Portugal reaching seven corners" is the corners market |
| A6-14 | "Ten on Ronaldo scoring" with no side named drafts Yes on the matching yes/no market ("to miss", "won't" draft No) | Natural speech rarely says "yes"; the reply states the side and nothing happens until the player confirms |
| A6-15 | The optional LLM pass on TALK replies is rejected unless every number survives unchanged and the "confirm" instruction is kept; the draft is never passed to the LLM | Phrasing only; the voice path must not alter amounts |
| A6-16 | `agentSession` returns `null` when the signed URL cannot be fetched | The agent is private (auth on); without a signed URL the client could not connect, so fall back to offline TALK |
| A6-17 | The box (no player name) passes `player_name = "the room"` and the prompt makes the agent ask who is speaking before drafting | A missing dynamic variable fails the conversation start |
| A6-18 | The agent's first message is empty | Push-to-talk: the player speaks first |
| A6-19 | The agent's TTS model and LLM are left at the platform defaults unless `ELEVENLABS_AGENT_TTS_MODEL` / `ELEVENLABS_AGENT_LLM` are set | The docs did not state the LLM default or which TTS models an English agent accepts |
| A6-20 | The tools' secret header is sent as a constant string in the tool config | The docs do not describe how to create a workspace secret by API; the dashboard guide suggests storing it as a secret by hand |

### A7 Integration and docs

| # | Decision | Why |
| --- | --- | --- |
| A7-1 | `pnpm demo` runs the engine in-process (bridge as a child process) with `timing.timeScale` = the replay speed, a fresh temp `DATA_DIR`, and no `.env` required. | The engine has no env switch for its time scale; at `--speed 10` moment markets would otherwise lock after their result. A fresh data dir means every demo starts clean. |
| A7-2 | The box adopts a party from `/box/#party=CODE&host=TOKEN` (`takeSessionFromUrl`), then strips the fragment. | The only way for a launcher to hand the host token to the kiosk; a fragment never reaches server logs. |
| A7-3 | The e2e engine runs as a tsx child process; Playwright drives the built UIs it serves. | Playwright's TypeScript loader cannot import the engine's JSON model tables. |
| A7-4 | The e2e uses real adapters (replay feed, question engine, announcer in Web Speech mode) with `GEMINI_MOCK=1` and points settlement, at 10x with a matching time scale. | Deterministic and offline, but the real market pipeline. |
| A7-5 | e2e selectors are only `data-testid` hooks, listed in `e2e/README.md`. | The UIs are being redesigned; copy, layout and classes will change. |
| A7-6 | Chromium in the e2e runs with background throttling off. | Several phone pages share one headless browser; on a real device each page is in the foreground. |
| A7-7 | The browser e2e covers Pool and Market mode; Bet mode is covered by bot players through `HuddleClient` on the same engine. | Bet mode's offer/take UI is a different flow; the bots exercise post, take, cancel and one-tap. |
| A7-8 | The QuickNode filter decodes instructions itself (inlined copy of `decode.ts`, drift-checked by a test) and also accepts `jsonParsed` and the "Programs + Logs" shape. | Filters cannot import; the docs do not pin the exact Solana block payload shape. |
| A7-9 | The Stream uses dataset `block`, batch size 5, start at the tip, compression none, and the security token as `QUICKNODE_STREAM_SECRET`. | QuickNode asks sub-second chains for batches of 5+; the engine verifies the HMAC over the raw body. |
| A7-10 | Root `pnpm test` = package tests (turbo) + `scripts/` tests; root `pnpm typecheck` also checks `scripts/` and `e2e/`. | The filter and webhook tests live with the scripts they test. |
| A7-11 | Root devDependencies link `@huddle/engine`, `@huddle/shared`, `@huddle/solana-client` and `@solana/web3.js`. | The demo, e2e and script tests import them by package name. |
