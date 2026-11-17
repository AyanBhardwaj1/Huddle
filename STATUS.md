# STATUS

Checklist of every P0/P1 item in `PRD.md`.

Legend:

- `[x]` done and verified, with a pointer to the proof
- `[~]` partial
- `[ ]` not started
- `[!]` blocked, with the reason

Per-workstream details are in `docs/workstreams/A1..A6.md`.

_Last updated: Mon Nov 16 2026 (A7 integration pass). Workstreams A1 to A6 are merged. A7 adds the demo runner, e2e, QuickNode, README and CI._

## Phase 0: foundation

- [x] Monorepo (pnpm workspaces, Turborepo, strict TypeScript, ESLint, Vitest), laid out as in section 9.
- [x] `packages/shared`:
  - types (section 5), zod schemas and the WebSocket protocol (section 9);
  - signed-state encoding (section 8);
  - LMSR, pool, bet, vault-finalize and Brier math, with unit tests.
- [x] Adapter interfaces with working mocks.
- [x] `HuddleClient`, shared by the player app, the box UI, the bots and the tests.
- [x] `.env.example`, `DECISIONS.md`, `STATUS.md`, `pnpm demo`.

## P0 (required for the Wednesday demo)

### A1 Solana (`programs/huddle_vault`, `packages/solana-client`)

- [x] Anchor program: `create_party`, `deposit`, `request_close`, `submit_state` (Ed25519 sysvar verification), `finalize` (bond shortfall, pro-rata cut), `withdraw`, `withdraw_host`.
- [x] `anchor test`: 21 on-chain tests on a local validator (`pnpm solana:test`, A1.md). They cover deposit, two-signature submit_state, higher nonce wins, bond shortfall, pro-rata cut and withdraw.
- [x] TS `SettlementClient` for vault and trusted-host modes, with the treasury as fee payer and the faucet.
  - Verified field by field against the mock (A1 integration test).
  - **Verified end to end with the engine on a local validator** (orchestrator, `sh scripts/solana-localnet.sh`, Nov 16): create_party, phone-style signed deposits, close, submit_state, finalize and withdraw all landed. Wallet balances on chain matched the engine's payouts exactly: 80 USDC in, 80 out, vault empty.
- [!] Devnet deploy and deploy transaction: **blocked on devnet SOL**. The RPC faucet answers `410 Gone`. The program ID `GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu` is in `.env.example` and the README, marked as not deployed. Steps are under Needs human.
- [x] Points mode / mock vault (`MockSettlementClient`, same rules).

### A2 Engine (`apps/engine`)

- [x] Parties, markets and the lifecycle (draft → open → locked → resolved → disputed → final / voided): `party-core.test.ts` (32 tests).
- [x] Pool, Market (LMSR) and Bet engines on one ledger, with stake limits: `party-core.test.ts`, plus a 1,000-action fuzz.
- [x] Ledger, signed balance states and co-sign tracking. The ledger total equals deposits at every step (`ledger.test.ts`, `full-game.test.ts`).
- [x] Lock triggers (countdown, data-feed event, host LOCK, box button), resolution and the 20 s dispute window (`engine.test.ts`).
- [x] WebSocket hub, REST API, SQLite persistence, and state restored on restart (`restart.test.ts`).
- [x] Faucet endpoint, QuickNode webhook receiver (token + HMAC, idempotent), and close → submit states → finalize → withdraw (`engine.test.ts`, `scripts/quicknode/webhook.test.ts`).
- [x] 5-bot scripted party through a full replay in all three modes (`full-game.test.ts`; `e2e/party.spec.ts` bot test on the real question engine).
- [~] Gaps (A2.md):
  - restarting the engine during close is untested;
  - the 60 s wait for a disputed market at close is untested;
  - "box offline 60 s voids markets": implemented for moment markets (D20), proven by `apps/engine/src/restart.test.ts` "voids open moment markets ... after the box was offline";
  - webhook deposits are not re-read from RPC.

### A3 Data and AI (`packages/sports`, `packages/models`, `packages/gemini`, `ml/`, `replays/`)

- [x] Replay adapter (0.25x to 20x, pause, seek) and two replay timelines (soccer, NFL): `replay.test.ts`.
- [x] Trigger rules, template catalog and resolvers. Every replay market resolves and none voids (`packages/models` `replay.test.ts`).
- [x] Pricing:
  - trained NFL tables and logistic regressions (nflverse);
  - soccer penalty base rate and Poisson goals (StatsBomb).
