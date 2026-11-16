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

## Workstreams

(Each workstream appends its own decisions below.)
