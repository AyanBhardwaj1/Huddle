# STATUS

Checklist of every P0/P1 item in `PRD.md`. Legend: `[x]` done and verified · `[~]` in progress / partial · `[ ]` not started · `[!]` blocked (reason given).

_Last updated: Mon Nov 16 2026 — Phase 0 foundation complete; workstreams A1 to A7 starting._

## Phase 0: foundation

- [x] Monorepo (pnpm workspaces, Turborepo, strict TypeScript, ESLint, Vitest), section 9 layout
- [x] `packages/shared`: types (section 5), zod schemas + WebSocket protocol (section 9), signed-state encoding (section 8), LMSR / pool / bet / vault-finalize / Brier math with unit tests
- [x] Adapter interfaces + working mocks: `SettlementClient`, `SportsAdapter`, `QuestionEngine`, `GeminiClient`, `Announcer`, `LlmClient`, `BoxBridge`
- [x] `HuddleClient` (WebSocket client with handshake, acks, reduced view, auto co-sign) shared by player app, box UI, bots and tests
- [x] `.env.example`, `DECISIONS.md`, `STATUS.md`, `pnpm demo` placeholder

## P0 (required for the Wednesday demo)

### A1 Solana (`programs/huddle_vault`, `packages/solana-client`)
- [ ] Anchor program: `create_party`, `deposit`, `request_close`, `submit_state` (Ed25519 sysvar verification), `finalize` (bond shortfall, pro-rata cut), `withdraw`
- [ ] `anchor test`: deposit, two-signature submit_state, higher nonce wins, bond shortfall, pro-rata cut, withdraw
- [ ] Devnet deploy; program ID in `.env.example` and README
- [ ] TS `SettlementClient` (vault + trusted-host modes), treasury fee payer, faucet
- [x] Points mode / mock vault (in-memory, same rules) — `MockSettlementClient`

### A2 Engine (`apps/engine`)
- [ ] Parties, markets, lifecycle (draft → open → locked → resolved → disputed → final / voided)
- [ ] Pool, Market (LMSR) and Bet mode engines on one ledger; stake limits
- [ ] Ledger + signed balance states + co-sign tracking; ledger total == deposits at every step
- [ ] Lock triggers (countdown, data-feed event, host LOCK, game lock point), resolution, 20 s dispute window
- [ ] WebSocket hub + REST API (section 9), SQLite persistence, restart restores state
- [ ] Faucet endpoint, QuickNode webhook receiver, close → submit states → finalize → withdraw
- [ ] 5-bot scripted party through a full replay in all three modes

### A3 Data and AI (`packages/sports`, `packages/models`, `packages/gemini`, `ml/`, `replays/`)
- [ ] Replay adapter (1x to 10x, pause, seek) + 2 replay timelines (soccer, NFL)
- [ ] Trigger rules + template catalog (first 4 per sport) + resolvers
- [ ] Pricing: NFL lookup tables, soccer penalty base rate + Poisson goals
- [ ] Gemini client: event search, mid-price rules, matching to templates, mock fallback
- [ ] Friends vs. Model vs. Gemini scorecard wired end to end
- [ ] LLM question ranker with schema validation + template fallback

### A4 Player app (`apps/player`)
- [ ] Join by link / QR, display name, invisible wallet (IndexedDB), faucet + buy-in
- [ ] Bet / pool / market trading, cash out, positions, leaderboard, auto co-sign
- [ ] Installable PWA; works on iOS Safari and Android Chrome

### A5 Box UI and bridge (`apps/box`, `apps/box-bridge`)
- [ ] Kiosk screens: home, create party, join QR, live board, market takeover, results, leaderboard, scorecard, host controls
- [ ] Mock bridge (`--mock`): WebSocket :7777, LED preview, keyboard L / T / N
- [ ] Announcer audio playback + captions on the box

### A6 Announcer (`packages/announcer`)
- [ ] Event callouts with LLM lines + template fallback
- [ ] ElevenLabs streaming TTS, per-persona cache, pre-generated common lines
- [ ] Web Speech fallback (no key needed)

### A7 Integration and docs (`scripts/`, `README.md`)
- [ ] `pnpm demo` one-command runner
- [ ] QuickNode Stream filter + webhook config + RPC fallback docs
- [ ] Playwright e2e: join → buy in → bet → resolve → close → payout
- [ ] README covering every item in PRD section 15
- [ ] `scripts/pi-setup.sh` + systemd units

## P1 (should have by Thursday)

- [ ] Talk-back voice agent (ElevenLabs Agents + server tools) with offline text fallback
- [ ] Sound effects (generated + cached)
- [ ] Live sports adapters: ESPN, API-Football
- [ ] Trained pricing models (nflverse logistic regressions) + Gemini calibration
- [ ] Remote players: sync check, delay badge, delay-aware market access, announcer audio in the PWA
- [ ] External wallets via Solana Pay; withdraw to an external wallet
- [ ] Gemini real-time WebSocket quotes

## P2 (stretch)

- [ ] Grok Bot recap, 1% house fee option, wallet back-up screen, secure-element signer, network-of-boxes timing

## Needs human

- Add API keys to `.env` when available: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` (+ voice IDs, agent ID), QuickNode devnet `SOLANA_RPC_URL` + `QUICKNODE_STREAM_SECRET`. Everything runs without them (mocks + Replay).
- Hardware engineer: open items in PRD section 10 (parts list, NFC option, GPIO pins, audio path).
- Team: open questions in PRD section 16 (name, lead sport, key owners, pitch roles).

## Environment notes

- Machine: macOS 13.2 (arm64), Node 22, pnpm 9, Rust 1.97. Solana CLI and Anchor were **not** installed at the start; A1 installs them (see A1 section once it reports).