- [x] Gemini client: event search, mid-price rules, matching and mock fallback. Run live on Nov 16; real output is in A3.md and the README.
- [x] Friends vs. Model vs. Gemini scorecard, end to end. The Brier tiles and verdict appear on the end screens in the e2e runs.
- [x] LLM question ranker with schema validation and template fallback (`ranker.test.ts`, fake client). **Never run against the real Anthropic API.**

### A4 Player app (`apps/player`)

- [x] Join by link, display name, invisible wallet (IndexedDB), faucet and buy-in: `e2e/party.spec.ts` (real pages, mobile viewport).
- [x] Pool and Market trading in the browser, plus auto co-sign: e2e. Bet-mode cards and cash out are covered by unit and render tests, not by the browser e2e.
- [~] Installable PWA: the manifest and service worker build. **Not tried on a real iPhone or Android phone.**
- [x] Defects found by the e2e and fixed by A7:
  - The "You're in!" buy-in confirmation never showed (`Party.tsx`).
  - The phone kept showing the markets list instead of the payout screen after finalize, because an `AnimatePresence mode="wait"` exit never completed (`Live.tsx`).

### A5 Box UI and bridge (`apps/box`, `apps/box-bridge`)

- [x] Kiosk screens for home, create party, join QR, live board, takeover, results, scorecard, end of game and host controls.
  - The e2e creates a party from the box UI, starts the game and reaches `finalized`.
  - Every screen has a render test.
  - The orchestrator reviewed it visually.
- [x] Mock bridge (`--mock`): WebSocket on :7777, LED preview, keyboard L / T / N (`bridge.test.ts`). Used by `pnpm demo`.
- [~] Announcer audio playback and captions on the box. Captions are verified in the e2e. Audio is verified with stubs only (no ElevenLabs key; Web Speech is not checked by ear).
- [ ] Real `PiHardware` (GPIO, WS2812 ring, NFC): hardware engineer.

### A6 Announcer (`packages/announcer`)

- [x] Event callouts with LLM lines and template fallback: 104 tests. Templates were verified live in every demo and e2e run.
- [~] ElevenLabs streaming TTS, per-persona cache and pre-generated lines. Implemented and tested against a local HTTP stand-in. **Never called with a real key.**
- [x] Web Speech fallback (no key needed).

### A7 Integration and docs (`scripts/`, `README.md`, `e2e/`, CI)

- [x] `pnpm demo` (`scripts/demo.ts`) works with no `.env` and no network. Verified with `PORT=18080 BRIDGE_PORT=17777 pnpm demo --no-open --autostart --speed 10`:
  - the party existed over REST and 3 bots joined and bought in;
  - markets opened and resolved;
  - the party reached `finalized` with payouts summing to deposits (80,000,000 = 80,000,000);
  - after SIGINT, no demo or bridge process was left and both ports were free.
- [x] QuickNode Stream filter (`scripts/quicknode/filter.js`) with tests (`filter.test.ts`, `webhook.test.ts`), a create script (`pnpm quicknode:stream`), and setup docs (`docs/quicknode-stream.md`). The RPC log-subscription fallback is in `VaultSettlementClient.subscribe()`.
- [!] A real Stream on QuickNode: needs an account, a public engine URL and the devnet deploy.
- [x] Playwright e2e (`pnpm e2e`):
  - join → buy in → bet → resolve → close → payout, in real pages, for Pool and Market;
  - all three modes with bots;
  - passed 3 times in a row on Nov 16.
- [x] README covering every item in the PRD section 15 checklist. The Grok section is omitted because Grok was not built.
- [x] `scripts/pi-setup.sh` and the systemd units (engine, bridge, kiosk, tunnel), already in the repo; reviewed by A7. **Not run on a Pi yet.**
- [x] CI (`.github/workflows/ci.yml`): install, typecheck, lint, unit tests, UI build and e2e on Chromium. Not yet run on GitHub (nothing pushed).

## P1 (should have by Thursday)

- [~] Talk-back voice agent: the ElevenLabs Agents server tools and setup script are built, and the offline Web Speech → rule-based TALK answer works. No real agent has been created.
- [~] Sound effects: box stingers are synthesized with Web Audio. The ElevenLabs-generated files are not generated yet (needs a key).
- [~] Live sports adapters (ESPN, API-Football): tested on recorded and synthetic payloads, never through a live game.
- [x] Trained pricing models (nflverse logistic regressions) and Gemini calibration (A3.md).
- [~] Remote players: sync check, delay badge, delay-aware market access and announcer audio in the PWA are built. Untested on a real remote phone.
- [ ] External wallets via Solana Pay; withdraw to an external wallet.
- [ ] Gemini real-time WebSocket quotes.

## P2 (stretch)

- [ ] Grok Bot recap, a 1% house fee option, a wallet back-up screen, a secure-element signer, network-of-boxes timing.

## Needs human

Most important first.

1. **Fund the treasury and deploy to devnet.**
   - Send 3+ devnet SOL to `91mP4ejdaRN6kFL8rmG5QmsjE4hJk7uFUrhoeSTC2BDi` from https://faucet.solana.com.
   - Then run, with `export HUDDLE_KEYS_DIR="$HOME/.config/huddle/devnet"`:
     1. `pnpm solana:setup`
     2. `sh scripts/solana-deploy.sh`
     3. `pnpm solana:setup`
   - Copy `~/.config/huddle/devnet/.env.solana` into `.env` and set `SETTLEMENT=vault`.
   - Put the deploy signature in the README ("Devnet deploy transaction").
   - Run one vault party on devnet through to withdraw. That path is untested on devnet.
   - Keep the keys in `~/.config/huddle/devnet/`. Losing the program keypair before the first deploy changes the program ID.
2. **QuickNode Stream.**
   - Expose the engine (Cloudflare Tunnel) and set `PUBLIC_ENGINE_URL`.
   - Set `QUICKNODE_STREAM_SECRET` (32+ chars) and `QUICKNODE_API_KEY`.
   - Run `pnpm quicknode:stream`, or follow the dashboard steps in `docs/quicknode-stream.md`.
   - Confirm in the dashboard's "Test filter" that the network string is `solana-devnet` and that a Huddle block decodes.
3. **API keys** in `.env`: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `AGENT_TOOLS_SECRET`. Then:
   - run `pnpm --filter @huddle/announcer demo-lines` (latency under 2.5 s, no voice warnings);
   - run `pnpm --filter @huddle/announcer sfx` and commit the five stingers;
   - follow `packages/announcer/agent/AGENT_SETUP.md` for the TALK agent.
4. **Confirm the voice IDs by ear.** The NFL "Brian" and Calm "Eric" defaults are unconfirmed (A6.md), and the default voices expire Dec 31 2026.
5. **Hardware** (PRD section 10 open items):
   - implement `PiHardware` in `apps/box-bridge/src/hardware.ts` (GPIO buttons, WS2812 ring, optional PN532 NFC);
   - run `sudo ./scripts/pi-setup.sh` on the Pi;
   - check that Chromium kiosk autoplay works and that the mic is allowed for `localhost`.
6. **This Mac's Solana toolchain is patched.** macOS 13.2 lacks a libc++ symbol that platform-tools v1.57 needs, so `scripts/solana-env.sh` repoints 9 LLVM binaries at a shim (`scripts/solana-lld-shim.c`). Undo it with `cargo-build-sbf --install-only --force-tools-install --tools-version v1.57`. Updating to macOS 13.3+ removes the need.
7. **Phones:** try `/j/CODE` on a real iPhone (Safari) and an Android phone (Chrome). Check add to home screen, buy-in, bets, mic permission and announcer audio.
8. **Data:** check or replace the hand-entered penalty career tallies in `packages/models/models/soccer.json`. After Nov 22 (when TEN at DAL settles), set `GEMINI_EVENT_TICKERS` to a current game. Watch one live game with `SPORTS_PROVIDER=espn` before relying on it.
9. **Team:** the PRD section 16 open questions (name, lead sport, key owners, pitch roles), the demo video, and the Devpost submission.
10. **Power:** keep the build machine plugged in. Sleeping mid-run makes timing-based tests look hung.

## How to resume

1. `pnpm install`, then `pnpm typecheck && pnpm lint && pnpm test`. Every one should be green.
2. `pnpm e2e:install` once, then `pnpm e2e`: 3 Playwright tests, about 3 minutes.
3. `pnpm demo` to see the product, or `sh scripts/solana-localnet.sh` for real settlement on a local validator.
4. Read this file's `[~]`, `[!]` and Needs human items. The details for each area are in `docs/workstreams/A1..A6.md`, and A7's decisions are in `DECISIONS.md`.
5. Before changing the UIs, keep every `data-testid` listed in `e2e/README.md`.

## Environment notes

- Machine: macOS 13.2 (arm64), Node 22, pnpm 9, Rust 1.97, Solana CLI 4.1.2 (Agave), Anchor 1.2.2 (A1.md).
- Playwright: headless Chromium shell only (`~/Library/Caches/ms-playwright`, about 180 MB).
